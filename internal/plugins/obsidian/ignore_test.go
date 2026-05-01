package obsidian

import (
	"path/filepath"
	"testing"
)

func TestLoadObsidianIgnore_AbsentFileReturnsEmptyMatcher(t *testing.T) {
	dir := t.TempDir()
	m := loadObsidianIgnore(dir)
	if m == nil {
		t.Fatal("expected non-nil matcher")
	}
	if len(m.rules) != 0 {
		t.Fatalf("expected no rules, got %d", len(m.rules))
	}
	if m.matchesFile("anything.md") {
		t.Fatal("empty matcher should match nothing")
	}
}

func TestLoadObsidianIgnore_ParsesRules(t *testing.T) {
	dir := t.TempDir()
	mustWrite(t, filepath.Join(dir, ".obsidianignore"), `# header
Templates/

*.tmp
private/**
notes/draft.md
`)
	m := loadObsidianIgnore(dir)
	if len(m.rules) != 4 {
		t.Fatalf("rule count: got %d, want 4 (got rules: %+v)", len(m.rules), m.rules)
	}
}

func TestIgnoreMatcher_DirectoryRule(t *testing.T) {
	dir := t.TempDir()
	mustWrite(t, filepath.Join(dir, ".obsidianignore"), "Templates/\n")
	m := loadObsidianIgnore(dir)

	if !m.matchesDir("Templates") {
		t.Fatal("Templates should be ignored as dir")
	}
	if !m.matchesDir("nested/Templates") {
		t.Fatal("nested Templates dir should match by basename")
	}
	if m.matchesFile("Templates/note.md") {
		t.Fatal("dir-only rule should not match files (walk skip handles dir)")
	}
	if m.matchesDir("OtherDir") {
		t.Fatal("unrelated dir should not match")
	}
}

func TestIgnoreMatcher_GlobExtension(t *testing.T) {
	dir := t.TempDir()
	mustWrite(t, filepath.Join(dir, ".obsidianignore"), "*.tmp\n")
	m := loadObsidianIgnore(dir)

	if !m.matchesFile("draft.tmp") {
		t.Fatal("draft.tmp should match *.tmp")
	}
	if !m.matchesFile("notes/draft.tmp") {
		t.Fatal("nested draft.tmp should match *.tmp by basename")
	}
	if m.matchesFile("draft.md") {
		t.Fatal("draft.md should not match *.tmp")
	}
}

func TestIgnoreMatcher_RecursivePrefix(t *testing.T) {
	dir := t.TempDir()
	mustWrite(t, filepath.Join(dir, ".obsidianignore"), "private/**\n")
	m := loadObsidianIgnore(dir)

	if !m.matchesDir("private") {
		t.Fatal("private should match prefix")
	}
	if !m.matchesDir("private/sub") {
		t.Fatal("private/sub should match prefix")
	}
	if !m.matchesFile("private/notes.md") {
		t.Fatal("private/notes.md should match prefix")
	}
	if m.matchesFile("public/notes.md") {
		t.Fatal("public/notes.md should not match")
	}
}

func TestIgnoreMatcher_ExactPath(t *testing.T) {
	dir := t.TempDir()
	mustWrite(t, filepath.Join(dir, ".obsidianignore"), "notes/draft.md\n")
	m := loadObsidianIgnore(dir)

	if !m.matchesFile("notes/draft.md") {
		t.Fatal("exact path should match")
	}
	if m.matchesFile("notes/draft2.md") {
		t.Fatal("near-miss should not match")
	}
	if m.matchesFile("draft.md") {
		t.Fatal("basename-only should not match a path-anchored rule")
	}
}

func TestIgnoreMatcher_CommentsAndBlanksIgnored(t *testing.T) {
	dir := t.TempDir()
	mustWrite(t, filepath.Join(dir, ".obsidianignore"), `# leading comment

   # indented comment

*.tmp

# trailing comment
`)
	m := loadObsidianIgnore(dir)
	if len(m.rules) != 1 {
		t.Fatalf("expected 1 effective rule, got %d", len(m.rules))
	}
}
