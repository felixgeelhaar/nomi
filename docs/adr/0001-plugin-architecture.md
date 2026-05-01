# ADR 0001 — Plugin Architecture

- **Status:** Accepted
- **Date:** 2026-04-24
- **Authors:** Felix Geelhaar
- **Supersedes:** Today's `internal/connectors/` abstraction (Telegram, half-built Gmail)

## Context

Today Nomi models anything that touches the outside world as a **Connector** in `internal/connectors/`. Telegram fits this shape cleanly because it's a conversational channel. When we started wiring Gmail the same way, the seams tore:

- `SendMessage(connectionID, recipientID, message)` is a channel-shaped interface, but Gmail's outbound-send is really a **tool call** that happens inside a plan step (`gmail.send(to, subject, body)`).
- Gmail's inbox-watch is neither a channel (no conversational thread obligation) nor a tool (the assistant doesn't *decide* to poll) — it's a **trigger** that creates runs from external events.
- Gmail also legitimately *is* a channel when a user emails a dedicated assistant address and expects threaded replies.
- The same integration (one Google account, one OAuth session) wants to play all three roles at once.

The current `connectors.Registry` can't represent "Gmail is a channel AND a tool AND a trigger, sharing one OAuth session." It also can't represent a tool-only integration (calendar, GitHub) without forcing a channel-shaped interface on it.

The product target is explicit: match OpenClaw's breadth of integrations (Telegram, Email, Slack, Discord, Signal, Gmail, Calendar, GitHub, Obsidian, ...) for non-techies, where the user thinks *"I installed Gmail"* not *"I installed the Gmail Channel, the Gmail Tools, and the Gmail Trigger."*

## Decision

Adopt a **Plugin** as the unit of extensibility. One plugin = one integration (Gmail, Slack, Telegram, …). Each plugin **declares the roles it plays** via a typed manifest, and the runtime wires each declared role into the appropriate subsystem.

### 1. Plugin contract

```go
// Plugin is the core contract every plugin implements.
type Plugin interface {
    Manifest() PluginManifest
    Configure(ctx context.Context, config json.RawMessage) error
    Start(ctx context.Context) error
    Stop() error
    Status() PluginStatus
}
```

Role participation is expressed via **optional** interfaces that the registry type-asserts at registration time. All role methods take the list of configured **Connections** for this plugin (see §3), because channels/tools/triggers are always operated on behalf of a specific connected account or bot, not the plugin-class as a whole:

```go
type ChannelProvider interface {
    Plugin
    Channels() []Channel          // one Channel per active Connection
                                   // (e.g. one Telegram bot = one channel)
}

type ToolProvider interface {
    Plugin
    Tools() []tools.Tool          // tools are registered once per plugin;
                                   // the Connection to operate on is an
                                   // input parameter to each call
}

type TriggerProvider interface {
    Plugin
    Triggers() []Trigger          // one Trigger per active Connection
                                   // (e.g. one Gmail inbox watch per account)
}

type ContextSourceProvider interface {
    Plugin
    ContextSources() []ContextSource
}
```

A plugin that plays all four roles (hypothetical: Obsidian — channel via Obsidian URI, tool to read/write notes, trigger on file change, context source for current vault) implements all four interfaces. Nothing forces it to; Calendar implements only `ToolProvider` + `TriggerProvider`.

### 2. Plugin manifest

The manifest is a typed Go struct (not YAML/markdown) marshaled to JSON for the UI and for external tooling:

```go
type PluginManifest struct {
    ID            string            // "com.nomi.gmail" — stable, reverse-DNS
    Name          string            // "Gmail" — display
    Version       string            // semver
    Author        string
    Description   string
    IconURL       string            // optional, for Plugins tab

    // Capabilities this plugin declares it can request or provide. The
    // permission engine still owns gating; this is the ceiling.
    Capabilities  []string          // ["gmail.send", "gmail.read", "network.outgoing"]

    // What the plugin contributes. At least one contribution type is
    // required, otherwise the plugin is useless.
    Contributes   Contributions

    // What the plugin needs to operate. Credentials are validated and
    // stored via secrets.Store; never in the DB.
    Requires      Requirements
}

type Contributions struct {
    Channels       []ChannelContribution       // kind: "telegram", "email", "slack", …
    Tools          []ToolContribution          // name + capability + schema
    Triggers       []TriggerContribution       // name + event type
    ContextSources []ContextSourceContribution // name + input schema
}

type Requirements struct {
    Credentials []CredentialSpec              // "oauth_google", "bot_token", "imap_password"
    ConfigSchema map[string]ConfigField       // user-facing settings
}
```

### 3. Connections — multi-account is first-class

A single plugin often needs to be configured **multiple times with different credentials**: two Telegram bots (work / personal), three Gmail accounts, four Slack workspaces. Today Telegram already supports this via `TelegramConfig.Connections`. We make this a first-class concept for every plugin.

A **Connection** (user-facing term kept from today's Telegram UX) is one named, credential-bearing configuration of a plugin:

```go
type Connection struct {
    ID            string          // uuid, stable, used everywhere
    PluginID      string          // "com.nomi.telegram"
    Name          string          // "Work Telegram Bot" — user-picked
    Config        json.RawMessage // plugin-specific (non-secret) config
    CredentialRefs map[string]string // logical-key → secret:// reference
                                     // (e.g. {"bot_token": "secret://telegram/abc/bot_token"})
    Enabled       bool
    CreatedAt     time.Time
    UpdatedAt     time.Time
}
```

Persisted in a new `plugin_connections` table. Replaces the ad-hoc `Connections` array inside `telegram` / `gmail` config blobs. Secrets remain in `secrets.Store`; only references land in `CredentialRefs`.

**Plugins declare connection cardinality** in their manifest:

```go
type ConnectionCardinality string

const (
    ConnectionSingle    ConnectionCardinality = "single"    // desktop, system plugins
    ConnectionMulti     ConnectionCardinality = "multi"     // telegram, gmail, slack
    ConnectionMultiMulti ConnectionCardinality = "multi-multi" // rare; e.g. a plugin with
                                                              // per-workspace sub-connections
)
```

Most user-facing plugins are `multi`. System plugins (filesystem, shell, llm) are `single` — they don't need named connections.

### 4. Assistant ↔ Connection binding (agent builder)

Today's Telegram stores `DefaultAssistantID` on each connection — inbound messages route to exactly one assistant, and each assistant has exactly one bot. This is a 1:1 mapping baked into the connection row.

Reverse the polarity: **agents bind to connections**, not the other way around. A single Gmail account can be used by multiple agents; a single agent can reach out through multiple Telegram bots:

```go
type AssistantConnectionBinding struct {
    AssistantID  string
    ConnectionID string
    Role         string    // "channel" | "tool" | "trigger" | "context_source"
    Enabled      bool
    // Optional priority / selector hints for multi-connection agents
    // (e.g. "primary" / "secondary" Telegram bot for outbound replies).
    Priority     int
}
```

Stored in a junction table `assistant_connection_bindings`.

Concrete routing semantics:

- **Inbound channel**: `ChannelKind:"telegram" + ConnectionID:"abc-123"` → look up bindings where `role="channel"` → if exactly one match, route to that assistant; if multiple, use `Priority` or the connection's own `default_assistant_id` as a tiebreaker. (Forcing N:1 at the connection level keeps inbound routing unambiguous.)
- **Tool call**: assistant does `gmail.send(connection_id, to, subject, body)` → runtime verifies the assistant has a `role="tool"` binding to that connection, otherwise denies with `connection_not_bound`. The LLM sees the list of bound connections in the tool schema as an enum, with connection names as labels, so it can reason "send from *Work* Gmail."
- **Trigger**: fires per connection (one inbox watch per Gmail account). The run it creates is attributed to the assistant with a `role="trigger"` binding for that connection.

### 5. Agent builder UX — default 1, allow N with guardrails

"Build my agent" becomes concrete in the UI. The composer defaults to **one connection per (plugin, role)** because that matches the 80% case and keeps the mental model simple. Binding a second connection of the same plugin is a secondary action ("Add another connection") that surfaces the primary-marker and per-connection policy controls.

```
Assistant: "Personal Assistant"
  ├─ Channels (how people reach me)
  │  ├─ Telegram  [Personal Bot ▾]           [+ Add another]
  │  └─ Email     [personal@example.com ▾]   [+ Add another]
  ├─ Tools (what I can do)
  │  ├─ Gmail     [personal@example.com ▾]   [+ Add another]
  │  │            └─ work@example.com   [primary ○]  [policy: confirm]
  │  ├─ Calendar  [Personal Google ▾]        [+ Add another]
  │  └─ Filesystem (system, always available)
  └─ Triggers (when I wake up)
     └─ Gmail inbox watch  [personal@example.com ▾]  [+ Add another]
```

Design rules:

- **Default cardinality is 1** per (agent, plugin, role). Most users never hit "Add another" and the UX stays calm.
- **Adding a second connection reveals** per-connection controls: primary marker (disambiguates when the LLM doesn't specify), per-connection policy override ("confirm all sends on work"), and "Remove."
- **Explicit binding is a hard wall** (§7). The LLM cannot use a connection the agent isn't bound to; the runtime denies with `connection_not_bound`. This is enforced regardless of what the model tries.
- **Approval copy names the connection** so a mis-targeted call is visible before the user clicks approve.
- **Connections are configured once** in the Plugins tab; agents compose from the pool. Adding a third Gmail account later lights up as a new option for every existing agent — no per-agent reauthorization.

### 6. One registry, three views

`plugins.Registry` is the source of truth. Today's `connectors.Registry` is renamed and extended; today's `tools.Registry` becomes a **view** over plugin-contributed tools + system-provided tools.

```
plugins.Registry  ── (source of truth) ──┐
        │                                │
        ├──  channels.Registry  (view)   │
        ├──  tools.Registry     (view)   │
        └──  triggers.Scheduler (view)   │
                                         │
Runtime queries the appropriate view ────┘
```

This means adding Slack (channel + tool) doesn't require decisions about which registry to register it under — you register the plugin, its contributions fan out automatically.

### 7. Permission engine — capabilities unchanged, gains per-connection overrides

Capabilities are still strings (`gmail.send`, `slack.post`, `filesystem.read`). Plugins declare which capabilities their tools need; the permission engine intersects against the assistant's policy exactly as today. The existing matching logic in `internal/permissions/engine.go` is preserved.

**One additive extension**: the assistant's `PermissionPolicy` gains an optional per-connection override map. Rules today are keyed by capability (`"gmail.send" → confirm`). The extension lets a rule narrow to `(capability, connection_id)`:

```yaml
permission_policy:
  rules:
    - capability: gmail.send
      mode: confirm          # default for all gmail.send calls
  per_connection_overrides:
    - connection_id: "acct-work-xyz"
      capability: gmail.send
      mode: confirm          # always confirm for work Gmail
    - connection_id: "acct-personal-abc"
      capability: gmail.send
      mode: allow            # allow on personal throwaway
```

Resolution order: per-connection override → per-capability rule → policy default. This makes blast-radius controls first-class per connection without complicating the common case (no overrides = same behavior as today).

Security boundaries stay intact and are **strengthened** by Connection-awareness:

- Channel manifest permissions cap what runs originating from that channel can do (today's `rt.SetConnectorManifestLookup`, renamed to `rt.SetPluginManifestLookup`).
- Tools enforce their own capability at invoke time.
- Triggers run as the system, not the user, but the runs they create inherit the same capability ceiling.
- **Binding is a hard wall**: the runtime denies tool calls targeting a connection the assistant isn't bound to (`connection_not_bound`), regardless of capability. An LLM that tries to `gmail.send` through a Gmail connection the assistant has no binding for fails before the tool is even invoked.
- **Per-connection rate limits**: the existing `internal/runtime/ratelimit.go` grows a connection-scoped budget in addition to the per-run budget. A compromised credential for one connection cannot exhaust another's budget.
- **Approval copy shows the connection**: plain-language approval rendering must include the connection's display name ("Send email **from work@example.com** to bob@…") so the user spots mis-targeted calls before approving.

### 8. Conversation model (new domain concept)

Channels need multi-turn threading that the current `Run` model can't express. A `Run` is a single goal; a `Conversation` is a persistent thread tied to a specific Connection.

```go
type Conversation struct {
    ID                     string
    PluginID               string  // "com.nomi.telegram"
    ConnectionID           string  // which bot / account this thread lives on
    ChannelConversationID  string  // chat_id, Message-ID thread root, Slack channel ID
    IdentityID             string  // the user identity allowlist entry
    AssistantID            string  // resolved at thread creation, stable thereafter
    CreatedAt, UpdatedAt   time.Time
}
```

Runs gain `conversation_id` (nullable for Desktop-initiated runs that aren't tied to a durable thread). Channel-originated runs always belong to a Conversation. One Connection can host thousands of Conversations (one per user who messages the bot).

### 9. Identity allowlist per channel

Critical for safety and a v1 gating feature: unknown senders on any channel default to **drop** (or **route to approval** in plain-language-approval mode). Without this, anyone who emails the assistant's address / DMs the Slack bot / finds the Telegram bot handle can invoke capabilities on the user's behalf.

```go
type ChannelIdentity struct {
    ID                 string
    PluginID           string    // "com.nomi.telegram" / "com.nomi.email" / …
    ConnectionID       string    // allowlist is scoped to a connection:
                                 // a sender allowed on one bot isn't
                                 // automatically allowed on another
    ExternalIdentifier string    // phone, email, Slack user ID, Telegram user ID
    DisplayName        string
    AllowedAssistants  []string  // which assistants this identity can talk to
    Enabled            bool
}
```

### 10. V1 plugin catalog (all bundled in binary)

| Plugin | Roles | Kind |
|---|---|---|
| `desktop` | channel | system (non-removable) |
| `filesystem` | tool | system |
| `shell` | tool | system |
| `llm` | tool | system |
| `browser` | tool | system (new — headless WebView driver; OpenClaw parity for "any web service") |
| `telegram` | channel | user-facing |
| `email` | channel + tool + trigger | user-facing (generic IMAP/SMTP) |
| `slack` | channel + tool | user-facing |
| `discord` | channel + tool | user-facing |
| `gmail` | tool + trigger | user-facing (wraps email + Gmail-specific extras) |
| `calendar` | tool + trigger | user-facing (Google + Outlook) |
| `github` | tool + trigger | user-facing |
| `obsidian` | tool + context_source | user-facing |
| `signal` | channel | stretch (signal-cli wrapper) |
| `beeper` | channel | stretch (Matrix bridge — WhatsApp/iMessage/etc. through one integration) |

V2 and beyond: marketplace ("NomiHub"), out-of-process execution for untrusted plugins, long tail of service plugins matching OpenClaw's full list (Twitter, Notion, 1Password, Todoist, Spotify, Hue, Sentry, ...).

## Explicitly rejected alternatives

### A. Keep `connectors.Registry`, add `tools.Registry` + `triggers.Registry` as siblings

Three flat registries, each connector/tool/trigger registered separately.

Rejected: forces "is it a channel or a tool?" decisions at registration time, fragments one integration's state (OAuth, rate limits, config) across registries, and makes the UX confusing ("why is Gmail in three different tabs?").

### B. Adopt OpenClaw's markdown-skill model

SKILL.md files with YAML frontmatter; skills declare requirements and teach the LLM how to invoke underlying tools (bash, browser, MCP servers).

Rejected: breaks Nomi's core guarantees. The permission engine, sandboxing, state machines, and deterministic execution all depend on **typed capabilities**, not prose instructions. An LLM interpreting markdown to decide what bash to run is exactly the attack surface Nomi exists to avoid. We can still *use* skill-style prompt packs *inside* typed plugins (similar to today's assistant templates), but the plugin contract stays typed Go.

### C. Out-of-process plugins from day one (gRPC / subprocess)

Plugins run as separate processes, communicate via RPC. True isolation.

Rejected for v1: massive implementation cost (protocol design, lifecycle management, health checks, credential passing, hot reload) with no user-visible payoff before we have a marketplace. Deferred to v2, once untrusted third-party plugins are a real use case. V1 plugins are in-tree and trusted; the plugin contract is shaped so adding an out-of-process adapter later is straightforward.

### D. Do nothing; continue adding connectors

Rejected: debt is already showing with Gmail. Every new integration (Slack, Discord, Email, Signal) would repeat the Telegram shape and accumulate the same mismatches.

## Consequences

### Positive

- **One mental model.** Users install plugins; plugins declare what they do.
- **Orthogonal composition.** Slack = channel + tool in one plugin, not two registry entries.
- **Connections are first-class.** Two Telegram bots, three Gmail accounts, and four Slack workspaces all coexist cleanly. Connections are configured once and reused across agents.
- **"Build my agent" becomes concrete.** Picking what an agent can do is picking which connections it's bound to, across which roles.
- **Shared state per integration.** One OAuth connection to a Google account serves Gmail tool + Gmail trigger + Calendar tool, without duplicated auth flows.
- **Permission engine unchanged.** Capability strings still drive gating; plugins just declare which ones they need.
- **Unblocks the roadmap.** "Connector Plugin Architecture" (roady umbrella) and "Template Marketplace v1" both fold into this shape.
- **Clear v2 path.** Marketplace, out-of-process plugins, plugin signing all layer on top.

### Negative

- **Large refactor.** Touches `internal/connectors/` (rename + re-shape), the runtime's manifest-intersection lookup, the UI Settings tab, the Assistant edit view, every existing connector, the half-built Gmail work, and the domain model (new Connection, AssistantConnectionBinding, Conversation, ChannelIdentity entities).
- **Domain-model expansion.** Four new entities with migrations, repositories, and REST endpoints. The junction table and Connection table land before any behavior change can ship.
- **Inbound routing needs a disambiguator.** N agents bound to one connection is allowed; we need a deterministic rule for "which agent gets this message" (connection-level `default_assistant_id` fallback). Documented but needs care.
- **Identity allowlist is a v1-gating feature.** Can't ship Email/Slack/Discord safely without it. Adds UI surface and onboarding steps.
- **Telegram migration has data implications.** Existing Telegram connections in `connector_configs.config` must migrate into `plugin_connections` without dropping `default_assistant_id`. This is a one-shot migration written as a SQLite migration file.

### Neutral

- **Telegram works exactly as before** after the refactor. No behavior change for existing users.
- **Existing tools** (filesystem, shell, llm) become `ToolProvider`s of a single `system` plugin. No reshuffling at runtime.

## Migration plan (high level)

1. **ADR + roady decomposition** (this document + follow-up tasks).
2. **Core refactor.** Introduce `Plugin` interface, `plugins.Registry`, role sub-registries as views. Wrap existing `connectors.Registry` callers; deprecate the name. Telegram migrates to `internal/plugins/telegram/` with no behavior change.
3. **Domain additions.** `Connection`, `AssistantConnectionBinding`, `Conversation`, `ChannelIdentity` entities; migrations, repositories, REST endpoints. Telegram's current `Connections` array in `connector_configs.config` migrates row-by-row into `plugin_connections`; existing `DefaultAssistantID` values become `role="channel"` rows in `assistant_connection_bindings`.
4. **Existing tools re-register** as contributions of a `system` plugin. `filesystem.read` / `command.exec` / `llm.chat` keep their capability strings and names.
5. **Remove the Gmail-as-connector stub.** Port OAuth manager to `internal/integrations/google/` (OAuth is shared between Gmail plugin, Calendar plugin, and any future Google-backed plugin).
6. **Ship v1 user-facing plugins in order:** email → slack → discord → gmail → calendar → github → obsidian. Signal + beeper as stretch.
7. **UI reshape.**
   - **Plugins tab**: per-plugin cards with the list of Connections for that plugin and a "Add connection" button. Device-flow / OAuth / token-entry UX lives here.
   - **Assistant edit view** gains the "build my agent" composer: a checklist of all available Connections grouped by plugin, filterable by role (channel / tool / trigger / context_source). Editing an assistant is literally editing its `assistant_connection_bindings` rows.

## Resolved design points

These were live questions during ADR drafting; decisions recorded here for future reference:

- **Inbound routing with N assistants bound to one connection** — allow N bindings; `assistant_connection_bindings.primary = true` picks the inbound target; runtime falls back to connection row's `default_assistant_id` if no primary is marked. Fan-out to multiple assistants is explicitly rejected for v1 (duplicates runs, confuses threading).
- **Tool calls with N connections per plugin per agent** — LLM picks by name (connection label appears as an enum in the tool schema). If the LLM omits it, the runtime uses the assistant's `primary` binding for that plugin/role. If the LLM names a connection the assistant isn't bound to, runtime denies with `connection_not_bound`. Auto-fallback to primary is **not** used for safety — a mis-typed connection ID by a jailbroken model should fail loud.
- **Cardinality default** — UI defaults to 1 connection per (agent, plugin, role). "Add another" is a secondary action that reveals per-connection controls. See §5.
- **Blast-radius controls** — per-connection policy overrides on `PermissionPolicy` (§7), per-connection rate limits, connection name in approval copy.

## Still open

- **Does `desktop` need to be a formal `Plugin` or stay hardwired?** Formalizing is cleaner but adds ceremony for a surface that's not going anywhere.
- **How do identity allowlists handle first contact?** Drop silently, reply with a "request access" message, or queue an approval for the assistant owner? Plain-language approval copy probably handles this well but needs design.
- **Beeper integration path.** Matrix client library choice, hosting assumptions (Beeper Cloud vs self-hosted bridge).
- **Browser tool sandbox.** Shared Tauri WebView vs separate process. Credentials (session cookies, 2FA) are a substantial security design.
- **Plugin hot-reload.** Do plugin config changes restart just the affected plugin, or trigger a process restart? Today's Telegram restart logic is per-connector; this should carry over.
- **Connection health surfacing.** Per-connection status (auth valid, last event, error count) in the UI. Scope decision: polling indicator vs event-driven badges.

## Next step

Decompose this ADR into roady tasks (estimate ~15-20 sub-tasks across Core refactor, Domain additions, V1 plugins, UI reshape, Identity allowlist, Conversation model). Maintain `max_wip: 3` per the existing policy; work through in the migration-plan order above.
