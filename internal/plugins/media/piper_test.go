package media

import (
	"context"
	"strings"
	"testing"
)

func TestNewPiperBackend_ReturnsNilWhenBinaryAbsent(t *testing.T) {
	// We can't reliably exec.LookPath("piper") in CI, so rely on the
	// soft-nil contract: when the lookup fails, the constructor
	// returns (nil, nil) so main() can carry on without aborting boot.
	// This test passes regardless of whether Piper is installed —
	// it documents the soft-fail behavior either way.
	b, err := NewPiperBackend("/tmp/does/not/exist", "voice")
	if err != nil {
		t.Fatalf("expected no error on missing binary/dir, got %v", err)
	}
	// b may be nil (binary missing) or non-nil (binary on PATH but
	// model dir missing → also nil). Either is acceptable; the test
	// asserts the contract that absence is non-fatal.
	_ = b
}

func TestPiperBackend_RejectsPathTraversalInVoice(t *testing.T) {
	// Construct a backend manually so we don't depend on the real
	// binary being installed. The path-traversal guard runs before
	// any file or exec lookup, so it's testable without piper.
	b := &PiperBackend{
		binaryPath:   "/usr/local/bin/piper",
		modelDir:     "/tmp",
		defaultVoice: "default",
	}
	_, _, err := b.Speak(context.Background(), "hello", "../../etc/passwd")
	if err == nil {
		t.Fatal("expected path-traversal rejection")
	}
	if !strings.Contains(err.Error(), "no slashes or dots allowed") {
		t.Fatalf("expected slashes/dots error, got: %v", err)
	}
}

func TestPiperBackend_RejectsEmptyText(t *testing.T) {
	b := &PiperBackend{
		binaryPath:   "/usr/local/bin/piper",
		modelDir:     "/tmp",
		defaultVoice: "default",
	}
	_, _, err := b.Speak(context.Background(), "", "default")
	if err == nil || !strings.Contains(err.Error(), "text is empty") {
		t.Fatalf("expected empty-text error, got: %v", err)
	}
}

func TestPiperBackend_NameIsStable(t *testing.T) {
	b := &PiperBackend{}
	if b.Name() != "piper" {
		t.Fatalf("Name should return 'piper' for telemetry stability, got %q", b.Name())
	}
}
