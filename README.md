# Nomi - Local-first, state-driven agent platform

## Architecture

- **Desktop UI**: Tauri + React 19 + shadcn/ui
- **Runtime**: Go (nomid) with Gin HTTP server
- **Database**: SQLite with golang-migrate
- **Communication**: REST API + SSE (Server-Sent Events)

## Project Structure

```
.
├── cmd/
│   ├── nomid/          # Go runtime entrypoint
│   └── migrate/        # Database migration runner
├── internal/
│   ├── api/            # HTTP handlers (Gin)
│   ├── connectors/     # External service connectors (Telegram)
│   ├── domain/         # Core domain models
│   ├── events/         # Event system with SQLite persistence
│   ├── memory/         # Memory system (Mnemos)
│   ├── permissions/    # Permission engine + approval workflow
│   ├── runtime/        # Run execution engine
│   ├── storage/        # SQLite repositories
│   └── tools/          # Tool system (filesystem, command)
├── pkg/
│   └── statekit/       # State machine framework
├── internal/storage/db/migrations/  # Embedded database migrations
├── templates/          # Built-in assistant templates
└── app/                # Tauri desktop application
    ├── src/            # React + TypeScript UI
    └── src-tauri/      # Rust Tauri shell
```

## Quick Start

### Prerequisites

- Go 1.21+
- Node.js 18+
- Rust (for Tauri)

### Development

```bash
# Terminal 1: Start Go backend
make dev

# Terminal 2: Start Tauri app in dev mode
make app-dev

# Run tests
make test

# Build production app
make build
```

### Using the Desktop App

1. **Create an Assistant**: Go to Assistants tab → "Create Assistant"
2. **Create a Run**: Go to Runs tab → "New Run" → Enter goal
3. **Approve Steps**: When a step needs confirmation, go to Approvals tab
4. **Monitor Events**: Events tab shows real-time SSE stream

## API Endpoints

### Health
- `GET /health` - Health check

### Runs
- `POST /runs` - Create run
- `GET /runs` - List runs
- `GET /runs/:id` - Get run with steps
- `POST /runs/:id/approve` - Approve pending run
- `POST /runs/:id/retry` - Retry failed run

### Assistants
- `POST /assistants` - Create assistant
- `GET /assistants` - List assistants
- `GET /assistants/:id` - Get assistant
- `PUT /assistants/:id` - Update assistant
- `DELETE /assistants/:id` - Delete assistant

### Approvals
- `GET /approvals` - List pending approvals
- `POST /approvals/:id/resolve` - Resolve approval

### Events
- `GET /events?run_id=&type=&limit=` - List events
- `GET /events/stream?run_id=` - SSE event stream

## Testing with curl

```bash
# 1. Create assistant
ASSISTANT=$(curl -s -X POST http://localhost:8080/assistants \
  -H "Content-Type: application/json" \
  -d '{"name":"Dev","role":"dev","system_prompt":"You are a developer"}')
AID=$(echo $ASSISTANT | jq -r '.id')

# 2. Create run
RUN=$(curl -s -X POST http://localhost:8080/runs \
  -H "Content-Type: application/json" \
  -d "{\"goal\":\"ls\",\"assistant_id\":\"$AID\"}")
RID=$(echo $RUN | jq -r '.id')

# 3. Get approval ID (after run executes)
APPROVAL=$(curl -s http://localhost:8080/approvals | \
  jq -r ".approvals[] | select(.run_id==\"$RID\" and .status==\"pending\") | .id")

# 4. Approve
curl -s -X POST "http://localhost:8080/approvals/$APPROVAL/resolve" \
  -H "Content-Type: application/json" \
  -d '{"approved":true}'

# 5. Check run completed
curl -s "http://localhost:8080/runs/$RID" | jq '.run.status, .steps[0].status'
```

## Tools Available

| Tool | Capability | Description |
|------|------------|-------------|
| `filesystem.read` | `filesystem.read` | Read file contents |
| `filesystem.write` | `filesystem.write` | Write file contents |
| `command.exec` | `command.exec` | Execute shell commands |
| `filesystem.context` | `filesystem.read` | Scan folder structure |

## Permission Modes

- **allow** - Execute immediately
- **confirm** - Pause for approval (shown in Approvals tab)
- **deny** - Reject immediately

## License

MIT
