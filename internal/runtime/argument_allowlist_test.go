package runtime

import "testing"

func TestPlannerArgumentAllowlist(t *testing.T) {
	cases := []struct {
		tool      string
		allowed   []string
		forbidden []string
	}{
		{
			tool:      "llm.chat",
			allowed:   []string{"prompt"},
			forbidden: []string{"system_prompt", "workspace_root", "model"},
		},
		{
			tool:      "filesystem.read",
			allowed:   []string{"path"},
			forbidden: []string{"workspace_root", "max_bytes", "encoding"},
		},
		{
			tool:      "filesystem.write",
			allowed:   []string{"path", "content"},
			forbidden: []string{"workspace_root", "mode"},
		},
		{
			tool:      "filesystem.context",
			allowed:   nil,
			forbidden: []string{"path", "depth", "workspace_root"},
		},
		{
			tool:      "command.exec",
			allowed:   []string{"command"},
			forbidden: []string{"allowed_binaries", "cwd", "env", "timeout"},
		},
		{
			tool:      "unknown.tool",
			allowed:   nil,
			forbidden: []string{"anything"},
		},
	}
	for _, c := range cases {
		got := plannerArgumentAllowlist(c.tool)
		for _, k := range c.allowed {
			if !got[k] {
				t.Errorf("%s: expected %q allowed, got %v", c.tool, k, got)
			}
		}
		for _, k := range c.forbidden {
			if got[k] {
				t.Errorf("%s: expected %q forbidden but allowlist has it: %v", c.tool, k, got)
			}
		}
	}
}
