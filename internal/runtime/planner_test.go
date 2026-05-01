package runtime

import (
	"strings"
	"testing"

	"github.com/felixgeelhaar/nomi/internal/domain"
)

func TestParsePlannerResponseAcceptsCleanJSON(t *testing.T) {
	got := parsePlannerResponse(`{"steps":[{"title":"Greet","description":"say hi","tool":"llm.chat"}]}`)
	if len(got) != 1 {
		t.Fatalf("want 1 step, got %d", len(got))
	}
	if got[0].Tool != "llm.chat" || got[0].Title != "Greet" {
		t.Fatalf("bad parse: %+v", got[0])
	}
}

func TestParsePlannerResponseStripsMarkdownFences(t *testing.T) {
	raw := "```json\n{\"steps\":[{\"title\":\"t\",\"description\":\"d\",\"tool\":\"llm.chat\"}]}\n```"
	got := parsePlannerResponse(raw)
	if len(got) != 1 {
		t.Fatalf("want 1 step; got %d: raw was %q", len(got), raw)
	}
}

func TestParsePlannerResponseToleratesLeadingProse(t *testing.T) {
	raw := `Here's the plan:
{"steps":[{"title":"a","description":"b","tool":"llm.chat"}]}
Hope that helps!`
	got := parsePlannerResponse(raw)
	if len(got) != 1 {
		t.Fatalf("want 1 step; got %d", len(got))
	}
}

func TestParsePlannerResponseRejectsUnknownFields(t *testing.T) {
	// LLM hallucinated extra top-level field on a step. Strict mode must
	// reject so the missing field doesn't silently disappear.
	raw := `{"steps":[{"title":"Greet","description":"d","tool":"llm.chat","capabilities":["fs"]}]}`
	if got := parsePlannerResponse(raw); got != nil {
		t.Fatalf("expected nil, got %+v", got)
	}
}

func TestParsePlannerResponseRejectsOversizedPayload(t *testing.T) {
	// Pad the raw response to push it past maxPlannerJSONBytes; the
	// upstream MaxTokens cap usually prevents this but the parser
	// shouldn't trust its caller.
	pad := strings.Repeat("x", maxPlannerJSONBytes+10)
	raw := `{"steps":[{"title":"a","description":"` + pad + `","tool":"llm.chat"}]}`
	if got := parsePlannerResponse(raw); got != nil {
		t.Fatalf("expected nil for oversized payload, got %d steps", len(got))
	}
}

func TestParsePlannerResponseCarriesArguments(t *testing.T) {
	raw := `{"steps":[{"title":"Write","description":"create a file","tool":"filesystem.write","arguments":{"path":"out.txt","content":"hello"}}]}`
	got := parsePlannerResponse(raw)
	if len(got) != 1 {
		t.Fatalf("want 1 step, got %d", len(got))
	}
	if got[0].Arguments["path"] != "out.txt" || got[0].Arguments["content"] != "hello" {
		t.Fatalf("arguments not parsed: %+v", got[0].Arguments)
	}
}

func TestBuildPlannerPromptDocumentsArgumentsShape(t *testing.T) {
	prompt := buildPlannerPrompt("write README", nil, "", []toolInfo{
		{Name: "filesystem.write", Description: "Write file."},
	})
	for _, must := range []string{"arguments", "filesystem.write:", `"path"`, `"content"`} {
		if !strings.Contains(prompt, must) {
			t.Errorf("prompt missing %q. Full prompt:\n%s", must, prompt)
		}
	}
}

func TestParsePlannerResponseRejectsGarbage(t *testing.T) {
	cases := []string{
		"",
		"not json at all",
		"{not json",
		`{"steps": "not an array"}`,
	}
	for _, c := range cases {
		if got := parsePlannerResponse(c); got != nil {
			// A successful parse on the third case could return an empty
			// slice rather than nil when the JSON is valid but steps is a
			// string — that still fails validation downstream, so tolerate it.
			if len(got) != 0 {
				t.Errorf("expected nil/empty for %q, got %+v", c, got)
			}
		}
	}
}

func TestBuildPlannerPromptIncludesToolList(t *testing.T) {
	prompt := buildPlannerPrompt(
		"summarize the docs",
		&domain.AssistantDefinition{Name: "Researcher", Role: "research", SystemPrompt: "You are a careful researcher."},
		"README.md\nCHANGELOG.md\n",
		[]toolInfo{
			{Name: "llm.chat", Description: "Ask the LLM."},
			{Name: "filesystem.read", Description: "Read a file."},
		},
	)

	for _, must := range []string{
		"Researcher",
		"careful researcher",
		"summarize the docs",
		"README.md",
		"llm.chat",
		"filesystem.read",
		`"steps"`, // required JSON shape mention
	} {
		if !strings.Contains(prompt, must) {
			t.Errorf("prompt missing %q. Full prompt:\n%s", must, prompt)
		}
	}
}

func TestStripMarkdownFencesIdempotent(t *testing.T) {
	// Already clean JSON should pass through.
	in := `{"steps":[]}`
	if got := stripMarkdownFences(in); got != in {
		t.Fatalf("strip mangled clean input: %q → %q", in, got)
	}
}
