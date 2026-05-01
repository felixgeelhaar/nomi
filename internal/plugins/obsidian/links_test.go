package obsidian

import (
	"context"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
)

func TestExtractWikilinks(t *testing.T) {
	cases := []struct {
		name string
		body string
		want []string
	}{
		{"none", "no links here", nil},
		{"simple", "see [[other]] for context", []string{"other"}},
		{"with alias", "see [[target|the alias]] please", []string{"target"}},
		{"with header", "see [[note#section|alias]] please", []string{"note"}},
		{"folder path", "see [[notes/sub/foo]]", []string{"notes/sub/foo"}},
		{"multiple", "[[a]] then [[b]] then [[c|alias]]", []string{"a", "b", "c"}},
		{"newline-broken not matched", "[[a\nb]]", nil},
		{"empty target ignored", "[[]] then [[real]]", []string{"real"}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := extractWikilinks(tc.body)
			if !reflect.DeepEqual(got, tc.want) {
				t.Fatalf("got %v, want %v", got, tc.want)
			}
		})
	}
}

func TestFormatWikilink(t *testing.T) {
	cases := []struct {
		target, alias, want string
	}{
		{"foo", "", "[[foo]]"},
		{"foo.md", "", "[[foo]]"},
		{"foo", "Alias", "[[foo|Alias]]"},
		{"  foo  ", "", "[[foo]]"},
	}
	for _, tc := range cases {
		got := formatWikilink(tc.target, tc.alias)
		if got != tc.want {
			t.Fatalf("formatWikilink(%q, %q) = %q, want %q", tc.target, tc.alias, got, tc.want)
		}
	}
}

func TestLinkNotes_AppendsLink(t *testing.T) {
	p, conn, dir := newTestConn(t)
	mustWrite(t, filepath.Join(dir, "src.md"), "Original body.\n")

	out, err := p.linkNotes(context.Background(), conn, map[string]any{
		"source": "src.md",
		"target": "target-note",
	})
	if err != nil {
		t.Fatalf("link: %v", err)
	}
	if appended, _ := out["appended"].(bool); !appended {
		t.Fatalf("expected appended=true, got %v", out)
	}

	raw, _ := os.ReadFile(filepath.Join(dir, "src.md"))
	got := string(raw)
	if !strings.Contains(got, "Original body.") {
		t.Fatalf("original body lost: %q", got)
	}
	if !strings.Contains(got, "[[target-note]]") {
		t.Fatalf("link not appended: %q", got)
	}
}

func TestLinkNotes_AppendsLinkWithAlias(t *testing.T) {
	p, conn, dir := newTestConn(t)
	mustWrite(t, filepath.Join(dir, "src.md"), "body\n")

	if _, err := p.linkNotes(context.Background(), conn, map[string]any{
		"source": "src.md",
		"target": "target-note",
		"alias":  "See here",
	}); err != nil {
		t.Fatalf("link: %v", err)
	}
	raw, _ := os.ReadFile(filepath.Join(dir, "src.md"))
	if !strings.Contains(string(raw), "[[target-note|See here]]") {
		t.Fatalf("expected aliased link, got %q", raw)
	}
}

func TestLinkNotes_IsIdempotent(t *testing.T) {
	p, conn, dir := newTestConn(t)
	mustWrite(t, filepath.Join(dir, "src.md"), "body with [[target]] already.\n")

	out, err := p.linkNotes(context.Background(), conn, map[string]any{
		"source": "src.md",
		"target": "target",
	})
	if err != nil {
		t.Fatalf("link: %v", err)
	}
	if appended, _ := out["appended"].(bool); appended {
		t.Fatal("expected idempotent no-op when link already present")
	}
	raw, _ := os.ReadFile(filepath.Join(dir, "src.md"))
	if strings.Count(string(raw), "[[target]]") != 1 {
		t.Fatalf("link should not be duplicated, got %q", raw)
	}
}

func TestLinkNotes_PreservesFrontmatter(t *testing.T) {
	p, conn, dir := newTestConn(t)
	mustWrite(t, filepath.Join(dir, "src.md"), `---
tags: [keep]
---

Body.
`)

	if _, err := p.linkNotes(context.Background(), conn, map[string]any{
		"source": "src.md",
		"target": "target",
	}); err != nil {
		t.Fatalf("link: %v", err)
	}
	raw, _ := os.ReadFile(filepath.Join(dir, "src.md"))
	got := string(raw)
	if !strings.HasPrefix(got, "---\n") {
		t.Fatalf("frontmatter lost: %q", got)
	}
	if !strings.Contains(got, "tags: [keep]") {
		t.Fatalf("frontmatter tags lost: %q", got)
	}
	if !strings.Contains(got, "[[target]]") {
		t.Fatalf("link not added: %q", got)
	}
}

func TestLinkNotes_RequiresSourceAndTarget(t *testing.T) {
	p, conn, _ := newTestConn(t)
	if _, err := p.linkNotes(context.Background(), conn, map[string]any{"source": "a.md"}); err == nil {
		t.Fatal("expected error when target missing")
	}
	if _, err := p.linkNotes(context.Background(), conn, map[string]any{"target": "a"}); err == nil {
		t.Fatal("expected error when source missing")
	}
}
