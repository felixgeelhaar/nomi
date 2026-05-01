package secrets

import (
	"errors"
	"testing"
)

func TestFileStoreRoundTrip(t *testing.T) {
	dir := t.TempDir()
	s, err := newFileStore(dir)
	if err != nil {
		t.Fatal(err)
	}

	if err := s.Put("connector/telegram/conn-1/bot_token", "real-secret-value"); err != nil {
		t.Fatal(err)
	}
	got, err := s.Get("connector/telegram/conn-1/bot_token")
	if err != nil {
		t.Fatal(err)
	}
	if got != "real-secret-value" {
		t.Fatalf("round-trip mismatch: got %q", got)
	}

	// A fresh store instance pointed at the same dir must decrypt the same
	// vault (exercises the saved-key + read-vault path).
	s2, err := newFileStore(dir)
	if err != nil {
		t.Fatal(err)
	}
	got2, err := s2.Get("connector/telegram/conn-1/bot_token")
	if err != nil {
		t.Fatal(err)
	}
	if got2 != "real-secret-value" {
		t.Fatalf("reopen mismatch: got %q", got2)
	}
}

func TestFileStoreMissingKeyReturnsErrNotFound(t *testing.T) {
	s, err := newFileStore(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.Get("nope"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("want ErrNotFound, got %v", err)
	}
}

func TestFileStoreDelete(t *testing.T) {
	s, err := newFileStore(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	if err := s.Put("k", "v"); err != nil {
		t.Fatal(err)
	}
	if err := s.Delete("k"); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Get("k"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("after Delete want ErrNotFound, got %v", err)
	}
	// Deleting a missing key is a no-op, not an error.
	if err := s.Delete("still-missing"); err != nil {
		t.Fatalf("Delete on missing key should be no-op: %v", err)
	}
}

func TestReferenceHelpers(t *testing.T) {
	if !IsReference("secret://foo") {
		t.Fatal("secret:// should be a reference")
	}
	if IsReference("plaintext-token") {
		t.Fatal("plaintext should not be a reference")
	}
	if got := NewReference("provider/p1/api_key"); got != "secret://provider/p1/api_key" {
		t.Fatalf("NewReference: %s", got)
	}
	if k, ok := KeyFromReference("secret://a/b"); !ok || k != "a/b" {
		t.Fatalf("KeyFromReference: %s ok=%v", k, ok)
	}
	if _, ok := KeyFromReference("not-a-ref"); ok {
		t.Fatal("KeyFromReference should reject non-references")
	}
}

func TestResolvePassesThroughPlaintext(t *testing.T) {
	// Resolve must treat non-reference inputs as plaintext for
	// backward-compat during a rolling migration where a row may still hold
	// a pre-migration value.
	s, _ := newFileStore(t.TempDir())
	got, err := Resolve(s, "plaintext")
	if err != nil || got != "plaintext" {
		t.Fatalf("Resolve plaintext: got=%q err=%v", got, err)
	}
}

func TestStoreAsReferenceWritesAndReturnsRef(t *testing.T) {
	s, _ := newFileStore(t.TempDir())
	ref, err := StoreAsReference(s, "connector/slack/default/bot_token", "xoxb-...")
	if err != nil {
		t.Fatal(err)
	}
	if !IsReference(ref) {
		t.Fatalf("expected reference, got %q", ref)
	}
	got, err := Resolve(s, ref)
	if err != nil || got != "xoxb-..." {
		t.Fatalf("round-trip: got=%q err=%v", got, err)
	}
}
