<h1 align="center">Nomi</h1>

<p align="center">
  <strong>Approve every step before your AI touches your filesystem.</strong><br />
  Local-first coding agent that plans, asks, then runs — on your machine,
  with your LLM of choice. Code never leaves your laptop unless you
  decide otherwise.
</p>

<p align="center">
  <a href="https://github.com/felixgeelhaar/nomi/releases/latest"><img src="https://img.shields.io/github/v/release/felixgeelhaar/nomi?include_prereleases&color=blue" alt="release"></a>
  <a href="https://github.com/felixgeelhaar/nomi/actions/workflows/release.yml"><img src="https://img.shields.io/github/actions/workflow/status/felixgeelhaar/nomi/release.yml?branch=main" alt="build"></a>
  <a href="LICENSE"><img src="https://img.shields.io/github/license/felixgeelhaar/nomi" alt="license"></a>
  <img src="https://img.shields.io/badge/local--first-yes-green" alt="local-first">
  <a href="https://github.com/felixgeelhaar/nomi/stargazers"><img src="https://img.shields.io/github/stars/felixgeelhaar/nomi?style=social" alt="stars"></a>
</p>

<p align="center">
  <a href="#compared-to">Compared to</a> •
  <a href="#install">Install</a> •
  <a href="#quickstart">Quickstart</a> •
  <a href="#features">Features</a> •
  <a href="#powered-by">Stack</a> •
  <a href="#roadmap">Roadmap</a> •
  <a href="#contributing">Contributing</a>
</p>

<p align="center">
  <img src="docs/images/02-plan-review.png" alt="Plan review screen" width="900" />
</p>

---

## Why Nomi

Cloud coding agents read your repo, run shell commands, and write files
the moment the model is confident — and the model is always confident.
Nomi makes every step a contract: a plan you approve, tools that ask
before they act, memory you can read and edit. Open-source all the way
down. Runs entirely on your laptop, against any LLM you point it at.

- **Local-first by default — self-hosted by choice.** On a laptop the
  data, conversations, and secrets stay on your machine (SQLite, OS
  keyring, no telemetry, no account). On a homelab box or a cloud VM
  the same `nomid` daemon runs headless behind your reverse proxy —
  see [`docs/headless.md`](docs/headless.md).
- **Plan review before execution.** Every multi-step task is laid out
  in full before any tool runs. You see the plan; you approve the plan.
- **Capability-gated tools.** `filesystem.write`, `command.exec`,
  `network.outgoing` — every tool is bound by an explicit permission
  rule. Allow, confirm, or deny. Per-assistant.
- **Bring any LLM.** Ollama for free + private. Anthropic / OpenAI when
  you want frontier models. LM Studio, vLLM, Together — anything that
  speaks the OpenAI or Anthropic wire format. Per-assistant overrides
  ship out of the box.
- **Real plugins, real isolation.** Telegram ships today as a
  first-party connector, with the WASM plugin marketplace next.
  Connectors for Email, Calendar, GitHub, Slack, Discord, Obsidian,
  Browser automation, and TTS/STT are on the
  [roadmap](https://github.com/felixgeelhaar/nomi/blob/main/.roady/spec.yaml) —
  every one will be gated through the same permission engine, with no
  bypass paths.

## Compared to

The wedge is **Claude Code with local Ollama** — same coding-agent UX,
but the agent asks before it touches your filesystem and your code never
crosses your network unless you point it at a remote provider.

| Alternative | What's different about Nomi |
|---|---|
| **Claude Code / Cursor agents / Cline** | Same goal-driven coding flow (read repo, plan changes, write files, run commands), but every step is laid out as an approveable plan first, every tool call is gated by an explicit capability, and every event is persisted to a hash-chained audit log. Point it at Ollama and your repo never leaves your laptop. |
| **Goose / OpenInterpreter / Aider** | Same local-first stance, but with a real state machine (`Run → Plan → Step`), a real permission engine, real multi-step plans the user can edit, and a desktop UI built around the approval moment instead of around the chat box. |
| **LangChain / AutoGPT / CrewAI** | Those are kits — you assemble the agent. Nomi is the finished product: a working state machine, a permission engine, a memory subsystem, a Tauri shell, all wired up. |
| **Bespoke agent stacks** | Stop reinventing scaffolding. The runtime, the audit trail, the approval workflow, and the plugin model all ship today. Bring your assistants and your prompts. |

## Install

**Desktop app (Tauri shell + bundled `nomid` daemon):**

| Channel | Command |
|---|---|
| **Homebrew Cask (macOS)** | `brew install --cask felixgeelhaar/tap/nomi` |
| **DMG / MSI / AppImage / DEB** | [Releases page](https://github.com/felixgeelhaar/nomi/releases/latest) |

**CLI (`nomi` — drives a local or remote daemon over REST):**

| Channel | Command |
|---|---|
| **Homebrew (macOS / Linux)** | `brew install felixgeelhaar/tap/nomi` |
| **Direct download (Windows)** | [Releases page](https://github.com/felixgeelhaar/nomi/releases/latest) — `nomi-*-windows-amd64.zip` |
| **`go install`** | `go install github.com/felixgeelhaar/nomi/cmd/nomi@latest` |

**Headless daemon (`nomid`):**

| Channel | Command |
|---|---|
| **Docker** | `docker run -p 8080:8080 -v nomi-data:/data ghcr.io/felixgeelhaar/nomi` |
| **`go install`** | `go install github.com/felixgeelhaar/nomi/cmd/nomid@latest` |

The desktop bundle ships the `nomid` runtime as a Tauri sidecar — one
installer, both binaries. **Docker / `go install` give you just the
daemon** — drop it on a homelab box, a VPS, a Kubernetes pod, anywhere
that runs Linux. Configure via a YAML seed manifest at first boot, or
drive the REST API directly. Full guide:
[`docs/headless.md`](docs/headless.md).

For headless interaction without the desktop UI, the **`nomi` CLI**
talks to the daemon over the same REST surface:

```bash
nomi status                              # health + version + active default LLM
nomi run "summarize notes.md"            # submit, drive, print output
nomi list runs                           # most recent runs as a table
nomi list approvals                      # pending approval cards
nomi tail                                # follow the SSE event stream live
nomi seed examples/seed.yaml             # apply a YAML manifest
nomi export -o nomi.yaml                 # snapshot full config (commit to git)
nomi import nomi.yaml                    # reproduce that config on another box

# Drive a remote daemon over SSH-fetched token
NOMI_TOKEN=$(ssh server 'docker exec nomi cat /data/auth.token') \
    nomi --url=https://nomi.example.com run "what changed today?"
```

The CLI auto-resolves URL + token from `$NOMI_DATA_DIR/api.endpoint`
and `$NOMI_DATA_DIR/auth.token` when it runs on the same host as the
daemon.

```yaml
# examples/seed.yaml — mounted at /data/seed.yaml or pointed at via NOMI_SEED.
# Idempotent: edit + restart picks up the diff.
provider:
  name: Ollama
  type: local
  endpoint: http://host.docker.internal:11434
  model_ids: [qwen2.5:14b]
assistants:
  - template_id: research-assistant
    workspace: /data/workspace
settings:
  safety_profile: balanced
  onboarding_complete: true
```

## Who this is for

- You run **Ollama** or **LM Studio** locally and want a real agent UX
  on top.
- You need an **audit trail** before you let an LLM touch your
  filesystem, your inbox, or a production database.
- You prefer **composing Go libraries** over importing a Python
  framework that gets rewritten every six months.
- You want a coding agent **without the IDE lock-in** or a personal AI
  **without the data lock-in**.

## Quickstart

```bash
# 1. Local LLM (or skip and use Anthropic / OpenAI from the wizard)
brew install ollama
ollama serve &
ollama pull qwen2.5:14b

# 2. Install Nomi
brew install --cask felixgeelhaar/tap/nomi

# 3. Open Nomi → wizard sets provider + assistant + workspace in <60s
# 4. Type a goal in chat → review the plan → approve → watch it run
```

## Features

### Plan, review, execute

<p align="center"><img src="docs/images/02-plan-review.png" width="900" alt="A multi-step plan with each tool call laid out before execution starts"></p>

Every task becomes a plan with explicit tool calls. Edit the plan,
branch from any step, or reject it entirely.

<details>
<summary><strong>More features (click to expand)</strong></summary>

### Approvals as a first-class flow
<p align="center"><img src="docs/images/09-approvals.png" width="900" alt="Approval card"></p>

Confirm-mode capabilities pause the run and surface a plain-language
card. "Remember this choice for 24 hours" if the same kind of action
keeps coming up.

### Memory you can see and edit
<p align="center"><img src="docs/images/04-memory.png" width="900" alt="Memory inspector"></p>

Workspace, profile, and preferences scopes. The agent saves what it
learns; you keep control of what's there.

### Plugins, not integrations
<p align="center"><img src="docs/images/06-plugins.png" width="900" alt="Plugins tab"></p>

Each plugin declares its capabilities and runs through the same
permission engine as the core tools. Connect what you need; nothing
else loads.

### Bring your own model
<p align="center"><img src="docs/images/07-providers.png" width="900" alt="AI providers tab"></p>

Ollama, Anthropic, OpenAI, vLLM, LM Studio, Together, Groq — anything
on the OpenAI or Anthropic wire format. Set a global default; override
per assistant.

### Safety profiles
<p align="center"><img src="docs/images/08-safety.png" width="900" alt="Safety profile picker"></p>

Three profiles for the default permission stance on new assistants.
Balanced is recommended; Cautious confirms everything; Fast trades
safety for iteration speed.

### Audit log
<p align="center"><img src="docs/images/05-events.png" width="900" alt="Event log"></p>

Every state transition emits an event. Hash-chained, exportable,
queryable by run id. The runtime is observable without any external
integration.

### Assistants
<p align="center"><img src="docs/images/03-assistants.png" width="900" alt="Assistants tab"></p>

Each assistant carries its own persona, capability ceiling, permission
policy, folder context, model override, and bound plugin connections.

</details>

## Powered by

Nomi is the application layer. The runtime is built directly into this
repository today; over time, load-bearing subsystems move out into
independently-released Go libraries you can use in your own projects.

- **[`statekit`](https://github.com/felixgeelhaar/statekit)** —
  statechart execution engine with XState JSON compatibility. The
  vendored `pkg/statekit` carries the same model that powers every
  `Run` / `Plan` / `Step` transition.
- **[`roady`](https://github.com/felixgeelhaar/roady)** — planning-first
  system of record. Every Nomi feature change passes through a `roady`
  spec before code lands; see [`.roady/`](.roady/) for the live
  spec/plan/state.
- **[`scout`](https://github.com/felixgeelhaar/scout)** — AI-powered
  browser automation. Used by the user-journey test runner; the Browser
  plugin will adopt it once the connector ships.
- **[`mnemos`](https://github.com/felixgeelhaar/mnemos)** — evidence-
  backed local-first knowledge engine. Today Nomi's memory subsystem is
  a thin homegrown SQLite store; integration with mnemos as an embedded
  library is on the roadmap.

External runtime dependencies: [Tauri](https://tauri.app),
[Gin](https://github.com/gin-gonic/gin),
[modernc.org/sqlite](https://gitlab.com/cznic/sqlite),
[wazero](https://wazero.io), [Ollama](https://ollama.com),
[shadcn/ui](https://ui.shadcn.com), [Radix UI](https://www.radix-ui.com),
[TanStack Query](https://tanstack.com/query/latest).

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
│  │  Run / Plan / Step state machines  →  statekit     │     │
│  ├────────────────────────────────────────────────────┤     │
│  │  Permission engine + approval workflow             │     │
│  ├────────────────────────────────────────────────────┤     │
│  │  Tool registry  ·  LLM resolver  ·  Memory  →  mnemos    │
│  ├────────────────────────────────────────────────────┤     │
│  │  Plugin registry  ·  Browser  →  scout             │     │
│  │  WASM host (wazero)                                │     │
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

ADRs under [`docs/adr/`](docs/adr/) cover the big decisions
(plugin architecture, permission engine, state machine).

## Development

```bash
# Backend (Go)
make build          # builds bin/nomid
make test           # go test -race ./...
make sidecar        # builds bin/nomid-<host-target-triple> for Tauri bundling
make migrate-up     # runs embedded migrations against ~/.config/Nomi/nomi.db

# Desktop app (Tauri + Vite)
make app-dev        # dev server at :5173, daemon spawned automatically
make app-build      # produces a signed DMG / MSI / AppImage / DEB

# End-to-end user-journey tests (real Ollama required)
test/journeys/run.sh    # 22 journeys; pass j1 j7 j20 to scope
```

The full developer surface — including the user-journey definitions
every release ships against — is in
[`docs/user-journeys.md`](docs/user-journeys.md).

## Roadmap

v0.2 candidates (track in [`.roady/`](.roady/) and on the
[issues page](https://github.com/felixgeelhaar/nomi/issues)):

- **NomiHub plugin marketplace** — signed WASM plugins, install/update
  flow, signed update manifests
- **Vision backend** for the media plugin — LLaVA via Ollama,
  `media.describe_image` ships
- **Streaming chat tokens in the UI** — wire is done, the live-render
  pass is next
- **`nomi tui`** — full bubbletea TUI on top of the existing CLI for
  SSH-only workflows: chat list, plan-review with inline edit, live
  approvals, event tail
- **Cross-device sync** (opt-in, end-to-end-encrypted) — the local-first
  story extended to two laptops, not weakened to a cloud one

## Contributing

Pull requests welcome. Read the [`docs/adr/`](docs/adr/) entries before
changing a load-bearing subsystem (permission engine, plugin
architecture, runtime state machine), then open an issue to discuss.
Smaller fixes — typos, doc edits, plugin polish — can land straight as
a PR.

Look for [`good first issue`](https://github.com/felixgeelhaar/nomi/issues?q=is%3Aissue+is%3Aopen+label%3A%22good+first+issue%22)
labels on the issues board.

The project follows the [Contributor Covenant Code of
Conduct](https://www.contributor-covenant.org/version/2/1/code_of_conduct/).

## License

Apache-2.0. See [`LICENSE`](LICENSE).
