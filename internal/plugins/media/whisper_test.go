package media

import (
	"context"
	"strings"
	"testing"
)

func TestNewWhisperBackend_SoftNilWhenAbsent(t *testing.T) {
	// Same soft-nil contract as Piper. The constructor should not
	// fail boot when the binary or model is missing.
	b, err := NewWhisperBackend("/tmp/does/not/exist", "base.en")
	if err != nil {
		t.Fatalf("expected no error on missing binary/dir, got %v", err)
	}
	_ = b
}

func TestWhisperBackend_RejectsEmptyAudio(t *testing.T) {
	b := &WhisperBackend{
		binaryPath: "/usr/local/bin/whisper-cli",
		modelDir:   "/tmp",
		modelSize:  "base.en",
	}
	_, _, err := b.Transcribe(context.Background(), nil, "en")
	if err == nil || !strings.Contains(err.Error(), "audio is empty") {
		t.Fatalf("expected empty-audio error, got: %v", err)
	}
}

func TestWhisperBackend_NameIsStable(t *testing.T) {
	b := &WhisperBackend{}
	if b.Name() != "whisper.cpp" {
		t.Fatalf("Name should be 'whisper.cpp' for telemetry stability, got %q", b.Name())
	}
}

func TestWhisperBinaryNames_PrefersWhisperCli(t *testing.T) {
	// Documents the discovery order so future contributors don't
	// reorder it accidentally — `whisper-cli` is the homebrew name
	// and should win when multiple binaries exist on PATH.
	if whisperBinaryNames[0] != "whisper-cli" {
		t.Fatalf("whisper-cli should be probed first, got %v", whisperBinaryNames)
	}
}
