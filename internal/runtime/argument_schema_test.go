package runtime

import (
	"strings"
	"testing"
)

func TestValidatePlannerArguments(t *testing.T) {
	cases := []struct {
		name    string
		tool    string
		args    map[string]interface{}
		wantErr string
	}{
		{name: "llm.chat empty is fine", tool: "llm.chat", args: nil},
		{name: "llm.chat with prompt", tool: "llm.chat", args: map[string]interface{}{"prompt": "hi"}},
		{name: "llm.chat unknown field", tool: "llm.chat", args: map[string]interface{}{"system_prompt": "evil"}, wantErr: "unknown field"},
		{name: "llm.chat wrong type", tool: "llm.chat", args: map[string]interface{}{"prompt": 42}, wantErr: "must be string"},

		{name: "filesystem.read missing path", tool: "filesystem.read", args: nil, wantErr: "missing required field \"path\""},
		{name: "filesystem.read empty path", tool: "filesystem.read", args: map[string]interface{}{"path": ""}, wantErr: "empty"},
		{name: "filesystem.read ok", tool: "filesystem.read", args: map[string]interface{}{"path": "notes.md"}},

		{name: "filesystem.write needs both", tool: "filesystem.write", args: map[string]interface{}{"path": "x"}, wantErr: "missing required field \"content\""},
		{name: "filesystem.write ok", tool: "filesystem.write", args: map[string]interface{}{"path": "x", "content": "y"}},

		{name: "command.exec ok", tool: "command.exec", args: map[string]interface{}{"command": "ls"}},
		{name: "command.exec rejects allowed_binaries", tool: "command.exec", args: map[string]interface{}{"command": "ls", "allowed_binaries": "rm"}, wantErr: "unknown field"},

		{name: "filesystem.context takes nothing", tool: "filesystem.context", args: map[string]interface{}{"path": "x"}, wantErr: "unknown field"},

		{name: "unknown tool with args", tool: "what", args: map[string]interface{}{"x": 1}, wantErr: "no planner argument schema"},
		{name: "unknown tool no args", tool: "what", args: nil},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			err := validatePlannerArguments(c.tool, c.args)
			if c.wantErr != "" {
				if err == nil || !strings.Contains(err.Error(), c.wantErr) {
					t.Fatalf("validate(%s, %v) = %v, want error containing %q", c.tool, c.args, err, c.wantErr)
				}
				return
			}
			if err != nil {
				t.Fatalf("validate(%s, %v) unexpected error: %v", c.tool, c.args, err)
			}
		})
	}
}

func TestPlannerArgumentAllowlistDerivedFromSchema(t *testing.T) {
	// The allowlist is the surface that defends buildToolInput; verify it
	// matches the schema so a future refactor that touches one updates the
	// other.
	for tool, schema := range argumentSchemas {
		got := plannerArgumentAllowlist(tool)
		if len(got) != len(schema.allowed) {
			t.Errorf("%s: allowlist size %d, schema allowed size %d", tool, len(got), len(schema.allowed))
		}
		for k := range schema.allowed {
			if !got[k] {
				t.Errorf("%s: schema allows %q but allowlist does not", tool, k)
			}
		}
	}
}
