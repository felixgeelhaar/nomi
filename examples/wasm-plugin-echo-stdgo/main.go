// Echo plugin (standard Go variant) — same shape as
// examples/wasm-plugin-echo but compiled with Go 1.24+'s native
// wasip1 reactor mode instead of TinyGo. Built with:
//
//	GOOS=wasip1 GOARCH=wasm go build \
//	    -buildmode=c-shared \
//	    -o internal/plugins/wasmhost/testdata/echo-stdgo.wasm \
//	    ./examples/wasm-plugin-echo-stdgo/
//
// Reactor mode (-buildmode=c-shared on wasip1) is what we want here:
// main runs once during _initialize for runtime setup, then the host
// drives execution by calling //go:wasmexport functions directly. No
// _start auto-run override needed (compare wasmhost.go's
// WithStartFunctions hack for the TinyGo variant).
//
// Spike purpose: compare against the TinyGo variant on
//
//   - binary size (TinyGo's reflection-free build is dramatically smaller)
//   - cold-start latency (Go runtime init vs TinyGo conservative GC init)
//   - ABI ergonomics (//go:wasmexport vs //export, GC pinning rules)
//
// Outcome lives in docs/notes (or wherever the lifecycle ADR points).

//go:build wasip1

package main

import (
	"encoding/json"
	"unsafe"
)

// Required for -buildmode=c-shared, but never auto-invoked: the wasip1
// reactor target only runs main during _initialize for runtime setup,
// then the host drives via the exported functions below.
func main() {}

//go:wasmimport env host_http_request
func hostHTTPRequest(methodPtr, methodLen, urlPtr, urlLen, bodyPtr, bodyLen uint32) uint64

// live keeps host-visible buffers reachable across host calls. Standard
// Go's GC is precise (not conservative like TinyGo's default) so we
// MUST hold a Go reference to anything whose pointer we hand to the
// host, otherwise the next collection will move/free it underneath us.
var live = map[uintptr][]byte{}

//go:wasmexport alloc
func alloc(size uint32) uint32 {
	if size == 0 {
		return 0
	}
	buf := make([]byte, size)
	ptr := uintptr(unsafe.Pointer(&buf[0]))
	live[ptr] = buf
	return uint32(ptr)
}

//go:wasmexport dealloc
func dealloc(ptr uint32, _ uint32) {
	delete(live, uintptr(ptr))
}

//go:wasmexport plugin_manifest
func pluginManifest() uint64 {
	body, _ := json.Marshal(map[string]any{
		"id":           "com.example.echo-stdgo",
		"name":         "Echo Plugin (standard Go)",
		"version":      "0.0.1",
		"author":       "Nomi WASM spike",
		"description":  "Standard-Go equivalent of the TinyGo echo plugin. Used to compare runtimes.",
		"capabilities": []string{"network.outgoing"},
		"contributes": map[string]any{
			"tools": []map[string]any{
				{
					"name":        "echo.echo",
					"capability":  "echo.echo",
					"description": "Returns its input verbatim. Used to validate the WASM round-trip.",
				},
				{
					"name":        "echo.fetch",
					"capability":  "network.outgoing",
					"description": "Performs an HTTP request via host_http_request.",
				},
			},
		},
		"requires": map[string]any{
			"network_allowlist": []string{"127.0.0.1", "*.example.test", "test.invalid"},
		},
	})
	return packResponse(body)
}

//go:wasmexport tool_execute
func toolExecute(ptr uint32, length uint32) uint64 {
	raw := readBytes(uintptr(ptr), length)
	var req struct {
		Name  string         `json:"name"`
		Input map[string]any `json:"input"`
	}
	if err := json.Unmarshal(raw, &req); err != nil {
		return errorResponse("invalid input JSON: " + err.Error())
	}
	switch req.Name {
	case "echo.fetch":
		return doFetch(req.Input)
	}
	body, _ := json.Marshal(map[string]any{
		"result": map[string]any{
			"echoed": req.Input,
			"tool":   req.Name,
		},
	})
	return packResponse(body)
}

func doFetch(input map[string]any) uint64 {
	method, _ := input["method"].(string)
	if method == "" {
		method = "GET"
	}
	urlStr, _ := input["url"].(string)
	if urlStr == "" {
		return errorResponse("echo.fetch: url is required")
	}
	body, _ := input["body"].(string)

	mPtr, mLen := writeStringIntoMemory(method)
	uPtr, uLen := writeStringIntoMemory(urlStr)
	bPtr, bLen := writeStringIntoMemory(body)

	packed := hostHTTPRequest(uint32(mPtr), mLen, uint32(uPtr), uLen, uint32(bPtr), bLen)
	if packed == 0 {
		return errorResponse("echo.fetch: host_http_request returned 0 (likely policy denied)")
	}
	respPtr := uintptr(packed >> 32)
	respLen := uint32(packed & 0xFFFFFFFF)
	respBytes := readBytes(respPtr, respLen)
	delete(live, respPtr)

	out, _ := json.Marshal(map[string]any{
		"result": map[string]any{
			"raw_response": string(respBytes),
		},
	})
	return packResponse(out)
}

func writeStringIntoMemory(s string) (uintptr, uint32) {
	if s == "" {
		return 0, 0
	}
	buf := make([]byte, len(s))
	copy(buf, s)
	ptr := uintptr(unsafe.Pointer(&buf[0]))
	live[ptr] = buf
	return ptr, uint32(len(s))
}

func readBytes(ptr uintptr, length uint32) []byte {
	if length == 0 {
		return nil
	}
	src := unsafe.Slice((*byte)(unsafe.Pointer(ptr)), length)
	out := make([]byte, length)
	copy(out, src)
	return out
}

func packResponse(body []byte) uint64 {
	if len(body) == 0 {
		return 0
	}
	buf := make([]byte, len(body))
	copy(buf, body)
	ptr := uintptr(unsafe.Pointer(&buf[0]))
	live[ptr] = buf
	return (uint64(ptr) << 32) | uint64(uint32(len(body)))
}

func errorResponse(msg string) uint64 {
	body, _ := json.Marshal(map[string]any{"error": msg})
	return packResponse(body)
}
