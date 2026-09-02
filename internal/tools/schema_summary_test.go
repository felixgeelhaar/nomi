package tools

import (
	"context"
	"testing"
)

func TestCompactSchemaSummary(t *testing.T) {
	got := CompactSchemaSummary(map[string]any{
		"type": "object",
		"properties": map[string]any{
			"path":     map[string]any{"type": "string"},
			"encoding": map[string]any{"type": "string"},
		},
		"required": []any{"path"},
	})
	want := "Args: encoding? (string), path (string)"
	if got != want {
		t.Fatalf("got %q, want %q", got, want)
	}
	if CompactSchemaSummary(nil) != "" {
		t.Fatal("nil schema should be empty")
	}
	if CompactSchemaSummary(map[string]any{}) != "" {
		t.Fatal("empty schema should be empty")
	}
}

func TestSchemaSummaryForDiscoveredTool(t *testing.T) {
	reg := NewRegistry()
	tool := &stubSchemaTool{
		name: "mcp.demo.read",
		schema: map[string]any{
			"properties": map[string]any{
				"uri": map[string]any{"type": "string"},
			},
			"required": []string{"uri"},
		},
	}
	if err := reg.Register(tool); err != nil {
		t.Fatal(err)
	}
	ex := NewExecutor(reg)
	got := ex.SchemaSummaryFor("mcp.demo.read")
	if got != "Args: uri (string)" {
		t.Fatalf("got %q", got)
	}
	if ex.SchemaSummaryFor("missing") != "" {
		t.Fatal("missing tool")
	}
}

type stubSchemaTool struct {
	name   string
	schema any
}

func (t *stubSchemaTool) Name() string       { return t.name }
func (t *stubSchemaTool) Capability() string { return "mcp.tools" }
func (t *stubSchemaTool) Description() string {
	return "stub"
}
func (t *stubSchemaTool) InputSchema() any { return t.schema }
func (t *stubSchemaTool) Execute(context.Context, map[string]interface{}) (map[string]interface{}, error) {
	return map[string]interface{}{}, nil
}
