# ADR 0003 — Plugin Transport Tiers

- **Status:** Accepted
- **Date:** 2026-04-26
- **Authors:** Felix Geelhaar
- **Builds on:** [ADR 0002 — Plugin Distribution & Lifecycle](./0002-plugin-distribution-lifecycle.md)

## Context

ADR 0002 picked WASM (wazero) as the sandbox for marketplace plugins and pinned a hand-rolled ABI: four exports (`alloc`, `dealloc`, `plugin_manifest`, `tool_execute`) with JSON payloads packed into linear memory and returned as `i64 = (ptr<<32 | len)`. That ABI works — every wasmhost test passes against it — but two questions kept resurfacing during the WASM spike:

1. **Should we standardize on a typed transport instead of hand-rolled JSON?** The lifecycle work needs five more host imports (`host_filesystem_read/write`, `host_command_exec`, `host_secrets_get`, eventually approval bridging). Each new import means a new untyped contract. gRPC was suggested as the alternative.
2. **Are we sure WASM is the right boundary for *every* plugin tier?** Some integrations the roadmap calls for — system menubar hooks, AppleScript, IMAP polling, Telegram long-poll — need real OS access that the WASI sandbox can't easily express. Today they live as in-tree Go code in `internal/connectors/`. That works for first-party but doesn't generalize.

We also have grounded numbers now from the standard-Go vs TinyGo spike (see `internal/plugins/wasmhost/bench_compare_test.go`):

| metric | TinyGo | std Go (wasip1 reactor) |
|---|---|---|
| binary size | 418 KB | 3.34 MB (8.0×) |
| cold start | 117 ms | 484 ms (4.1×) |
| per-call (`echo.echo`) | 20.6 µs | 25.8 µs |

For comparison: the cheapest gRPC-over-loopback round trip on the same hardware is ~50–100 µs. **In-process WASM beats the lightest gRPC path by 2–5×** — switching the marketplace tier to gRPC would be a regression.

This ADR pins down which transport each plugin tier uses, and the migration path for moving toward a typed contract without abandoning in-process speed.

## Decision

**Three transport tiers, one per distribution mode.** Each tier is the right answer for its constraints — none is a universal default.

| tier (from ADR 0002) | transport | typed contract | runtime cost | when |
|---|---|---|---|---|
| **system** | direct Go function calls | Go interfaces (`tools.Tool`, `connectors.Connector`) | ~0 µs | first-party plugins compiled into `nomid` |
| **marketplace** | in-process WASM ABI | hand-rolled JSON today → **WASM Component Model + WIT** (post-V1) | ~20 µs/call | sandboxed third-party plugins shipped as `.wasm` bundles |
| **out-of-process (future)** | gRPC over Unix domain socket | `.proto` files, generated bindings | ~50–100 µs/call | non-Go plugins that need real OS access (IMAP, AppleScript, native UI) |

### 1. System tier — keep it direct

Stays as it is today: `tools.Registry.Register(tool)` with `tool.Execute(ctx, input)`. No transport layer, no serialization. The whole point of the system tier is that we trust the code — paying transport cost would be ceremony without benefit.

### 2. Marketplace tier — WASM ABI today, Component Model later

**v1: keep the JSON-over-linear-memory ABI as defined in `internal/plugins/wasmhost/wasmhost.go`.** It works, it's understood, and the spike numbers say it's fast enough. Adding the remaining host imports (lifecycle-04 onward) extends the same ABI rather than introducing a parallel one.

**Post-V1: migrate to WASM Component Model with WIT interface files.** The same wazero runtime supports it (wazero added Component Model preview support in v1.7+). The migration buys us:

- **Compile-time signature checks.** Today a plugin can call `tool_execute` with a malformed JSON payload and we discover it at runtime. WIT-generated bindings make the host/guest signatures structurally typed in both Go and TinyGo.
- **No JSON marshal on hot path.** Component Model uses a typed memory ABI, not stringly-typed JSON. The spike's per-call `~20 µs` is mostly JSON encode/decode — a Component Model port could plausibly hit the low single-digit µs.
- **Multi-language fan-out.** WIT bindings exist for Rust, Python, JS, .NET. Same plugin contract across runtimes — relevant once we have plugin authors who don't write Go.

**Migration is not blocking V1.** The WIT toolchain (`wit-bindgen`) is still rough on the TinyGo side as of late 2025 / early 2026, and we don't have a plugin author asking for typed bindings yet. Document the path; revisit when the friction is paid back by an actual user need.

### 3. Out-of-process tier — gRPC over UDS, when we need it

For plugins that genuinely cannot run inside the WASM sandbox (need POSIX networking, FFI, native menubar, AppleScript, etc.), the future answer is **a child process the daemon spawns and talks to over a Unix domain socket using gRPC**, with the `.proto` definitions versioned alongside the host's plugin contract.

**This tier doesn't exist yet.** Today, the integrations that need real OS access (Telegram long-poll, future Email IMAP) live as system-tier Go code. That's fine for first-party plugins authored by us. The out-of-process tier becomes relevant when:

- A non-Go plugin author wants to ship a Python/Node integration, AND
- The integration genuinely needs OS access WASI can't give it

Until both of those are true, we leave this tier on the spec roadmap and don't build it. When we do build it, gRPC is the right choice because: (a) UDS gives us the same ~50–100 µs RTT as loopback TCP without exposing a port, (b) `.proto` files give us the typed contract Component Model gives the WASM tier, (c) language SDKs are mature for every plugin language we'd care about, (d) the subprocess can be `unshare`d / `Sandbox`ed at the OS level since it's a real process.

We **do not** want to use gRPC for the marketplace tier even though it's tempting for symmetry. The WASM sandbox is what makes marketplace plugins safe to install from a third-party catalog with a click; promoting them to subprocesses would force every marketplace plugin author to reason about OS-level sandboxing, which is exactly the cliff WASM was chosen to avoid.

### 4. Standard Go vs TinyGo for marketplace WASM

The spike confirmed TinyGo is dramatically smaller (8×) and faster to cold-start (4×) than standard Go's wasip1 reactor mode. **TinyGo remains the canonical and recommended toolchain for marketplace plugins**, as ADR 0002 §2 already states.

Standard Go is **allowed but not promoted**: the loader handles both with a one-line branch (`_initialize` for reactor modules vs the existing `WithStartFunctions()` override for TinyGo command modules; see `loadForBench` in `bench_compare_test.go` for the prototype). A plugin author who needs `net/http`, generics-heavy libraries, or full reflection can ship a 3 MB bundle and pay the 484 ms install latency with eyes open. The marketplace UI surfaces bundle size and toolchain on the install dialog so users see the trade-off.

## Consequences

### Positive

- **No transport switch needed for V1.** The hand-rolled WASM ABI works, the numbers justify it, and adding the remaining gated imports (lifecycle-04+) doesn't require redesign.
- **Decisions are scoped to tiers.** "Should we use gRPC?" stops being a global question; the answer is "for the out-of-process tier when it lands; not for marketplace WASM."
- **Future migration path is named.** Component Model + WIT is the typed-contract path for marketplace plugins; gRPC + `.proto` is the path for out-of-process. Both are pinned in writing so they don't keep being rediscovered.
- **TinyGo stays the canonical toolchain** with bench numbers backing the choice rather than vibes.

### Negative

- **JSON ABI is hand-rolled and untyped.** Mistakes in payload shape are runtime failures, not compile errors. Mitigation: keep the host-side decoding strict and error-loud; document each export+import in the wasmhost package comment.
- **Standard Go support is opt-in but not aggressively pushed.** Plugin authors who reach for it pay 8× bundle size; we accept this rather than hide the option, because forcing TinyGo on someone who needs full reflection is worse than letting them choose.
- **Out-of-process tier is deferred indefinitely.** If a plugin author shows up tomorrow with a Python integration that needs IMAP, we tell them "wait" or "rewrite as TinyGo" or "we'll ship the OOP tier sooner than planned." That's a real product risk and we accept it because building the tier on spec is wasted work.

### Neutral

- **No code changes required by this ADR.** The hand-rolled WASM ABI is already the implementation; this document just pins it as the v1 transport for the marketplace tier rather than a temporary expedient. Component Model migration is post-V1; out-of-process tier is unbuilt.

## Rejected alternatives

- **gRPC everywhere.** Rejected because in-process WASM is 2–5× faster than gRPC's cheapest loopback path, and the marketplace tier's whole appeal is "click install on a sandboxed bundle, no subprocess management" — gRPC forces subprocess management on every plugin author.
- **WASM Component Model now.** Considered. Wazero supports it in preview, but the TinyGo `wit-bindgen` story is still rough and we have no plugin author asking for typed bindings. The hand-rolled ABI is good enough for V1; we migrate when the migration cost pays back. Documented as the next-step transport for the marketplace tier.
- **Plugin runtime auto-detection.** Considered building a loader that sniffs whether a `.wasm` is a TinyGo command module or a stdgo reactor and adapts. Decided against: the install dialog should make the toolchain visible to the user (it correlates with bundle size and behavior), and one explicit branch in the loader is simpler than runtime sniffing.
- **Drop std Go support entirely.** Considered. Rejected because the loader cost is one branch and the choice belongs to the plugin author, not us. We just default the docs and tooling to TinyGo.

## Open questions

- **When does Component Model migration trigger?** No fixed date. Triggers: (a) wit-bindgen-tinygo reaches stable, (b) a plugin author asks for typed bindings, (c) we hit a JSON-related bug serious enough that strict typing would have caught it. Whichever comes first.
- **Out-of-process tier shape.** When we eventually build it, exact details of process supervision (do we use systemd-style restart policies? a watchdog inside `nomid`?), socket path conventions, and capability mapping (a subprocess plugin presumably can't *use* the WASM host imports — does it get a parallel gRPC API?) all need their own ADR. Defer until we have a real first user.
- **Standard-Go bundle size mitigation.** If std-Go plugins become more common than expected, we could explore wasm-opt + gzip on bundle download (a 3 MB std-Go binary gzips to ~700 KB, narrowing the gap to TinyGo). Not worth the build-pipeline complexity until we see usage.

## Next step

Lifecycle work resumes against the existing hand-rolled ABI. The spike artifacts (`examples/wasm-plugin-echo-stdgo/`, `internal/plugins/wasmhost/bench_compare_test.go`, `make wasm-echo-stdgo`, `make wasm-bench`) stay in tree as the basis for any future re-evaluation.
