# ADR 0002 — Plugin Distribution & Lifecycle

- **Status:** Accepted
- **Date:** 2026-04-25
- **Authors:** Felix Geelhaar
- **Builds on:** [ADR 0001 — Plugin Architecture](./0001-plugin-architecture.md)

## Context

ADR 0001 established the Plugin contract (manifests, role interfaces, capability declarations, Connection model). All v1 plugins (Telegram, Email, Slack, Discord, Calendar, Media) are compiled into the `nomid` binary and registered at boot in `cmd/nomid/main.go`. This was deliberate for v1: it kept blast radius small, avoided premature plugin-isolation complexity, and let us prove the architecture under real load before opening the gates.

The bundled-only approach has now hit its first real limit. Users can:
- ✅ Configure connections per plugin
- ✅ Enable/disable individual connections
- ❌ Enable/disable an entire plugin (besides toggling every connection)
- ❌ Install a plugin we don't ship in the binary
- ❌ Uninstall a plugin (because they're compiled in)

A user shipping a "Notion plugin" today would require us to merge their code into our binary and cut a release. That's incompatible with the product narrative — Hermes Agent's "lives on your server, gets more capable the longer it runs" implies a runtime that grows new capabilities post-install. Nomi can't credibly promise that without an addition path that doesn't go through our release cycle.

This ADR pins down **how plugins are distributed, installed, sandboxed, and uninstalled**, and the migration path from today's bundled-only model.

## Decision

**Three coexisting plugin distribution modes**, layered by trust and isolation:

1. **System plugins** — compiled into `nomid`, never uninstallable, always enabled. Today: filesystem, shell, llm, browser (when it lands). Plus the channel + integration plugins we ship in v1. *Why keep them in the binary even after marketplace lands:* boot-time guarantees + no download dependency for core capabilities.
2. **Marketplace plugins** — distributed as signed WebAssembly bundles via NomiHub. Run in-process inside a WASM sandbox with explicit capability grants. Installable, uninstallable, enable-/disable-able from the UI without restarting the daemon.
3. **Local development plugins** — unsigned WASM bundles loaded from a configured directory (`~/.nomi/plugins-dev/`). For plugin authors iterating before publishing. Loud warnings in the UI; unavailable when `dev_plugins_enabled = false` (default off in production builds).

WASM is the chosen sandbox. Justification in the rejected-alternatives section.

### 1. Plugin lifecycle states

A plugin has four orthogonal pieces of state:

```
Distribution:   system | marketplace | dev
Installed:      true | false               (system → always true)
Enabled:        true | false               (independent of installed)
Running:        true | false               (computed: enabled ∧ deps satisfied)
```

State transitions:

```
                              install
[not installed] ───────────────────────────────► [installed, disabled]
                                                          │
                                                          │ enable
                                                          ▼
                              uninstall          [installed, enabled, running]
[not installed] ◄────────────────────────────────────────┘
                              (with cascade)              │
                                                          │ disable
                                                          ▼
                                                 [installed, disabled, stopped]
```

`enable` and `disable` are non-destructive; `uninstall` removes the plugin binary AND **may** cascade-remove its connections + bindings + identities (user-confirmed; the default is "keep configuration in case the user reinstalls").

### 2. Marketplace plugin format — signed WASM bundles

A marketplace plugin is a single `.nomi-plugin` file (gzipped tar):

```
my-plugin.nomi-plugin/
  manifest.json          # PluginManifest (same shape as in-binary plugins)
  plugin.wasm            # the compiled WASM module
  README.md              # rendered in the install dialog
  signature.ed25519      # detached signature over manifest.json + plugin.wasm
  publisher.json         # publisher metadata + their public key fingerprint
```

The runtime verifies `signature.ed25519` against a publisher key embedded in `publisher.json` and chained to a NomiHub root key the daemon ships with. Untrusted (dev-loaded) bundles bypass verification but show a red banner.

WASM exports follow a slim ABI:

```
// exported by the WASM module
plugin_manifest()       -> PluginManifest (JSON-serialized)
plugin_configure(cfg)   -> error | nil
plugin_start()          -> error | nil
plugin_stop()           -> error | nil

// per-role (optional)
channels()              -> []ChannelHandle
tools()                 -> []ToolHandle
triggers()              -> []TriggerHandle
context_sources()       -> []ContextSourceHandle

// dispatch
tool_execute(handle, input)        -> output | error
channel_send(handle, ext_id, msg)  -> error | nil
trigger_start(handle, callback_id) -> error | nil
```

Imports the WASM module can call (the *capability surface*):

```
host_log(level, msg)
host_secrets_get(key)              # gated by capability `secrets.read`
host_http_request(req)             # gated by `network.outgoing`
host_filesystem_read(path)         # gated by `filesystem.read`
host_filesystem_write(path, body)  # gated by `filesystem.write`
host_command_exec(argv)            # gated by `command.exec`
host_emit_event(type, payload)     # always available
```

The WASM runtime (wazero — see rejected alternatives) refuses any import the plugin's manifest doesn't declare. A plugin that imports `host_command_exec` without `command.exec` in its manifest fails to load.

### 3. Capability gates at the host boundary

Every host import is gated by manifest-declared capabilities. The runtime's existing `permEngine.Evaluate(policy, capability)` mediates per-call: even if a plugin declares `command.exec`, the assistant's policy still has to grant it. Two layers of "no":

- **Manifest layer:** plugin declared the capability — without this the import is unavailable.
- **Policy layer:** assistant's PermissionPolicy allows the capability for the calling Run.

The result: a malicious WASM plugin can't access shell unless (a) its manifest declares `command.exec` AND (b) the user's installed permission policy grants `command.exec`. The install dialog surfaces all declared capabilities so users see "this plugin requests command.exec" before approving the install.

#### Capability-granularity policy

Capabilities are **coarse strings + per-capability constraints**, not fine-grained capability strings. Reusing the existing `PermissionRule.Constraints` mechanism that already gates `command.exec` via `allowed_binaries` rather than minting new capability strings per resource.

| Capability | Constraint convention | Source of allowlist |
|---|---|---|
| `network.outgoing` | `allowed_hosts: [api.slack.com, "*.slack.com"]` | Plugin manifest declares the requested set; user policy can narrow it |
| `command.exec` | `allowed_binaries: [git, make]` | Already shipped — same pattern |
| `filesystem.read` / `filesystem.write` | `workspace_root` (assistant-derived) + `max_bytes` (future) | Existing workspace-root model |
| `secrets.read` | None — gate by capability only | Plugin shouldn't request per-secret access; if it needs many, it's wrong |
| `llm.chat` | `provider_profile_id` | Already gated by provider config |

**Why per-capability constraints over fine-grained capability strings** (e.g. `network.outgoing:api.slack.com`):

1. **Permission policies stay short.** A user with three plugins doesn't need 30 rules naming individual hosts. One `network.outgoing` rule with an `allowed_hosts` list covers the lot.
2. **Reuses existing engine machinery.** `permEngine.MatchingRule` already returns the rule's `Constraints` map; the runtime already passes them through to tools (`internal/runtime/execution.go` does this for `command.exec`'s `allowed_binaries` today). Network constraints land as a parallel implementation, not a new system.
3. **Plugins declare honestly upfront.** The install dialog surfaces "this plugin will reach api.slack.com, files.slack.com, *.slack.com" — visible to the user before they consent. If a future plugin update silently adds attacker.com to its manifest, the install dialog flags the new host on update.
4. **Two-stage allowlist gives users control.** Plugin manifest is the *requested* set; user policy is the *granted* set; the intersection is what the WASM runtime allows at the `host_http_request` boundary. Default policy on install: grant the full manifest set ("trust the plugin's published reach"). Tighten later by editing the user policy.

#### Network host matching

`allowed_hosts` entries support the same wildcard model as today's capability matcher:
- `api.slack.com` — exact match only
- `*.slack.com` — matches `api.slack.com` and `files.slack.com`, NOT `slack.com.attacker.com` (leading-dot anchor; same logic as `internal/permissions/engine.go::matchWildcard`)
- `*` — any host (effectively unrestricted; only granted via explicit user override)

#### Manifest extension

```go
// Existing CredentialSpec / ConfigSchema unchanged. New optional field:
type Requirements struct {
    Credentials  []CredentialSpec
    ConfigSchema map[string]ConfigField
    // NetworkAllowlist enumerates the hosts (and host patterns) the
    // plugin needs to reach. Used as the default value for the
    // network.outgoing rule's allowed_hosts constraint when the user
    // installs the plugin. Users can narrow at install time or later
    // by editing the assistant's PermissionPolicy.
    NetworkAllowlist []string `json:"network_allowlist,omitempty"`
}
```

Bundled v1 plugins gain `NetworkAllowlist` declarations as part of the migration — they currently have unbounded `network.outgoing`. Concrete additions:
- `com.nomi.telegram` → `[api.telegram.org, "*.t.me"]`
- `com.nomi.slack` → `[slack.com, "*.slack.com", "*.slack-edge.com"]`
- `com.nomi.discord` → `[discord.com, "*.discord.com", "*.discordapp.net"]`
- `com.nomi.email` → `[]` (no fixed hosts; user-configured IMAP/SMTP servers populate this dynamically)
- `com.nomi.calendar` → `[www.googleapis.com, oauth2.googleapis.com]`

Email is the awkward case: the host list is per-Connection, not per-plugin. Resolution: when `network.outgoing` is the capability AND `NetworkAllowlist` is empty AND the request comes from an email-plugin context, the runtime additionally consults the active connection's `imap_host` + `smtp_host` config and treats those as implicit allowed_hosts. Documented as a per-plugin extension hook the runtime knows about; not something every plugin gets.

**v1 enforcement scope:** the constraint is checked in `host_http_request` for marketplace WASM plugins. Bundled system plugins skip the check — they already have direct Go HTTP clients and can't be intercepted at the WASM boundary. We accept this asymmetry for v1 because the trust model is also asymmetric (system plugins ship with the binary, marketplace plugins are user-installed).

### 4. Configuration ownership during install/uninstall

Plugin-owned data lives in tables keyed by `plugin_id`:

- `plugin_connections` — per-connection config + credential refs
- `assistant_connection_bindings` — assistant ↔ connection bindings
- `plugin_conversations` — multi-turn threads
- `channel_identities` — allowlist
- `run_attachments` — captured media (FK is run_id, not plugin_id, so unaffected)

**Uninstall semantics:**
- Default ("keep config"): the WASM blob + manifest are removed; rows in the above tables are preserved. If the user reinstalls the same plugin id, everything reattaches automatically. Connections show as "plugin missing" in the UI until reinstall.
- Cascade ("forget everything"): user-confirmed checkbox in the uninstall dialog. Cascades all rows above + revokes credentials in `secrets.Store` keyed under `plugins/<plugin_id>/`.

**Disable semantics:** never destroys data. The plugin's WASM module is unloaded; rows stay; the UI greys the card. Re-enable rebuilds the in-process WASM instance and resumes Start().

### 5. Migration path from today's bundled model

The bundled plugins from ADR 0001 stay bundled — they become the **system** category. They're never uninstallable. We add the install/enable/disable mechanics around them so the UI is uniform: every plugin card has the same controls; system plugins just have "Uninstall" greyed out with the explanation "system plugin, always available."

Migration is non-destructive at the data layer:
1. Add `plugin_state` table tracking `(plugin_id, distribution, installed, enabled, version, source_url, signature_fingerprint, installed_at)`.
2. At first boot, seed `plugin_state` with one row per system plugin marking it `distribution=system, installed=true, enabled=true`.
3. UI's per-plugin enable toggle PATCHes `plugin_state.enabled`. `pluginRegistry.StartAll()` consults `enabled=true` before invoking `Plugin.Start()`.
4. Marketplace install endpoints come later — the data model supports them on day one.

### 6. NomiHub — the marketplace itself

NomiHub is a static catalog hosted at `https://hub.nomi.ai/`:

```
https://hub.nomi.ai/index.json                         # signed catalog
https://hub.nomi.ai/plugins/<id>/<version>.nomi-plugin # plugin bundles
https://hub.nomi.ai/keys/root.pub                      # root signing key
```

The daemon fetches `index.json` on a timer (default daily) so the install UI shows what's available. Index entries include manifest, README excerpt, install size, capability list, publisher, and signature.

V1 of NomiHub is a GitHub repository — `nomiai/hub` — with a CI pipeline that signs new plugin bundles and publishes the catalog via GitHub Pages. This keeps infra cost zero until plugin volume justifies dedicated hosting.

**Trust model:**
- Root key is shipped in the daemon binary. Compromise requires a daemon update.
- Publisher keys are signed by the root key. Each publisher signs their own bundles.
- Bundles are content-addressed (SHA-256 in the catalog) so the daemon can refuse a bundle whose hash doesn't match the catalog entry — defends against compromised hub.nomi.ai serving altered bytes.

### 7. UI surface

Plugins tab gains:
- **Top-level toggle per plugin card** (replaces "Add connection"-only affordance for users who want the whole plugin off).
- **Install button** at the top — opens the marketplace browser (separate panel listing NomiHub catalog).
- **Uninstall button** in each user-installed plugin's card (greyed for system plugins).
- **Capability + signature trust panel** in the install dialog showing declared capabilities, publisher, signature status.
- **Update notification** when a newer version of an installed plugin appears in the catalog.

## Explicitly rejected alternatives

### A. Go plugin / cgo / hashicorp go-plugin

Go's `plugin` package compiles to .so and loads at runtime. **Rejected** because:
- Notoriously fragile on macOS (must match exact Go version + build flags + CGO state of the host)
- Doesn't isolate — a panic in the plugin crashes the daemon
- No capability gating possible

`hashicorp/go-plugin` runs RPC over a child process. Better isolation, but heavyweight (separate processes per plugin, IPC overhead) and offers no real capability boundaries — the child process has full host access via syscalls.

### B. Native subprocesses with manifest-based capability gates

Each plugin runs as a native binary launched by the daemon, with capabilities enforced via OS sandboxing (macOS sandbox-exec, Linux namespaces/seccomp). **Rejected** because:
- Cross-platform sandboxing is a research project (sandbox-exec is undocumented; seccomp filters are notoriously tricky to write correctly)
- Each plugin author has to ship per-platform binaries
- Distribution + signing story is per-OS

WASM gives us 90% of the isolation with zero cross-platform divergence.

### C. WASM with WASI Preview 2 / Component Model

WASI P2's component model is the future of WASM plugin systems but the tooling is immature in early 2026. **Deferred** rather than rejected — the WASM ABI we ship in v1 is hand-rolled imports/exports; once Component Model tooling matures we migrate the ABI to it without breaking the Plugin contract.

### D. JavaScript / Lua / Python embedded interpreters

Smaller learning curve for plugin authors but **rejected**:
- JS: pulling QuickJS or Goja in is fine for prototyping but offers no real isolation (interpreters can leak via OS APIs); plugin distribution becomes "ship JS source"
- Lua: same
- Python: even worse — embedded CPython doesn't sandbox at all, and the GIL plus subprocess-spawning patterns make plugin auditing impossible

WASM gives plugin authors language choice (Go, Rust, AssemblyScript, C++) AND a real sandbox.

### E. Cloud plugin marketplace (paid SaaS)

Charge plugin authors / take a revenue cut, run a curated catalog. **Rejected for v1** as scope/business creep. The static-catalog-on-GitHub approach gets us to "users can install plugins" without committing to running a marketplace business. We can layer a paid tier later if there's demand; nothing in this ADR forecloses it.

## Consequences

### Positive

- **Real plugin ecosystem unlocks.** Plugin authors ship `.nomi-plugin` bundles to NomiHub; users install with one click; we don't gate on our release cycle.
- **Stronger capability story.** Today's permission policy gates assistant tool calls; with WASM we *also* gate at the host-import boundary, so a plugin physically can't access capabilities it didn't declare.
- **Per-plugin enable/disable lands cheap** as a side effect of the lifecycle state table — even bundled plugins benefit immediately.
- **Uninstall + reinstall is non-destructive** so users can experiment without losing their connection setup.
- **Out-of-process isolation isn't blocked** — the WASM runtime can later run as a subprocess if we want stronger isolation; no plugin code changes required.

### Negative

- **WASM ABI is API surface.** Once we ship `host_filesystem_read` / `host_secrets_get` / etc. with their signatures, plugin authors depend on them. Breaking changes need versioning.
- **Plugin authors must compile to WASM.** Lower friction than C or Go-plugin, but higher than "drop a Python file in a directory." Trade-off accepted in return for sandboxing.
- **NomiHub is infrastructure we operate.** Even on free GitHub Pages, the catalog requires curation, signing-key management, and an abuse-response process.
- **Capability set is hard to extend safely.** Adding `host_email_send` would let any plugin send email — too coarse. Better: keep the host imports primitive and let plugins call into other plugins via the existing tool-call surface, gated normally by the permission engine.

### Neutral

- **Existing v1 plugins (system tier) work exactly as before.** No behavior change; they get an enable/disable toggle and a cosmetic "system plugin" badge.
- **Migration is one new SQLite table** (`plugin_state`) with seeded rows. Reversible.

## Migration plan (high level)

1. **ADR + roady decomposition** (this document + follow-ups).
2. **`plugin_state` table + per-plugin enable/disable** — the smallest user-visible win, ships independently.
3. **WASM runtime spike** — pick wazero, build a smoke-test plugin (a WASM "echo tool") loadable from `~/.nomi/plugins-dev/`. Validates ABI shape end-to-end.
4. **Capability gates at the host boundary** — wire WASM imports through the existing permission engine.
5. **Sign + verify flow** — Ed25519 signature verification on bundle load; root key embedded in daemon.
6. **NomiHub catalog format** — define `index.json`, build the `nomiai/hub` repo with one curated example plugin.
7. **Install / uninstall REST endpoints** — `POST /plugins/install` (URL or local file), `DELETE /plugins/:id`.
8. **UI** — install dialog with capability + signature trust panel, uninstall confirmation with cascade option, plugin-level enable toggle.
9. **Promote one bundled plugin to the marketplace** as a dogfooding test — likely Calendar or Obsidian since they're tool-only.

## Resolved design points

- **Capability granularity** — coarse capability strings + per-capability `Constraints` (allowed_hosts for network, allowed_binaries for command.exec). Plugin manifest's `NetworkAllowlist` field declares the requested host set; user policy can narrow further. v1 enforcement at the `host_http_request` boundary for marketplace WASM plugins; system plugins skipped (asymmetric trust). See §3.

## Open questions

- **Ed25519 vs Sigstore.** Sigstore would offload key management to a public transparency log (cosign), but adds a runtime dependency on the sigstore client. For v1 the embedded-root-key model is simpler; revisit if plugin volume grows.
- **WASI version.** Preview 1 (`wasi_snapshot_preview1`) is stable but limited; Preview 2 is the future. Default to P1 for v1 with a note to migrate.
- **Hot-reload story.** Should re-enabling a plugin pick up a newer locally-installed version automatically, or require explicit "Update"? Lean toward "explicit update" so users aren't surprised by behavior changes.
- **Per-user plugin scopes vs system-wide.** Multi-user single-machine installs (rare for a desktop app) might want per-user plugin sets. Defer until we hear the request.
- **Telemetry on plugin install/use.** Opt-in, useful for catalog curation, but a privacy-sensitive surface. Defer to a separate privacy ADR.

## Next step

Decompose into roady tasks (estimate ~10-15 sub-tasks across the migration plan above). The smallest user-visible win — `plugin_state` table + per-plugin enable/disable — can ship in isolation and unblocks the user's question that prompted this ADR.
