<h1 align="center">Nomi</h1>
<p align="center">
  <strong>Local-first AI agents that ask before they act.</strong><br />
  A state-driven agent platform that runs on your machine, talks to your tools,
  and never lets a model do something you didn't approve.
</p>

<p align="center">
  <a href="https://github.com/felixgeelhaar/nomi/releases/latest"><img src="https://img.shields.io/github/v/release/felixgeelhaar/nomi?include_prereleases&color=blue" alt="release"></a>
  <a href="https://github.com/felixgeelhaar/nomi/actions/workflows/release.yml"><img src="https://img.shields.io/github/actions/workflow/status/felixgeelhaar/nomi/release.yml?branch=main" alt="build"></a>
  <a href="LICENSE"><img src="https://img.shields.io/github/license/felixgeelhaar/nomi" alt="license"></a>
  <a href="https://github.com/felixgeelhaar/nomi/stargazers"><img src="https://img.shields.io/github/stars/felixgeelhaar/nomi?style=social" alt="stars"></a>
</p>

<p align="center">
  <a href="#install">Install</a> •
  <a href="#quickstart">Quickstart</a> •
  <a href="#features">Features</a> •
  <a href="#architecture">Architecture</a> •
  <a href="#contributing">Contributing</a>
</p>

<p align="center">
  <img src="docs/images/02-plan-review.png" alt="Plan review screen" width="900" />
</p>

---

## Why Nomi

Most AI agent frameworks assume the cloud, the model, and the human are all on
the same side of the trust boundary. Nomi doesn't.

- **Local-first.** Your data, your conversations, your secrets — all on your
  machine. SQLite, OS keyring, no telemetry, no account.
- **Plan review before execution.** Every multi-step task is laid out in
  full before any tool runs. You see the plan; you approve the plan.
- **Capability-gated tools.** `filesystem.write`, `command.exec`,
  `network.outgoing` — every tool is bound by an explicit permission rule.
  Allow, confirm, or deny. Per-assistant.
- **Bring any LLM.** Ollama for free + private. Anthropic / OpenAI when
  you want frontier models. Per-assistant model overrides ship out of the
  box.
- **Real plugins, real isolation.** First-party plugins for Telegram,
  Email, Slack, Discord, Gmail, GitHub, Calendar, Obsidian, Browser
  automation, and TTS/STT — plus a WASM marketplace for third-party
  extensions, all gated through the same permission engine.

## Install

| Channel | Command |
|---|---|
| **Homebrew (macOS)** | `brew install --cask felixgeelhaar/tap/nomi` |
| **Scoop (Windows)** | `scoop bucket add nomi https://github.com/felixgeelhaar/scoop-bucket && scoop install nomi` |
| **DMG / MSI / AppImage / DEB** | [Releases page](https://github.com/felixgeelhaar/nomi/releases/latest) |
| **Docker (headless `nomid`)** | `docker run -p 8080:8080 -v nomi-data:/data ghcr.io/felixgeelhaar/nomi` |
| **`go install`** | `go install github.com/felixgeelhaar/nomi/cmd/nomid@latest` |

The desktop bundle ships the `nomid` runtime as a Tauri sidecar, so a single
DMG / MSI / AppImage gives you both the daemon and the UI. The Docker and
`go install` paths give you just the daemon — useful for headless homelab
deploys.

## Quickstart

1. Install Ollama (or point Nomi at any OpenAI-compatible endpoint):
   ```bash
   brew install ollama
   ollama serve &
   ollama pull qwen2.5:14b
   ```
2. Open Nomi. The wizard guides you through provider + assistant + workspace
   in under a minute.
3. Type a goal in chat. Review the plan. Approve. Watch it run.

## Features

### Plan, review, execute

<p align="center"><img src="docs/images/02-plan-review.png" width="900" alt="A multi-step plan with each tool call laid out before execution starts"></p>

Every task becomes a plan with explicit tool calls. You can edit the plan,
branch from any step, or reject it entirely.

### Approvals as a first-class flow

<p align="center"><img src="docs/images/09-approvals.png" width="900" alt="An approval card with plain-language description of the action"></p>

Confirm-mode capabilities pause the run and surface a plain-language card.
"Remember this choice for 24 hours" if the same kind of action is going to
keep coming up.

### Memory that you can see and edit

<p align="center"><img src="docs/images/04-memory.png" width="900" alt="Memory inspector with three scopes: workspace, profile, preferences"></p>

Workspace, profile, and preferences scopes. The agent saves what it learns;
you keep control of what's there.

### Plugins, not integrations

<p align="center"><img src="docs/images/06-plugins.png" width="900" alt="Plugins tab listing browser, calendar, discord, email, github, gmail, obsidian, slack, telegram"></p>

Each plugin declares its capabilities and runs through the same permission
engine as the core tools. Connect what you need; nothing else loads.

### Bring your own model

<p align="center"><img src="docs/images/07-providers.png" width="900" alt="AI providers tab with Ollama configured as the local default"></p>

Ollama, Anthropic, OpenAI, vLLM, LM Studio, anything that speaks the OpenAI
or Anthropic wire format. Set a global default; override per assistant.

### Safety profiles

<p align="center"><img src="docs/images/08-safety.png" width="900" alt="Safety profile picker showing Cautious, Balanced (recommended), Fast"></p>

Three profiles that decide the default permission stance for new assistants.
Balanced is recommended; Cautious confirms everything; Fast trades safety
for iteration speed.

### Audit log

<p align="center"><img src="docs/images/05-events.png" width="900" alt="Event log showing run.created, plan.proposed, step.started, step.completed events"></p>

Every state transition emits an event. Hash-chained, exportable, queryable
by run id. The runtime is observable without any external integration.

### Assistants

<p align="center"><img src="docs/images/03-assistants.png" width="900" alt="Assistant list showing Research Assistant with capabilities and contexts"></p>

Each assistant carries its own persona, capability ceiling, permission
policy, folder context, model override, and bound plugin connections.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                  Nomi.app (Tauri shell)                     │
│  React 19 + shadcn/ui · IPC bridge · macOS menu-bar tray    │
└──────────────────────────┬──────────────────────────────────┘
                           │  REST + SSE (Authorization: Bearer …)
┌──────────────────────────▼──────────────────────────────────┐
│                 nomid (Go runtime daemon)                   │
│  ┌────────────────────────────────────────────────────┐     │
│  │  Run / Plan / Step state machines (pkg/statekit)   │     │
│  ├────────────────────────────────────────────────────┤     │
│  │  Permission engine + approval workflow             │     │
│  ├────────────────────────────────────────────────────┤     │
│  │  Tool registry  ·  LLM resolver  ·  Memory manager │     │
│  ├────────────────────────────────────────────────────┤     │
│  │  Plugin registry  ·  WASM host (wazero)            │     │
│  ├────────────────────────────────────────────────────┤     │
│  │  Event bus  →  SSE stream  +  hash-chained audit   │     │
│  ├────────────────────────────────────────────────────┤     │
│  │  SQLite (WAL) · embedded migrations · OS keyring   │     │
│  └────────────────────────────────────────────────────┘     │
└──────────────────────────┬──────────────────────────────────┘
                           │  OpenAI-compat / Anthropic / Ollama
                           ▼
                    LLM provider(s)
```

A more detailed architectural overview lives in
[`docs/`](docs/) and the ADRs under [`docs/adr/`](docs/adr/).

## Development

```bash
# Backend (Go)
make build               # builds bin/nomid
make test                # go test -race ./...
make sidecar             # builds bin/nomid-<host-target-triple> for Tauri bundling
make migrate-up          # runs embedded migrations against ~/.config/Nomi/nomi.db

# Desktop app (Tauri + Vite)
make app-dev             # dev server at :5173, daemon spawned automatically
make app-build           # produces a signed DMG / MSI / AppImage / DEB

# End-to-end user-journey tests (real Ollama required)
test/journeys/run.sh     # runs all 22 journeys; pass j1 j7 j20 to scope
```

The full developer surface — including the user-journey definitions every
release ships against — is documented at
[`docs/user-journeys.md`](docs/user-journeys.md).

## Contributing

Pull requests welcome. Please read the [`docs/adr/`](docs/adr/) entries
before changing a load-bearing subsystem (permission engine, plugin
architecture, runtime state machine), then open an issue to discuss before
implementing. Smaller fixes — typos, doc edits, plugin polish — can land
straight as a PR.

The project is governed by the [Contributor Covenant Code of
Conduct](https://www.contributor-covenant.org/version/2/1/code_of_conduct/).

## License

Apache-2.0. See [`LICENSE`](LICENSE).

## Acknowledgements

Nomi stands on the shoulders of:
[Tauri](https://tauri.app),
[Gin](https://github.com/gin-gonic/gin),
[modernc.org/sqlite](https://gitlab.com/cznic/sqlite),
[wazero](https://wazero.io),
[Ollama](https://ollama.com),
[shadcn/ui](https://ui.shadcn.com),
[Radix UI](https://www.radix-ui.com),
[TanStack Query](https://tanstack.com/query/latest),
and a long tail of contributors to the open-source AI ecosystem.
