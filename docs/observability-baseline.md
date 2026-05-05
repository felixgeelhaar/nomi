# Observability Baseline (V1 Hardening)

This baseline defines what we must observe to operate Nomi safely in beta.

## Logging Standard

- API logs are structured JSON lines.
- Every request includes `request_id` (from `X-Request-Id` or generated).
- Minimum fields:
  - `ts`, `request_id`, `method`, `path`, `route`, `status`, `latency_ms`, `client_ip`, `response_len`
- No request/response bodies in access logs (secrets safety).

## Core SLIs

Track these as first-class service indicators:

1. API availability
   - `% 2xx + 3xx responses` over total requests
2. API latency
   - p50/p95/p99 `latency_ms` per route group (`/runs`, `/plugins`, `/assistants`, `/events`)
3. Error rate
   - `% 5xx` globally and per route
4. Event stream reliability
   - active SSE streams, disconnect rate, reconnect rate
5. Plugin lifecycle reliability
   - install/update/uninstall success rate
   - plugin start/stop error count
6. Approval loop health
   - time from approval created -> resolved
7. Runtime throughput
   - run creation rate, completion rate, cancel/fail rate

## Top 10 Dashboard Panels

1. Requests/sec by route group
2. p95 latency by route group
3. 5xx rate by route
4. Auth failures (401) rate
5. SSE active clients + disconnect spikes
6. Plugin install/update/uninstall outcomes
7. Plugin start failure counts by plugin ID
8. Run state transitions (created/planning/executing/completed/failed)
9. Approval queue size + median resolve time
10. DB operation error rate (repository layer)

## Alert Baseline

- API 5xx rate > 2% for 5m
- p95 latency > 1500ms for 10m on core routes
- SSE disconnect rate spike > 3x baseline
- Plugin lifecycle failure rate > 10% for 10m
- Approval median resolve time > 10m (business-hours policy)

## Incident Playbooks (Initial)

### 1) API error spike
- Filter logs by `status >= 500`
- Group by `route`
- Correlate by `request_id` across logs
- Identify regression window via deploy commit/version

### 2) SSE instability
- Check disconnect/reconnect trend
- Validate daemon health and auth token rotation events
- Verify client retry behavior and Tauri IPC bridge status

### 3) Plugin lifecycle failures
- Check plugin ID with highest start/update failure counts
- Verify signing/catalog/store dependencies
- Validate plugin state row and latest transition events

## Rollout Notes

- This baseline is intentionally lightweight and file-log friendly.
- Next step is exporter wiring (Prometheus/OpenTelemetry) and SLO-backed alert routing.
