package media

import (
	"context"
	"strings"
	"testing"
)

func TestManifestShape(t *testing.T) {
	p := NewPlugin()
	m := p.Manifest()
	if m.ID != PluginID {
		t.Fatalf("id: %s", m.ID)
	}
	if m.Cardinality != "single" {
		t.Fatalf("cardinality: %s", m.Cardinality)
	}
	// Tool-only — no channel role.
	if len(m.Contributes.Channels) != 0 {
		t.Fatalf("media plugin must not contribute channel role: %+v", m.Contributes.Channels)
	}
	// Two tools in v1 (vision deferred until backend lands).
	wantTools := map[string]bool{"media.speak": false, "media.transcribe": false}
	for _, tc := range m.Contributes.Tools {
		if _, ok := wantTools[tc.Name]; ok {
			wantTools[tc.Name] = true
		}
	}
	for name, ok := range wantTools {
		if !ok {
			t.Fatalf("manifest missing tool %s", name)
		}
	}
	// Capabilities cover all three roles even though the third tool
	// hasn't shipped yet — capability declaration is the ceiling, not
	// a runtime promise.
	caps := map[string]bool{}
	for _, c := range m.Capabilities {
		caps[c] = true
	}
	for _, want := range []string{"media.tts", "media.stt", "media.vision"} {
		if !caps[want] {
			t.Fatalf("manifest missing capability %s", want)
		}
	}
}

func TestSpeakTool_ErrorsWhenBackendMissing(t *testing.T) {
	p := NewPlugin()
	tool := &speakTool{plugin: p}
	_, err := tool.Execute(context.Background(), map[string]interface{}{
		"text": "hello world",
	})
	if err == nil || !strings.Contains(err.Error(), "no TTS backend configured") {
		t.Fatalf("expected no-backend error, got: %v", err)
	}
}

func TestSpeakTool_ErrorsWhenTextMissing(t *testing.T) {
	p := NewPlugin()
	tool := &speakTool{plugin: p}
	_, err := tool.Execute(context.Background(), map[string]interface{}{})
	if err == nil || !strings.Contains(err.Error(), "text is required") {
		t.Fatalf("expected text-required error, got: %v", err)
	}
}

func TestTranscribeTool_ErrorsWhenBackendMissing(t *testing.T) {
	p := NewPlugin()
	tool := &transcribeTool{plugin: p}
	_, err := tool.Execute(context.Background(), map[string]interface{}{
		"audio": []byte{0x01, 0x02},
	})
	if err == nil || !strings.Contains(err.Error(), "no STT backend configured") {
		t.Fatalf("expected no-backend error, got: %v", err)
	}
}

// fakeTTS exercises the backend wiring without spawning a real binary.
type fakeTTS struct{ called bool }

func (f *fakeTTS) Name() string { return "fake-tts" }
func (f *fakeTTS) Speak(_ context.Context, text, _ string) ([]byte, string, error) {
	f.called = true
	return []byte("audio:" + text), "audio/ogg", nil
}

func TestSpeakTool_RoutesToConfiguredBackend(t *testing.T) {
	p := NewPlugin()
	fb := &fakeTTS{}
	p.SetTTSBackend(fb)
	tool := &speakTool{plugin: p}
	out, err := tool.Execute(context.Background(), map[string]interface{}{
		"text": "hi",
	})
	if err != nil {
		t.Fatalf("Execute: %v", err)
	}
	if !fb.called {
		t.Fatal("fake TTS backend was not invoked")
	}
	if got, _ := out["content_type"].(string); got != "audio/ogg" {
		t.Fatalf("content_type: %v", out["content_type"])
	}
	if got, _ := out["backend"].(string); got != "fake-tts" {
		t.Fatalf("backend: %v", out["backend"])
	}
}

// fakeSTT exercises the transcribe wiring.
type fakeSTT struct{}

func (f *fakeSTT) Name() string { return "fake-stt" }
func (f *fakeSTT) Transcribe(_ context.Context, _ []byte, lang string) (string, string, error) {
	return "transcribed", lang, nil
}

func TestTranscribeTool_PassesLanguageHint(t *testing.T) {
	p := NewPlugin()
	p.SetSTTBackend(&fakeSTT{})
	tool := &transcribeTool{plugin: p}
	out, err := tool.Execute(context.Background(), map[string]interface{}{
		"audio":         []byte{0x01},
		"language_hint": "en",
	})
	if err != nil {
		t.Fatalf("Execute: %v", err)
	}
	if got, _ := out["transcript"].(string); got != "transcribed" {
		t.Fatalf("transcript: %v", out["transcript"])
	}
	if got, _ := out["detected_language"].(string); got != "en" {
		t.Fatalf("language passthrough lost: %v", out["detected_language"])
	}
}
