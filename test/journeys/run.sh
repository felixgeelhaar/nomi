#!/usr/bin/env bash
# End-to-end user-journey runner. Each journey defined in docs/user-journeys.md
# runs as a self-contained shell function against a real nomid + real Ollama.
# Pass: function returns 0. Fail: non-zero with a printed reason.
#
# Usage:
#   test/journeys/run.sh             # run all journeys
#   test/journeys/run.sh j1 j3       # run only the named journeys
#
# Environment overrides (optional):
#   NOMI_BIN          path to nomid binary (default: bin/nomid relative to repo)
#   OLLAMA_URL        default http://127.0.0.1:11434
#   OLLAMA_MODEL      default qwen2.5:14b
#   POLL_TIMEOUT_S    per-step poll budget, default 180
#   KEEP_DATA_DIR     1 to keep the temp data dir on success (debugging)

set -uo pipefail

# ---------- locate repo root ------------------------------------------------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

NOMI_BIN="${NOMI_BIN:-$REPO_ROOT/bin/nomid}"
OLLAMA_URL="${OLLAMA_URL:-http://127.0.0.1:11434}"
OLLAMA_MODEL="${OLLAMA_MODEL:-qwen2.5:14b}"
POLL_TIMEOUT_S="${POLL_TIMEOUT_S:-180}"
KEEP_DATA_DIR="${KEEP_DATA_DIR:-0}"

RESULTS_DIR="$REPO_ROOT/test/journeys/.results"
mkdir -p "$RESULTS_DIR"
SUMMARY_FILE="$RESULTS_DIR/summary.json"
LOG_FILE="$RESULTS_DIR/run.log"
: > "$LOG_FILE"

# ---------- ephemeral data dir ---------------------------------------------
DATA_DIR="$(mktemp -d -t nomi-journeys-XXXXXX)"
WORKSPACE="$DATA_DIR/workspace"
mkdir -p "$WORKSPACE"
NOMID_PORT="$(awk 'BEGIN{srand(); print 18080 + int(rand()*1000)}')"
NOMID_HOST="127.0.0.1:$NOMID_PORT"
NOMID_URL="http://$NOMID_HOST"
NOMID_PID=""

cleanup() {
    if [ -n "$NOMID_PID" ] && kill -0 "$NOMID_PID" 2>/dev/null; then
        kill "$NOMID_PID" 2>/dev/null || true
        wait "$NOMID_PID" 2>/dev/null || true
    fi
    if [ "$KEEP_DATA_DIR" != "1" ]; then
        rm -rf "$DATA_DIR"
    else
        printf "kept data dir: %s\n" "$DATA_DIR"
    fi
}
trap cleanup EXIT INT TERM

# log writes to stderr (and the log file) so any function that also returns a
# value via stdout — drive_run, api_ok — doesn't have its output polluted by
# diagnostic lines when captured into a `$()`.
log() { printf "%s %s\n" "$(date +%H:%M:%S)" "$*" | tee -a "$LOG_FILE" 1>&2; }
fail() { log "FAIL: $*"; return 1; }

# ---------- preflight ------------------------------------------------------
preflight() {
    if [ ! -x "$NOMI_BIN" ]; then
        fail "nomid binary not found at $NOMI_BIN; run 'make build' first"
        return 1
    fi
    if ! command -v jq >/dev/null; then
        fail "jq required (brew install jq)"; return 1
    fi
    if ! command -v sqlite3 >/dev/null; then
        fail "sqlite3 required"; return 1
    fi
    local code
    code=$(curl -s -o /dev/null -w "%{http_code}" -m 5 "$OLLAMA_URL/api/tags")
    if [ "$code" != "200" ]; then
        fail "Ollama not reachable at $OLLAMA_URL (got $code). Start it with 'ollama serve'."
        return 1
    fi
    if ! curl -s "$OLLAMA_URL/api/tags" | jq -e ".models[] | select(.name == \"$OLLAMA_MODEL\")" >/dev/null; then
        fail "Ollama model $OLLAMA_MODEL not installed. Try: ollama pull $OLLAMA_MODEL"
        return 1
    fi
    log "preflight ok (ollama $OLLAMA_MODEL)"
}

# ---------- start nomid against the temp dir -------------------------------
start_nomid() {
    log "starting nomid on $NOMID_HOST (data: $DATA_DIR)"
    NOMI_DATA_DIR="$DATA_DIR" \
    NOMI_API_PORT="$NOMID_PORT" \
        "$NOMI_BIN" >"$DATA_DIR/nomid.log" 2>&1 &
    NOMID_PID=$!
    # Locate token: nomid writes it under the configured app-data dir. Some
    # builds honour NOMI_DATA_DIR for everything; older code paths still use
    # the OS app-data dir. We resolve at first /health success.
    local token=""
    for _ in $(seq 1 30); do
        sleep 0.5
        if [ -z "$token" ] && [ -f "$DATA_DIR/auth.token" ]; then
            token="$(cat "$DATA_DIR/auth.token")"
        fi
        if [ -z "$token" ] && [ -f "$HOME/Library/Application Support/Nomi/auth.token" ]; then
            token="$(cat "$HOME/Library/Application Support/Nomi/auth.token")"
        fi
        if [ -n "$token" ] && curl -s -o /dev/null -m 1 -w "%{http_code}" -H "Authorization: Bearer $token" "$NOMID_URL/health" | grep -q '^200$'; then
            export NOMI_TOKEN="$token"
            log "nomid up (pid $NOMID_PID)"
            return 0
        fi
    done
    fail "nomid did not become healthy in 15s"
    log "--- nomid log tail ---"
    tail -50 "$DATA_DIR/nomid.log" | tee -a "$LOG_FILE"
    return 1
}

# ---------- API helpers ----------------------------------------------------
api() {
    local method="$1"; shift
    local path="$1"; shift
    local body="${1:-}"
    if [ -n "$body" ]; then
        curl -sS -m 30 -X "$method" \
            -H "Authorization: Bearer $NOMI_TOKEN" \
            -H "Content-Type: application/json" \
            -d "$body" \
            -w "\n__HTTP__%{http_code}" \
            "$NOMID_URL$path"
    else
        curl -sS -m 30 -X "$method" \
            -H "Authorization: Bearer $NOMI_TOKEN" \
            -w "\n__HTTP__%{http_code}" \
            "$NOMID_URL$path"
    fi
}

api_ok() {
    local resp
    resp="$(api "$@")" || return $?
    local code body
    code="$(printf "%s" "$resp" | awk -F'__HTTP__' '/__HTTP__/{print $2}' | tail -1)"
    body="$(printf "%s" "$resp" | sed '/__HTTP__/d')"
    if [[ ! "$code" =~ ^2 ]]; then
        log "api $1 $2 → $code: $body"
        return 1
    fi
    printf "%s" "$body"
}

api_status() {
    local resp
    resp="$(api "$@")"
    printf "%s" "$resp" | awk -F'__HTTP__' '/__HTTP__/{print $2}' | tail -1
}

await_status() {
    local run_id="$1"; shift
    local terminal_re="$1"; shift
    local on_state_cb="${1:-}"
    local deadline=$(( $(date +%s) + POLL_TIMEOUT_S ))
    while [ "$(date +%s)" -lt "$deadline" ]; do
        local body status
        body="$(api_ok GET "/runs/$run_id")" || return 1
        status="$(printf "%s" "$body" | jq -r '.run.status')"
        if [ -n "$on_state_cb" ]; then
            "$on_state_cb" "$run_id" "$status" "$body" || return 2
        fi
        if [[ "$status" =~ $terminal_re ]]; then
            printf "%s" "$status"
            return 0
        fi
        sleep 2
    done
    fail "run $run_id stuck in non-terminal state past ${POLL_TIMEOUT_S}s"
    return 1
}

# Convenience: drive a run from creation to terminal, auto-approving plan
# and any awaiting_approval prompts.
drive_run() {
    local goal="$1"
    local assistant_id="$2"
    local run_id
    run_id="$(api_ok POST "/runs" "$(jq -nc --arg g "$goal" --arg a "$assistant_id" '{goal:$g, assistant_id:$a}')" | jq -r '.id')"
    log "  run $run_id created"
    await_status "$run_id" '^(completed|failed|cancelled)$' drive_callback >/dev/null
    local rc=$?
    printf "%s" "$run_id"
    return $rc
}

drive_callback() {
    local run_id="$1" status="$2" body="$3"
    case "$status" in
      plan_review)
        api_ok POST "/runs/$run_id/plan/approve" "{}" >/dev/null
        ;;
      awaiting_approval)
        local approval_id
        approval_id="$(api_ok GET "/approvals" | jq -r --arg r "$run_id" '.approvals[] | select(.run_id==$r and .status=="pending") | .id' | head -1)"
        if [ -n "$approval_id" ]; then
            api_ok POST "/approvals/$approval_id/resolve" '{"approved":true}' >/dev/null
        fi
        ;;
    esac
    return 0
}

# ---------- assertion helpers ---------------------------------------------
assert_eq()      { [ "$1" = "$2" ] || fail "expected '$2' got '$1'"; }
assert_ne()      { [ "$1" != "$2" ] || fail "did not expect '$2'"; }
assert_contains() { printf "%s" "$1" | grep -qE "$2" || fail "expected pattern '$2' in '$1'"; }
assert_file_exists(){ [ -f "$1" ] || fail "file missing: $1"; }

# ===========================================================================
# Journeys
# ===========================================================================

journey_j1() {
    log "J1 first run"
    local body
    body="$(api_ok GET "/settings/onboarding-complete")" || return 1
    assert_eq "$(printf "%s" "$body" | jq -r '.complete')" "false" || return 1

    PROVIDER_ID="$(api_ok POST "/provider-profiles" "$(jq -nc --arg url "$OLLAMA_URL" --arg m "$OLLAMA_MODEL" \
        '{name:"Ollama (Local)", type:"local", endpoint:$url, model_ids:[$m], enabled:true}')" \
        | jq -r '.id')"
    [ -n "$PROVIDER_ID" ] || { fail "no provider id"; return 1; }
    api_ok PUT "/settings/llm-default" "$(jq -nc --arg p "$PROVIDER_ID" --arg m "$OLLAMA_MODEL" '{provider_id:$p, model_id:$m}')" >/dev/null

    local templates
    templates="$(api_ok GET "/assistants/templates")" || return 1
    local template
    template="$(printf "%s" "$templates" | jq -c '.templates[] | select(.template_id=="research-assistant")' | head -1)"
    [ -n "$template" ] || { fail "no research-assistant template"; return 1; }

    ASSISTANT_BODY="$(printf "%s" "$template" | jq -c \
        --arg ws "$WORKSPACE" \
        '{template_id, name, tagline, role, best_for, not_for, suggested_model, system_prompt,
          channels, channel_configs, capabilities,
          contexts: [{type:"folder", path:$ws}],
          memory_policy, permission_policy}')"
    ASSISTANT_ID="$(api_ok POST "/assistants" "$ASSISTANT_BODY" | jq -r '.id')"
    [ -n "$ASSISTANT_ID" ] || { fail "no assistant id"; return 1; }

    api_ok PUT "/settings/onboarding-complete" '{"complete": true}' >/dev/null

    # Verify endpoint normalization auto-appended /v1.
    body="$(api_ok GET "/provider-profiles/$PROVIDER_ID")"
    assert_contains "$(printf "%s" "$body" | jq -r '.endpoint')" "/v1$" || return 1

    # Verify safety profile default is balanced.
    body="$(api_ok GET "/settings/safety-profile")"
    assert_eq "$(printf "%s" "$body" | jq -r '.profile')" "balanced" || return 1

    log "J1 ok (provider=$PROVIDER_ID assistant=$ASSISTANT_ID)"
}

journey_j2() {
    log "J2 casual Q&A"
    local run_id status body
    run_id="$(drive_run "Reply with a single word: pong" "$ASSISTANT_ID")"
    [ $? -eq 0 ] || return 1
    body="$(api_ok GET "/runs/$run_id")" || return 1
    status="$(printf "%s" "$body" | jq -r '.run.status')"
    assert_eq "$status" "completed" || { log "$body"; return 1; }
    local plan_tool
    plan_tool="$(printf "%s" "$body" | jq -r '.plan.steps[0].expected_tool')"
    assert_eq "$plan_tool" "llm.chat" || return 1
    local out
    out="$(printf "%s" "$body" | jq -r '.steps[0].output')"
    [ -n "$out" ] || { fail "empty step output"; return 1; }
    log "J2 ok (output: ${out:0:60}…)"
}

journey_j3() {
    log "J3 file write w/ approval"
    rm -f "$WORKSPACE/hello.txt"
    local run_id status body
    run_id="$(drive_run "Create a file at hello.txt with the contents: hello world" "$ASSISTANT_ID")"
    [ $? -eq 0 ] || return 1
    body="$(api_ok GET "/runs/$run_id")" || return 1
    status="$(printf "%s" "$body" | jq -r '.run.status')"
    assert_eq "$status" "completed" || { log "$body"; return 1; }
    local has_write
    has_write="$(printf "%s" "$body" | jq '[.plan.steps[] | select(.expected_tool=="filesystem.write")] | length')"
    [ "$has_write" -ge 1 ] || { fail "plan has no filesystem.write step"; return 1; }
    assert_file_exists "$WORKSPACE/hello.txt" || return 1
    grep -q "hello world" "$WORKSPACE/hello.txt" || { fail "file content wrong: $(cat "$WORKSPACE/hello.txt")"; return 1; }
    J3_RUN_ID="$run_id"
    log "J3 ok"
}

journey_j4() {
    log "J4 read+summarize"
    cat > "$WORKSPACE/notes.md" <<'EOF'
The capital of France is Paris.
The capital of Japan is Tokyo.
The capital of Brazil is Brasilia.
EOF
    local run_id body status
    run_id="$(drive_run "Read notes.md and reply with the capital of Japan only" "$ASSISTANT_ID")"
    [ $? -eq 0 ] || return 1
    body="$(api_ok GET "/runs/$run_id")" || return 1
    status="$(printf "%s" "$body" | jq -r '.run.status')"
    assert_eq "$status" "completed" || { log "$body"; return 1; }
    local has_read
    has_read="$(printf "%s" "$body" | jq '[.plan.steps[] | select(.expected_tool=="filesystem.read")] | length')"
    [ "$has_read" -ge 1 ] || { fail "plan has no filesystem.read step"; return 1; }
    log "J4 ok"
}

journey_j5() {
    log "J5 plan edit"
    local run_id body status v0 v1
    run_id="$(api_ok POST "/runs" "$(jq -nc --arg a "$ASSISTANT_ID" '{goal:"Reply hello, then reply world", assistant_id:$a}')" | jq -r '.id')"
    await_status "$run_id" '^plan_review$' >/dev/null || return 1
    body="$(api_ok GET "/runs/$run_id")"
    v0="$(printf "%s" "$body" | jq -r '.plan.version')"
    local first_step
    first_step="$(printf "%s" "$body" | jq -c '.plan.steps[0]')"
    api_ok POST "/runs/$run_id/plan/edit" "$(jq -nc --argjson s "$first_step" '{steps:[$s]}')" >/dev/null
    body="$(api_ok GET "/runs/$run_id")"
    v1="$(printf "%s" "$body" | jq -r '.plan.version')"
    [ "$v1" -gt "$v0" ] || { fail "plan version did not increment ($v0 → $v1)"; return 1; }
    api_ok POST "/runs/$run_id/plan/approve" "{}" >/dev/null
    await_status "$run_id" '^(completed|failed|cancelled)$' drive_callback >/dev/null || return 1
    body="$(api_ok GET "/runs/$run_id")"
    status="$(printf "%s" "$body" | jq -r '.run.status')"
    assert_eq "$status" "completed" || return 1
    local exec_count
    exec_count="$(printf "%s" "$body" | jq '.steps | length')"
    [ "$exec_count" -eq 1 ] || { fail "edited plan should yield 1 step, got $exec_count"; return 1; }
    log "J5 ok (plan v$v0 → v$v1)"
}

journey_j6() {
    log "J6 branching"
    [ -n "${J3_RUN_ID:-}" ] || { log "J6 skipped (J3 must run first)"; return 0; }
    local body step_id new_run_id
    body="$(api_ok GET "/runs/$J3_RUN_ID")"
    step_id="$(printf "%s" "$body" | jq -r '.plan.steps[0].id')"
    # Fork response wraps the child run under a "run" key; don't read .id
    # off the envelope.
    new_run_id="$(api_ok POST "/runs/$J3_RUN_ID/fork" "$(jq -nc --arg s "$step_id" '{step_id:$s}')" | jq -r '.run.id')"
    [ -n "$new_run_id" ] && [ "$new_run_id" != "null" ] || { fail "fork returned no id"; return 1; }
    body="$(api_ok GET "/runs/$new_run_id")"
    assert_eq "$(printf "%s" "$body" | jq -r '.run.run_parent_id')" "$J3_RUN_ID" || return 1
    log "J6 ok (fork=$new_run_id)"
}

journey_j7() {
    log "J7 pause/resume"
    local run_id body status
    run_id="$(api_ok POST "/runs" "$(jq -nc --arg a "$ASSISTANT_ID" '{goal:"Reply with the digit 1, then the digit 2", assistant_id:$a}')" | jq -r '.id')"
    await_status "$run_id" '^plan_review$' >/dev/null || return 1
    api_ok POST "/runs/$run_id/plan/approve" "{}" >/dev/null
    # Race to pause before completion. Worst case the run already finished
    # — that's a pass-through, just verify pause+resume don't 500.
    sleep 1
    api POST "/runs/$run_id/pause" "" >/dev/null || true
    sleep 1
    api POST "/runs/$run_id/resume" "" >/dev/null || true
    await_status "$run_id" '^(completed|failed|cancelled)$' drive_callback >/dev/null || return 1
    body="$(api_ok GET "/runs/$run_id")"
    status="$(printf "%s" "$body" | jq -r '.run.status')"
    [[ "$status" =~ ^(completed|failed)$ ]] || { fail "pause/resume left run in $status"; return 1; }
    log "J7 ok ($status)"
}

journey_j8() {
    log "J8 memory persistence"
    api_ok POST "/memory" "$(jq -nc --arg a "$ASSISTANT_ID" '{assistant_id:$a, scope:"preferences", content:"Always answer in lowercase"}')" >/dev/null
    local run_id
    run_id="$(drive_run "What is 2+2?" "$ASSISTANT_ID")"
    [ $? -eq 0 ] || return 1
    # The list endpoint scopes its results: querying without `scope=` returns
    # workspace+profile, NOT preferences. Verify each scope independently.
    local pref_body pref_count
    pref_body="$(api_ok GET "/memory?scope=preferences")"
    pref_count="$(printf "%s" "$pref_body" | jq '.memories | length')"
    [ "$pref_count" -ge 1 ] || { fail "preferences entry missing"; return 1; }
    local ws_body ws_count
    ws_body="$(api_ok GET "/memory?scope=workspace")"
    ws_count="$(printf "%s" "$ws_body" | jq '.memories | length')"
    [ "$ws_count" -ge 1 ] || { fail "workspace memory not auto-saved"; return 1; }
    log "J8 ok (preferences=$pref_count, workspace=$ws_count)"
}

journey_j9() {
    log "J9 late policy deny (TOCTOU)"
    rm -f "$WORKSPACE/blocked.txt"
    local run_id body status
    run_id="$(api_ok POST "/runs" "$(jq -nc --arg a "$ASSISTANT_ID" '{goal:"Create a file at blocked.txt with the contents: should not exist", assistant_id:$a}')" | jq -r '.id')"
    # Drive plan approve then wait until awaiting_approval.
    await_status "$run_id" '^plan_review$' >/dev/null || return 1
    api_ok POST "/runs/$run_id/plan/approve" "{}" >/dev/null
    await_status "$run_id" '^awaiting_approval$' >/dev/null || return 1

    # Flip filesystem.write to deny on the live assistant.
    local snapshot
    snapshot="$(api_ok GET "/assistants/$ASSISTANT_ID")"
    local patched
    patched="$(printf "%s" "$snapshot" | jq -c '
        .permission_policy.rules |= map(
            if .capability=="filesystem.write" then .mode="deny" | del(.constraints) else . end
        )
    ' | jq -c '
        {name, role, system_prompt, channels, channel_configs, capabilities,
         contexts, memory_policy, permission_policy, model_policy,
         template_id, tagline, best_for, not_for, suggested_model}
    ')"
    api_ok PUT "/assistants/$ASSISTANT_ID" "$patched" >/dev/null

    # Now resolve the pending approval as approved; runtime should still deny.
    local approval_id
    approval_id="$(api_ok GET "/approvals" | jq -r --arg r "$run_id" '.approvals[] | select(.run_id==$r and .status=="pending") | .id' | head -1)"
    [ -n "$approval_id" ] || { fail "no pending approval"; return 1; }
    api_ok POST "/approvals/$approval_id/resolve" '{"approved":true}' >/dev/null

    await_status "$run_id" '^(completed|failed|cancelled)$' drive_callback >/dev/null || return 1
    body="$(api_ok GET "/runs/$run_id")"
    status="$(printf "%s" "$body" | jq -r '.run.status')"
    assert_eq "$status" "failed" || { log "TOCTOU close did not deny: status=$status"; return 1; }
    [ ! -f "$WORKSPACE/blocked.txt" ] || { fail "file written despite policy flip: $(cat "$WORKSPACE/blocked.txt")"; return 1; }

    # Restore policy so subsequent journeys keep working.
    local restored
    restored="$(printf "%s" "$snapshot" | jq -c '
        {name, role, system_prompt, channels, channel_configs, capabilities,
         contexts, memory_policy, permission_policy, model_policy,
         template_id, tagline, best_for, not_for, suggested_model}
    ')"
    api_ok PUT "/assistants/$ASSISTANT_ID" "$restored" >/dev/null
    log "J9 ok"
}

journey_j10() {
    log "J10 endpoint hardening"
    local bad
    for bad in 'file:///etc/passwd' 'javascript:alert(1)' 'gopher://x' 'localhost:11434' 'http://'; do
        local code
        code="$(api_status POST "/provider-profiles" "$(jq -nc --arg u "$bad" \
            '{name:"evil", type:"remote", endpoint:$u, model_ids:["x"], enabled:true}')")"
        if [ "$code" != "400" ]; then
            fail "$bad accepted with status $code (expected 400)"
            return 1
        fi
    done
    log "J10 ok"
}

journey_j11() {
    log "J11 audit export"
    local from to body
    from="$(date -u -v-1d +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || date -u -d '1 day ago' +%Y-%m-%dT%H:%M:%SZ)"
    to="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    body="$(api_ok GET "/audit/export?from=$from&to=$to")" || return 1
    [ -n "$body" ] || { fail "empty audit body"; return 1; }
    # Body should parse as JSON or NDJSON; either way it should mention a
    # known event type like run.created.
    assert_contains "$body" "run.created" || { fail "audit missing run.created"; return 1; }
    log "J11 ok"
}

journey_j12() {
    log "J12 provider rotation"
    # Pick a small, chat-capable Ollama model that's NOT the primary. Skip
    # embedding-only models (e.g. nomic-embed-text) since they can't serve
    # chat requests; rank in roughly increasing parameter count so the
    # journey time stays under the per-step budget.
    local installed
    installed=""
    local candidate
    for candidate in llama3.2:latest mistral:latest qwen3:8b deepseek-r1:8b gemma3:12b; do
        if curl -s "$OLLAMA_URL/api/tags" | jq -e --arg m "$candidate" '.models[]|select(.name==$m)' >/dev/null && [ "$candidate" != "$OLLAMA_MODEL" ]; then
            installed="$candidate"; break
        fi
    done
    if [ -z "$installed" ]; then
        log "J12 skipped (only one Ollama model installed)"
        return 0
    fi
    local p2
    p2="$(api_ok POST "/provider-profiles" "$(jq -nc --arg url "$OLLAMA_URL" --arg m "$installed" \
        '{name:"Ollama Alt", type:"local", endpoint:$url, model_ids:[$m], enabled:true}')" | jq -r '.id')"
    api_ok PUT "/settings/llm-default" "$(jq -nc --arg p "$p2" --arg m "$installed" '{provider_id:$p, model_id:$m}')" >/dev/null

    local run_id status
    run_id="$(drive_run "Reply with a single word: ok" "$ASSISTANT_ID")"
    [ $? -eq 0 ] || return 1
    status="$(api_ok GET "/runs/$run_id" | jq -r '.run.status')"
    assert_eq "$status" "completed" || return 1

    # restore primary
    api_ok PUT "/settings/llm-default" "$(jq -nc --arg p "$PROVIDER_ID" --arg m "$OLLAMA_MODEL" '{provider_id:$p, model_id:$m}')" >/dev/null
    log "J12 ok (alt=$installed)"
}

# ===========================================================================
# Advanced journeys — power-user configuration & edit flows
# ===========================================================================

# J13 — manual provider config bypassing the wizard. Power user adds a
# second profile, edits its model list, deletes it again, all via API.
journey_j13() {
    log "J13 manual provider CRUD"
    local create_body new_id list_body update_body endpoint
    create_body="$(api_ok POST "/provider-profiles" "$(jq -nc --arg url "$OLLAMA_URL" --arg m "$OLLAMA_MODEL" \
        '{name:"Ollama Manual", type:"local", endpoint:$url, model_ids:[$m], enabled:true}')")"
    new_id="$(printf "%s" "$create_body" | jq -r '.id')"
    [ -n "$new_id" ] && [ "$new_id" != "null" ] || { fail "create returned no id"; return 1; }
    endpoint="$(printf "%s" "$create_body" | jq -r '.endpoint')"
    assert_contains "$endpoint" "/v1$" || return 1

    list_body="$(api_ok GET "/provider-profiles")"
    [ "$(printf "%s" "$list_body" | jq --arg id "$new_id" '[.profiles[] | select(.id==$id)] | length')" = "1" ] \
        || { fail "new profile missing from list"; return 1; }

    update_body="$(api_ok PUT "/provider-profiles/$new_id" "$(jq -nc --arg url "$OLLAMA_URL" --arg m "$OLLAMA_MODEL" \
        '{name:"Ollama Renamed", type:"local", endpoint:$url, model_ids:[$m, "qwen2.5:32b"], enabled:true}')")"
    [ "$(printf "%s" "$update_body" | jq -r '.name')" = "Ollama Renamed" ] || { fail "update name not persisted"; return 1; }

    api_ok DELETE "/provider-profiles/$new_id" >/dev/null
    list_body="$(api_ok GET "/provider-profiles")"
    [ "$(printf "%s" "$list_body" | jq --arg id "$new_id" '[.profiles[] | select(.id==$id)] | length')" = "0" ] \
        || { fail "deleted profile still present"; return 1; }
    log "J13 ok"
}

# J14 — power user creates a fresh assistant from the Custom template,
# trims its capabilities, edits it once, deletes it. Verifies the
# assistant builder API surface end-to-end without reusing J1's
# wizard-spawned assistant.
journey_j14() {
    log "J14 custom assistant CRUD"
    local templates custom body new_id
    templates="$(api_ok GET "/assistants/templates")"
    custom="$(printf "%s" "$templates" | jq -c '.templates[] | select(.template_id=="custom")')"
    [ -n "$custom" ] || { fail "custom template missing"; return 1; }

    body="$(printf "%s" "$custom" | jq -c \
        --arg ws "$WORKSPACE" --arg name "Power User Bot" \
        '{template_id, name:$name, tagline, role, best_for, not_for, suggested_model,
          system_prompt: "You answer in lowercase only.",
          channels, channel_configs,
          capabilities: ["llm.chat", "filesystem.read"],
          contexts: [{type:"folder", path:$ws}],
          memory_policy,
          permission_policy: {
            rules: [
              {capability:"llm.chat", mode:"allow"},
              {capability:"filesystem.read", mode:"allow"}
            ]
          }
        }')"
    new_id="$(api_ok POST "/assistants" "$body" | jq -r '.id')"
    [ -n "$new_id" ] && [ "$new_id" != "null" ] || { fail "create returned no id"; return 1; }

    # Edit: rename + add filesystem.write rule (still confirm so safety holds).
    local snap patched
    snap="$(api_ok GET "/assistants/$new_id")"
    patched="$(printf "%s" "$snap" | jq -c '
        .name = "Power User Bot v2"
        | .capabilities += ["filesystem.write"]
        | .permission_policy.rules += [{capability:"filesystem.write", mode:"confirm"}]
    ' | jq -c '
        {name, role, system_prompt, channels, channel_configs, capabilities,
         contexts, memory_policy, permission_policy, model_policy,
         template_id, tagline, best_for, not_for, suggested_model}
    ')"
    api_ok PUT "/assistants/$new_id" "$patched" >/dev/null
    body="$(api_ok GET "/assistants/$new_id")"
    assert_eq "$(printf "%s" "$body" | jq -r '.name')" "Power User Bot v2" || return 1
    [ "$(printf "%s" "$body" | jq '.capabilities | length')" = "3" ] || { fail "capabilities not extended"; return 1; }

    api_ok DELETE "/assistants/$new_id" >/dev/null
    log "J14 ok"
}

# J15 — memory CRUD by hand. Create + list + search + delete entries
# across all three scopes; verify isolation between scopes.
journey_j15() {
    log "J15 memory CRUD"
    local pref_id ws_id prof_id
    pref_id="$(api_ok POST "/memory" "$(jq -nc --arg a "$ASSISTANT_ID" \
        '{assistant_id:$a, scope:"preferences", content:"prefer concise answers"}')" \
        | jq -r '.id')"
    ws_id="$(api_ok POST "/memory" "$(jq -nc --arg a "$ASSISTANT_ID" \
        '{assistant_id:$a, scope:"workspace", content:"the project root contains a docs folder"}')" \
        | jq -r '.id')"
    prof_id="$(api_ok POST "/memory" "$(jq -nc --arg a "$ASSISTANT_ID" \
        '{assistant_id:$a, scope:"profile", content:"user prefers German for documentation"}')" \
        | jq -r '.id')"
    [ -n "$pref_id" ] && [ -n "$ws_id" ] && [ -n "$prof_id" ] || { fail "create missing id(s)"; return 1; }

    # Each scope must list independently.
    [ "$(api_ok GET "/memory?scope=preferences" | jq '.memories | length')" -ge 1 ] || { fail "preferences not listed"; return 1; }
    [ "$(api_ok GET "/memory?scope=workspace" | jq --arg id "$ws_id" '[.memories[] | select(.id==$id)] | length')" = "1" ] \
        || { fail "workspace entry missing"; return 1; }
    [ "$(api_ok GET "/memory?scope=profile" | jq --arg id "$prof_id" '[.memories[] | select(.id==$id)] | length')" = "1" ] \
        || { fail "profile entry missing"; return 1; }

    # Search — content-substring lookup across the workspace+profile
    # default scope.
    local hits
    hits="$(api_ok GET "/memory?q=docs" | jq '.memories | length')"
    [ "$hits" -ge 1 ] || { fail "search missed docs entry"; return 1; }

    # Delete two of three; confirm third remains.
    api_ok DELETE "/memory/$ws_id" >/dev/null
    api_ok DELETE "/memory/$prof_id" >/dev/null
    [ "$(api_ok GET "/memory?scope=workspace" | jq --arg id "$ws_id" '[.memories[] | select(.id==$id)] | length')" = "0" ] \
        || { fail "workspace delete didn't take"; return 1; }
    [ "$(api_ok GET "/memory?scope=preferences" | jq --arg id "$pref_id" '[.memories[] | select(.id==$id)] | length')" = "1" ] \
        || { fail "preferences entry vanished after unrelated delete"; return 1; }
    log "J15 ok"
}

# J16 — power user toggles a built-in plugin off and back on, verifies
# state file persists across the request boundary.
journey_j16() {
    log "J16 plugin enable/disable"
    local plugins first_id state
    plugins="$(api_ok GET "/plugins")"
    # Plugins are wrapped: {plugins: [{manifest, state, ...}, ...]}.
    # Avoid touching the primary connector (telegram) so subsequent
    # journeys are isolated from the toggle.
    first_id="$(printf "%s" "$plugins" \
        | jq -r '[.plugins[] | select(.manifest.id != "telegram")][0].manifest.id // empty')"
    [ -n "$first_id" ] || { fail "no plugin to toggle"; return 1; }

    state="$(api_ok GET "/plugins/$first_id/state" | jq -r '.enabled')"
    local target=true
    [ "$state" = "true" ] && target=false
    api_ok PATCH "/plugins/$first_id/state" "$(jq -nc --argjson e "$target" '{enabled:$e}')" >/dev/null
    local now
    now="$(api_ok GET "/plugins/$first_id/state" | jq -r '.enabled')"
    assert_eq "$now" "$target" || { fail "toggle did not persist"; return 1; }
    # Restore so subsequent journeys don't regress.
    api_ok PATCH "/plugins/$first_id/state" "$(jq -nc --argjson e "$state" '{enabled:$e}')" >/dev/null
    log "J16 ok ($first_id $state -> $target -> $state)"
}

# J17 — multi-assistant routing. Create a second assistant with a
# distinct system prompt, run goals against each, verify outputs come
# from the right persona.
journey_j17() {
    log "J17 multi-assistant routing"
    local templates custom body codey_id
    templates="$(api_ok GET "/assistants/templates")"
    custom="$(printf "%s" "$templates" | jq -c '.templates[] | select(.template_id=="custom")')"
    body="$(printf "%s" "$custom" | jq -c \
        --arg ws "$WORKSPACE" --arg name "Codey" \
        '{template_id, name:$name, tagline, role, best_for, not_for, suggested_model,
          system_prompt: "Always reply with exactly the phrase: I am Codey.",
          channels, channel_configs,
          capabilities: ["llm.chat"],
          contexts: [{type:"folder", path:$ws}],
          memory_policy,
          permission_policy: { rules: [{capability:"llm.chat", mode:"allow"}] }
        }')"
    codey_id="$(api_ok POST "/assistants" "$body" | jq -r '.id')"
    [ -n "$codey_id" ] && [ "$codey_id" != "null" ] || { fail "create returned no id"; return 1; }

    local primary_run codey_run primary_out codey_out
    primary_run="$(drive_run "Reply with one word: ping" "$ASSISTANT_ID")"
    [ $? -eq 0 ] || return 1
    codey_run="$(drive_run "Reply" "$codey_id")"
    [ $? -eq 0 ] || return 1
    primary_out="$(api_ok GET "/runs/$primary_run" | jq -r '.steps[0].output // ""')"
    codey_out="$(api_ok GET "/runs/$codey_run" | jq -r '.steps[0].output // ""')"
    [ -n "$primary_out" ] || { fail "primary assistant produced no output"; return 1; }
    [ -n "$codey_out" ] || { fail "codey assistant produced no output"; return 1; }
    # Codey's persona is so narrow that any reasonable LLM with the
    # provided system prompt mentions "Codey" verbatim.
    printf "%s" "$codey_out" | grep -qi "codey" \
        || { fail "codey output didn't reflect persona: ${codey_out:0:160}"; return 1; }
    api_ok DELETE "/assistants/$codey_id" >/dev/null
    log "J17 ok"
}

# J18 — per-assistant model override. Power user pins a specific
# assistant to a non-default model; runs against it route through the
# pinned model regardless of the global default.
journey_j18() {
    log "J18 per-assistant model override"
    local installed
    installed="$(curl -s "$OLLAMA_URL/api/tags" | jq -r '.models[].name' \
        | grep -vE "^$OLLAMA_MODEL$|embed|nomic-" | head -1)"
    if [ -z "$installed" ]; then
        log "J18 skipped (no second installed Ollama model)"
        return 0
    fi
    # Add the alt provider to attach a model_policy override.
    local alt_provider
    alt_provider="$(api_ok POST "/provider-profiles" "$(jq -nc --arg url "$OLLAMA_URL" --arg m "$installed" \
        '{name:"Ollama Alt for J18", type:"local", endpoint:$url, model_ids:[$m], enabled:true}')" \
        | jq -r '.id')"

    local snap patched
    snap="$(api_ok GET "/assistants/$ASSISTANT_ID")"
    patched="$(printf "%s" "$snap" | jq -c \
        --arg p "$alt_provider" --arg m "$installed" \
        '. + {
            model_policy: {
                mode: "assistant_override",
                preferred: ($p + ":" + $m),
                allow_fallback: true
            }
        }' | jq -c '
        {name, role, system_prompt, channels, channel_configs, capabilities,
         contexts, memory_policy, permission_policy, model_policy,
         template_id, tagline, best_for, not_for, suggested_model}
    ')"
    api_ok PUT "/assistants/$ASSISTANT_ID" "$patched" >/dev/null

    local run_id status
    run_id="$(drive_run "Reply hi" "$ASSISTANT_ID")"
    [ $? -eq 0 ] || return 1
    status="$(api_ok GET "/runs/$run_id" | jq -r '.run.status')"
    assert_eq "$status" "completed" || return 1

    # Restore: remove model_policy override + drop the alt provider.
    snap="$(api_ok GET "/assistants/$ASSISTANT_ID")"
    patched="$(printf "%s" "$snap" | jq -c '. + {model_policy: null}' | jq -c '
        {name, role, system_prompt, channels, channel_configs, capabilities,
         contexts, memory_policy, permission_policy, model_policy,
         template_id, tagline, best_for, not_for, suggested_model}
    ')"
    api_ok PUT "/assistants/$ASSISTANT_ID" "$patched" >/dev/null
    api_ok DELETE "/provider-profiles/$alt_provider" >/dev/null
    log "J18 ok (override → $installed)"
}

# J19 — power user reads events stream and audit trail for a freshly
# completed run. Confirms run.created / plan.proposed / step.started /
# step.completed / run.completed all fire in order.
journey_j19() {
    log "J19 event stream consistency"
    local run_id body kinds
    run_id="$(drive_run "Reply with one word: ack" "$ASSISTANT_ID")"
    [ $? -eq 0 ] || return 1
    # Bump limit + filter step.streaming out: a single chat run emits
    # one streaming event per token, which can easily push 50+ entries
    # and shove the lifecycle events (run.created, plan.proposed) off
    # the bottom of a default-limit page.
    body="$(api_ok GET "/events?run_id=$run_id&limit=500")"
    kinds="$(printf "%s" "$body" | jq -r '.events[].type | select(. != "step.streaming")' | sort -u | tr '\n' ' ')"
    log "  emitted (non-streaming): $kinds"
    for required in run.created plan.proposed step.started step.completed run.completed; do
        printf "%s" "$kinds" | grep -q "$required" \
            || { fail "missing event $required in {$kinds}"; return 1; }
    done
    log "J19 ok"
}

# J20 — provider probe. Power user (or wizard) wants to know whether a
# provider is reachable and serves the requested model BEFORE the first
# chat that would otherwise 404. Verify both sides: a real Ollama
# endpoint reports reachable + the requested model, a typo'd model is
# reported as missing.
journey_j20() {
    log "J20 provider probe"
    local body
    body="$(api_ok POST "/provider-profiles/probe" "$(jq -nc --arg url "$OLLAMA_URL" --arg m "$OLLAMA_MODEL" \
        '{endpoint:$url, model_ids:[$m]}')")"
    [ "$(printf "%s" "$body" | jq -r '.reachable')" = "true" ] || { fail "ollama probe not reachable: $body"; return 1; }
    [ "$(printf "%s" "$body" | jq '.missing_requested | length')" = "0" ] \
        || { fail "expected no missing models: $body"; return 1; }

    local body2
    body2="$(api_ok POST "/provider-profiles/probe" "$(jq -nc --arg url "$OLLAMA_URL" \
        '{endpoint:$url, model_ids:["does-not-exist:0b"]}')")"
    [ "$(printf "%s" "$body2" | jq -r '.reachable')" = "true" ] || { fail "probe should be reachable for typo case"; return 1; }
    [ "$(printf "%s" "$body2" | jq -r '.missing_requested[0]')" = "does-not-exist:0b" ] \
        || { fail "expected missing entry for typo: $body2"; return 1; }

    # Bad scheme rejected at the same boundary as create.
    local code
    code="$(api_status POST "/provider-profiles/probe" '{"endpoint":"file:///etc/passwd"}')"
    [ "$code" = "400" ] || { fail "probe accepted bad scheme with $code"; return 1; }
    log "J20 ok"
}

# J21 — auth token rotation. Power user (or breach response) rotates the
# bearer token. Old token immediately invalid; new token works.
journey_j21() {
    log "J21 auth token rotation"
    local body new_token
    body="$(api_ok POST "/auth/rotate" "")" || return 1
    new_token="$(printf "%s" "$body" | jq -r '.token')"
    [ -n "$new_token" ] && [ "$new_token" != "null" ] || { fail "rotate returned no token"; return 1; }
    [ "$new_token" != "$NOMI_TOKEN" ] || { fail "new token equals old token"; return 1; }

    # Old token rejected.
    local code_old
    code_old="$(curl -s -m 5 -o /dev/null -w "%{http_code}" -H "Authorization: Bearer $NOMI_TOKEN" "$NOMID_URL/runs")"
    [ "$code_old" = "401" ] || { fail "old token still works (got $code_old)"; return 1; }

    # New token works. Swap into NOMI_TOKEN so subsequent journeys keep working.
    local code_new
    code_new="$(curl -s -m 5 -o /dev/null -w "%{http_code}" -H "Authorization: Bearer $new_token" "$NOMID_URL/runs")"
    [ "$code_new" = "200" ] || { fail "new token rejected (got $code_new)"; return 1; }
    export NOMI_TOKEN="$new_token"
    log "J21 ok"
}

# J22 — streaming llm.chat. A run that answers via llm.chat should emit
# at least one step.streaming event (incremental token delivery) in
# addition to step.started + step.completed. Verifies the wire-level
# contract; UI consumes the same events to render a live "thinking"
# stream.
journey_j22() {
    log "J22 streaming llm.chat"
    local run_id body kinds streamed
    run_id="$(drive_run "Reply with two words: hello there" "$ASSISTANT_ID")"
    [ $? -eq 0 ] || return 1
    body="$(api_ok GET "/events?run_id=$run_id&limit=200")"
    kinds="$(printf "%s" "$body" | jq -r '.events[].type' | sort -u | tr '\n' ' ')"
    streamed="$(printf "%s" "$body" | jq '[.events[] | select(.type=="step.streaming")] | length')"
    log "  emitted: $kinds (streaming events: $streamed)"
    [ "$streamed" -ge 1 ] || { fail "no step.streaming events emitted"; return 1; }
    log "J22 ok"
}

# ---------- main -----------------------------------------------------------
ALL_JOURNEYS=(j1 j2 j3 j4 j5 j6 j7 j8 j9 j10 j11 j12 j13 j14 j15 j16 j17 j18 j19 j20 j21 j22)

if [ $# -gt 0 ]; then
    SELECTED=("$@")
else
    SELECTED=("${ALL_JOURNEYS[@]}")
fi

preflight || exit 2
start_nomid || exit 2

declare -a results=()
overall=0
for j in "${SELECTED[@]}"; do
    fn="journey_$j"
    if ! declare -F "$fn" >/dev/null; then
        log "unknown journey: $j"
        results+=("\"$j\":\"unknown\"")
        overall=1
        continue
    fi
    start=$(date +%s)
    if "$fn"; then
        elapsed=$(( $(date +%s) - start ))
        results+=("\"$j\":{\"status\":\"pass\",\"seconds\":$elapsed}")
    else
        elapsed=$(( $(date +%s) - start ))
        results+=("\"$j\":{\"status\":\"fail\",\"seconds\":$elapsed}")
        overall=1
    fi
done

printf "{%s}\n" "$(IFS=,; echo "${results[*]}")" > "$SUMMARY_FILE"
log "summary written to $SUMMARY_FILE"
log "log file: $LOG_FILE"
exit "$overall"
