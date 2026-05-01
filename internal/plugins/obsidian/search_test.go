package obsidian

import (
	"context"
	"path/filepath"
	"testing"
)

func seedSearchVault(t *testing.T, dir string) {
	t.Helper()
	mustWrite(t, filepath.Join(dir, "rust-perf.md"), `---
tags: [rust, performance]
---

Notes about rust borrow checker and inline allocation patterns.
See [[memory-management]] for related ideas.
`)
	mustWrite(t, filepath.Join(dir, "memory-management.md"), `---
tags: [systems]
---

Memory management strategies. Discusses arenas and stack allocation.
`)
	mustWrite(t, filepath.Join(dir, "ai-agents.md"), `---
tags: [ai, research]
---

Notes about local-first AI agents and tool use.
`)
	mustWrite(t, filepath.Join(dir, "shopping.md"), "Buy bread.\n")
}

func TestSearchNotes_TextQuery(t *testing.T) {
	p, conn, dir := newTestConn(t)
	seedSearchVault(t, dir)

	out, err := p.searchNotes(context.Background(), conn, map[string]any{
		"query": "memory",
	})
	if err != nil {
		t.Fatalf("search: %v", err)
	}
	matches, _ := out["matches"].([]map[string]any)
	if len(matches) == 0 {
		t.Fatal("expected at least one match for 'memory'")
	}
	// memory-management.md has the term in the filename + body — should
	// outrank rust-perf.md which only mentions [[memory-management]].
	first, _ := matches[0]["path"].(string)
	if first != "memory-management.md" {
		t.Fatalf("expected memory-management.md first, got %s", first)
	}
}

func TestSearchNotes_TagFilter(t *testing.T) {
	p, conn, dir := newTestConn(t)
	seedSearchVault(t, dir)

	out, err := p.searchNotes(context.Background(), conn, map[string]any{
		"tags": []string{"ai"},
	})
	if err != nil {
		t.Fatalf("search: %v", err)
	}
	matches, _ := out["matches"].([]map[string]any)
	if len(matches) != 1 {
		t.Fatalf("expected exactly one ai-tagged match, got %d", len(matches))
	}
	if got, _ := matches[0]["path"].(string); got != "ai-agents.md" {
		t.Fatalf("got %s", got)
	}
}

func TestSearchNotes_LinksToFilter(t *testing.T) {
	p, conn, dir := newTestConn(t)
	seedSearchVault(t, dir)

	out, err := p.searchNotes(context.Background(), conn, map[string]any{
		"links_to": []string{"memory-management"},
	})
	if err != nil {
		t.Fatalf("search: %v", err)
	}
	matches, _ := out["matches"].([]map[string]any)
	if len(matches) != 1 {
		t.Fatalf("expected exactly one note linking to memory-management, got %d", len(matches))
	}
	if got, _ := matches[0]["path"].(string); got != "rust-perf.md" {
		t.Fatalf("got %s", got)
	}
}

func TestSearchNotes_NoFilters_ReturnsAllNotes(t *testing.T) {
	p, conn, dir := newTestConn(t)
	seedSearchVault(t, dir)

	out, err := p.searchNotes(context.Background(), conn, map[string]any{})
	if err != nil {
		t.Fatalf("search: %v", err)
	}
	matches, _ := out["matches"].([]map[string]any)
	if len(matches) != 4 {
		t.Fatalf("expected 4 notes, got %d", len(matches))
	}
}

func TestSearchNotes_RespectsLimit(t *testing.T) {
	p, conn, dir := newTestConn(t)
	seedSearchVault(t, dir)

	out, err := p.searchNotes(context.Background(), conn, map[string]any{
		"limit": 2,
	})
	if err != nil {
		t.Fatalf("search: %v", err)
	}
	matches, _ := out["matches"].([]map[string]any)
	if len(matches) != 2 {
		t.Fatalf("limit ignored: got %d, want 2", len(matches))
	}
}

func TestSearchNotes_SkipsHiddenDirectories(t *testing.T) {
	p, conn, dir := newTestConn(t)
	mustWrite(t, filepath.Join(dir, "visible.md"), "memory")
	mustWrite(t, filepath.Join(dir, ".obsidian", "internal.md"), "memory")
	mustWrite(t, filepath.Join(dir, ".trash", "deleted.md"), "memory")

	out, err := p.searchNotes(context.Background(), conn, map[string]any{
		"query": "memory",
	})
	if err != nil {
		t.Fatalf("search: %v", err)
	}
	matches, _ := out["matches"].([]map[string]any)
	if len(matches) != 1 {
		t.Fatalf("expected hidden dirs to be skipped, got %d matches", len(matches))
	}
}

func TestNormalizeLinkTargets_StripsExtensionAndFolder(t *testing.T) {
	got := normalizeLinkTargets([]string{
		"foo",
		"foo.md",
		"notes/foo",
		"notes/sub/foo.md",
		"  ",
	})
	want := []string{"foo", "foo", "foo", "foo"}
	if len(got) != len(want) {
		t.Fatalf("len: got %d, want %d (%v)", len(got), len(want), got)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("idx %d: got %q, want %q", i, got[i], want[i])
		}
	}
}

func TestMakeSnippet_HighlightsContext(t *testing.T) {
	body := "lots of context before the term that we want to find and lots more after to test the radius behavior"
	got := makeSnippet(body, "term")
	if got == "" {
		t.Fatal("expected snippet")
	}
	if len(got) > 200 {
		t.Fatalf("snippet too long: %d chars", len(got))
	}
}
