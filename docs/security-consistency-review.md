# Security Consistency Review (V1 Hardening)

Scope: plugin lifecycle, identity allowlists, secrets handling, and runtime tool boundaries.

## Threat Model Refresh (Concise)

### Assets
- Assistant policy + capability ceilings
- Plugin credentials (bot tokens, API keys)
- Approval decisions and audit trail
- Local database state (`nomi.db`)

### Trust Boundaries
- UI (Tauri/React) -> daemon API
- Daemon -> external plugin/provider APIs
- Marketplace bundle ingestion -> WASM host runtime
- Runtime tool execution -> filesystem/command/network capabilities

## Control Review

### 1) Plugin install/update/uninstall
- [x] Signed bundle verification path exists
- [x] Store/loader separation exists
- [x] System plugins non-uninstallable semantics present
- [ ] Add periodic signature verification re-check on installed marketplace plugins
- [ ] Add explicit rollback path test for failed update midway

### 2) Identity allowlists
- [x] Per-connection allowlist model exists
- [x] Channel-role gating enforced
- [ ] Add explicit deny/allow decision metrics by connection/plugin
- [ ] Add regression tests for wildcard and boundary spoofing cases across all channel plugins

### 3) Secrets handling
- [x] Secret store abstraction present
- [x] Access logs avoid request/response bodies
- [ ] Add periodic secret reference integrity check (dangling `secret://` refs)
- [ ] Add redaction lint for new API handlers/log statements

### 4) Runtime tool boundaries
- [x] Capability ceiling + policy enforcement present
- [x] Approval manager mediation for gated capabilities present
- [ ] Add cross-plugin contract test: disabled plugin + bound assistant cannot execute tool
- [ ] Add explicit telemetry for denied-by-ceiling vs denied-by-policy vs denied-by-constraint

## Prioritized Remediation Queue

1. Add deny-path telemetry split (ceiling/policy/constraint) for runtime and dashboards.
2. Add plugin update rollback tests and installed-signature re-check job.
3. Add secret reference integrity scanner and redaction lint checks.
4. Add cross-plugin allowlist regression suite for boundary spoofing cases.

## Exit Criteria

- Security controls above are documented, test-backed where noted, and observable.
- Any high-risk gaps have owners, due dates, and roadmap tasks.
