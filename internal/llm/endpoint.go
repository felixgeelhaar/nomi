package llm

import (
	"fmt"
	"net/url"
	"strings"
)

// NormalizeEndpoint validates a user-supplied provider endpoint URL and
// appends the OpenAI-compatible /v1 suffix when only a bare host was
// supplied (e.g. http://127.0.0.1:11434 for Ollama or
// http://127.0.0.1:1234 for LM Studio). The OpenAI-compat client speaks
// /chat/completions, so endpoints without a base path silently 404.
//
// Validation rules:
//   - empty input → ("", nil); callers decide whether emptiness is allowed.
//   - scheme must be http or https — file://, javascript:, gopher://, ...
//     are rejected outright; without this gate a compromised UI could
//     point the LLM client at the local filesystem or any other URI
//     scheme the daemon happens to reach.
//   - host must be present so the user catches typos at save time, not
//     on the first chat call.
//
// The function lives in the llm package because the /v1 + scheme rules
// are wire-format invariants of the OpenAI-compat adapter, not HTTP-layer
// concerns. The api package re-exposes it through its provider handlers.
func NormalizeEndpoint(raw string) (string, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return "", nil
	}
	u, err := url.Parse(raw)
	if err != nil {
		return "", fmt.Errorf("endpoint is not a valid URL: %w", err)
	}
	scheme := strings.ToLower(u.Scheme)
	if scheme != "http" && scheme != "https" {
		return "", fmt.Errorf("endpoint scheme must be http or https, got %q", u.Scheme)
	}
	if u.Host == "" {
		return "", fmt.Errorf("endpoint must include a host (e.g. http://localhost:11434)")
	}
	path := strings.TrimRight(u.Path, "/")
	if path == "" {
		u.Path = "/v1"
		return strings.TrimRight(u.String(), "/"), nil
	}
	return raw, nil
}
