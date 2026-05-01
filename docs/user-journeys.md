# User Journeys

Production-shaped flows a real beta user walks through end-to-end. Each
journey is one runnable scenario with explicit setup, action, and success
criteria; `test/journeys/run.sh` exercises every one of them against a live
`nomid` + a real Ollama backend.

The journeys are ordered by typical user-encounter sequence. Earlier
journeys validate the foundation later ones depend on (a working LLM, a
configured assistant, a writable workspace).

---

## J1 — First run

A user with a clean install opens Nomi, picks a template, points it at a
local model, and lands on the chat tab.

**Setup**
- Empty database (`nomi.db` removed before boot).
- `nomid` running on `:8080`.
- Ollama running on `:11434` with at least one chat-capable model installed.

**Action**
1. `GET /health` → 200.
2. `GET /settings/onboarding-complete` → `{"complete": false}`.
3. `POST /provider-profiles` with `{type:"local", endpoint:"http://localhost:11434", model_ids:["qwen2.5:14b"]}`.
4. `PUT /settings/llm-default` with the new provider id + model.
5. `POST /assistants` from a template (Research Assistant), with a folder context pointing to a writable temp dir.
6. `PUT /settings/onboarding-complete {complete: true}`.

**Success criteria**
- All endpoints 2xx.
- Created provider's endpoint stored as `http://localhost:11434/v1` (`/v1` auto-appended).
- Created assistant's `permission_policy.rules` includes `llm.chat=allow` (template default + balanced safety profile).
- `GET /settings/safety-profile` → `{"profile":"balanced"}` (the default).

---

## J2 — Casual Q&A

User types a short question. Assistant answers in one step. No approval.

**Setup** — J1 complete.

**Action**
1. `POST /runs` with `{goal:"Reply with a single word: pong", assistant_id}`.
2. Poll `/runs/:id` until status `plan_review`.
3. `POST /runs/:id/plan/approve`.
4. Poll until terminal status.

**Success criteria**
- Plan has exactly one step, `expected_tool == "llm.chat"`.
- Final run status `completed` (not `awaiting_approval` — `llm.chat` is `allow` in balanced).
- The step's `output` is non-empty.
- `< 30s` wall time (with Ollama qwen2.5:14b on local hardware).

---

## J3 — File write with approval

User asks the assistant to create a file. Plan includes a
`filesystem.write` step that requires confirmation. User approves; file
lands on disk inside the workspace.

**Setup** — J1 complete; assistant's folder context = `$WORKSPACE`.

**Action**
1. `POST /runs` with `{goal:"Create file hello.txt with content: hello world"}`.
2. Approve plan when run reaches `plan_review`.
3. When run reaches `awaiting_approval`, fetch pending approval and
   `POST /approvals/:id/resolve {approved: true}`.
4. Poll until terminal.

**Success criteria**
- Plan contains `filesystem.write` step with `arguments: {path, content}`
  populated by the planner.
- Run progresses `plan_review → executing → awaiting_approval → executing → completed`.
- File exists at `$WORKSPACE/hello.txt`, contents match the goal.
- Approval card title is plain language (`"Write files in your workspace"`),
  not the bare capability string.

---

## J4 — File read + summarize

User points the assistant at an existing file and asks for a summary.
Multi-step plan: `filesystem.read` (allow under balanced) → `llm.chat`
(allow). No approvals needed.

**Setup** — J1 complete; pre-write a fixture file inside the workspace.

**Action**
1. Pre-write `$WORKSPACE/notes.md` with three lines of seed text.
2. `POST /runs` with `{goal:"Summarize notes.md in one sentence"}`.
3. Approve plan, poll until terminal.

**Success criteria**
- Plan has ≥2 steps.
- At least one step has `expected_tool == "filesystem.read"` with
  `arguments.path` ending in `notes.md`.
- Final status `completed`.
- The chat step's `output` mentions a substring from the seed file.

---

## J5 — Plan edit before approval

User reviews a generated plan, removes a step, and approves the edited
version.

**Setup** — J1 complete.

**Action**
1. `POST /runs` with a goal that produces a multi-step plan.
2. When `plan_review`, `GET /runs/:id` and capture the plan.
3. `POST /runs/:id/plan/edit` with a 1-step subset.
4. `POST /runs/:id/plan/approve`.
5. Poll until terminal.

**Success criteria**
- After edit, `plan.version` increments.
- Executed `Step` count matches the edited plan's step count, not the
  original.
- Final status `completed`.

---

## J6 — Branching

User branches a completed run from a specific step to explore an
alternative.

**Setup** — J3 complete; capture the approved plan's step IDs.

**Action**
1. `POST /runs/:id/fork` with `{step_id}` of an early step.
2. Drive the new run through plan_review → completion same as J3.

**Success criteria**
- New run has `run_parent_id` set to the original.
- New run has `branched_from_step_id` set to the requested step.
- Both runs visible in `GET /runs`.

---

## J7 — Pause and resume

User pauses an executing run; resumes later.

**Setup** — J1 complete.

**Action**
1. `POST /runs` with a multi-step goal.
2. Approve plan immediately.
3. While `executing`, `POST /runs/:id/pause`.
4. Confirm `paused`.
5. `POST /runs/:id/resume`.
6. Poll to terminal.

**Success criteria**
- Run reports `paused` between pause + resume.
- After resume, run reaches `completed` without the user re-approving the plan.
- Step that was running at pause time ends with status `done` or
  re-runs cleanly (no stuck `blocked`).

---

## J8 — Memory persistence

After a run completes, the assistant has remembered something the user
asked it to. A later run sees that memory in its context.

**Setup** — J1 complete.

**Action**
1. `POST /memory` with `{scope:"preferences", content:"Always answer in lowercase"}`.
2. `POST /runs` with `{goal:"What is 2+2?"}`.
3. Drive to completion.
4. `GET /memory?assistant_id=…` and confirm both entries are listed
   (preference + workspace memory auto-saved by the runtime).

**Success criteria**
- The `preferences` entry is preserved across the run.
- The runtime emits at least one new `workspace`-scoped memory tied to the
  run.
- Listing memory by assistant returns both entries.

---

## J9 — Late policy deny (TOCTOU close)

User starts a run that needs a confirm-mode capability. While the
approval is pending, the user opens the assistant builder and demotes
the capability to `deny`. After they finally approve the prompt, the
runtime should refuse the action with a "policy changed" error rather
than executing under the stale rules.

**Setup** — J1 complete.

**Action**
1. `POST /runs` with a write goal so it stops at `awaiting_approval`.
2. `PUT /assistants/:id` with the `filesystem.write` rule mode flipped to
   `deny`.
3. Resolve the pending approval with `{approved: true}`.

**Success criteria**
- Run terminates `failed` with reason `policy_deny_after_approval`.
- The file was not written.

---

## J10 — Endpoint hardening

Spam known-bad provider endpoints; nomid rejects with a 400 before any
network activity.

**Setup** — running daemon, authenticated.

**Action**
- For each of `file:///etc/passwd`, `javascript:alert(1)`, `gopher://x`,
  `localhost:11434` (no scheme), `http://`: send `POST /provider-profiles`.

**Success criteria**
- Every request rejected with 400 and an explanatory error.
- No new rows in `provider_profiles`.
- No outbound network connection from `nomid`.

---

## J11 — Audit export

User downloads the event audit log for a date range.

**Setup** — at least one completed run (J2 or J3).

**Action**
- `GET /audit/export?since=…&until=…` (or default range).

**Success criteria**
- 200 with non-empty body.
- Body parses as JSON with at least one run/step/approval event tied to
  the prior runs.

---

## J12 — Provider rotation

User adds a second provider, switches the global default to it, runs a
chat, switches back.

**Action**
1. `POST /provider-profiles` for a second profile (a different installed
   Ollama model is enough).
2. `PUT /settings/llm-default` to point at it.
3. `POST /runs` and drive to completion.
4. `PUT /settings/llm-default` back to the original.

**Success criteria**
- Both runs complete.
- The second run's emitted plan/output references the second profile's
  model id (visible in events or step output_summary).

---

---

## Advanced journeys (power user)

The first twelve cover everyday flows. The next seven exercise the
configuration surface a power user touches: bypassing the wizard,
fine-tuning permissions, attaching memory by hand, multi-assistant
workspaces, per-assistant model overrides, plugin lifecycle.

## J13 — Manual provider CRUD

Power user adds a second provider profile, edits it, deletes it.

**Action**
1. `POST /provider-profiles` with the bare host (no `/v1`).
2. `GET /provider-profiles` and confirm the new id is in the list.
3. `PUT /provider-profiles/:id` to rename and add a model id.
4. `DELETE /provider-profiles/:id` and confirm it's gone.

**Success criteria**
- Created profile's stored endpoint has `/v1` auto-appended.
- Update persists the new name + model list.
- Delete removes the row.

## J14 — Custom assistant from scratch

User picks the Custom template, trims its capabilities, edits the
resulting assistant, and deletes it.

**Action**
1. `POST /assistants` with `template_id="custom"`, a narrowed
   capabilities array (`[llm.chat, filesystem.read]`), and an explicit
   permission policy (`llm.chat=allow`, `filesystem.read=allow`).
2. `PUT /assistants/:id` to rename + add `filesystem.write` (confirm).
3. `DELETE /assistants/:id`.

**Success criteria**
- Updated assistant has 3 capabilities total.
- Stored permission_policy includes the new rule.

## J15 — Memory CRUD by scope

User manages memory entries directly, separate from runtime auto-saves.

**Action**
1. Create one entry per scope (workspace, profile, preferences).
2. `GET /memory?scope=…` for each scope; verify isolation.
3. `GET /memory?q=docs` (substring search).
4. Delete two of three; verify the third still listed.

**Success criteria**
- Each scope returns only its own entries.
- Substring search returns matching content.
- Unrelated deletes don't disturb other entries.

## J16 — Plugin enable / disable

Power user toggles a built-in plugin off, then on. State persists.

**Action**
1. `GET /plugins` → pick the first non-`telegram` plugin.
2. `GET /plugins/:id/state` to capture starting `enabled` flag.
3. `PATCH /plugins/:id/state` with the inverse.
4. `GET /plugins/:id/state` and assert it flipped.
5. Restore original.

**Success criteria**
- Toggle persists across the request boundary.
- Restore returns to the original value.

## J17 — Multi-assistant routing

Two assistants live side-by-side; runs against each pick up that
assistant's persona.

**Action**
1. Create a second assistant ("Codey") with system prompt "Always reply
   with exactly the phrase: I am Codey."
2. Drive a run against the primary, then a run against Codey.
3. Verify Codey's output reflects its persona, primary's output is a
   normal answer.

**Success criteria**
- Both runs reach `completed`.
- Codey's output mentions "Codey" (case-insensitive).

## J18 — Per-assistant model override

Power user pins one assistant to a non-default model via
`ModelPolicy{mode:"assistant_override", preferred:"<provider_id>:<model_id>"}`.

**Action**
1. Add an alt provider with a second installed Ollama model.
2. `PUT /assistants/:id` with `model_policy` pointing to the alt
   `provider_id:model_id`.
3. Drive a run, verify completion.
4. Restore: clear `model_policy`, delete the alt provider.

**Success criteria**
- Run completes against the override.
- Restore leaves the assistant in its pre-J18 state.

## J19 — Event stream consistency

Every successful run emits `run.created → plan.proposed → step.started →
step.completed → run.completed` in order. The audit log surface needs
each event present.

**Action**
1. Drive a one-step run.
2. `GET /events?run_id=<id>&limit=50`.
3. Collect distinct event types.

**Success criteria**
- All five event types present.

---

## Out of scope (post-V1)

- Connector-driven runs (Telegram, Slack, Gmail). Each plugin has its
  own journey doc once the core plumbing is exercised here.
- Streaming token output during `llm.chat` (UI-only concern, doesn't
  affect state machines).
- Multi-user workspace sharing (single-user product).

---

## Test runner

`test/journeys/run.sh` drives every journey in this file in sequence,
each with its own ephemeral data, against a real `nomid` + real Ollama.
It writes a JSON summary to `test/journeys/results.json` plus a per-step
log so failures are diagnosable without re-running.
