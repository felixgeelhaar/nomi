package transport

import (
	"strings"
	"testing"
)

func TestWrapBase64_RespectsLineLength(t *testing.T) {
	// Encode a buffer that produces base64 longer than the wrap target
	// to exercise the multi-line path.
	in := []byte(strings.Repeat("a", 300))
	out := wrapBase64(in, 76)
	for _, line := range strings.Split(out, "\r\n") {
		if len(line) > 76 {
			t.Fatalf("line exceeds wrap length: %d", len(line))
		}
	}
}

func TestWrapBase64_NoWrapWhenShortEnough(t *testing.T) {
	out := wrapBase64([]byte("hi"), 76)
	if strings.Contains(out, "\r\n") {
		t.Fatalf("short payload should not wrap, got %q", out)
	}
}

func TestSendEmailWithAttachments_FallsBackToTextOnlyWhenNoAttachments(t *testing.T) {
	// Without a real SMTP server we expect SendEmail to error on dial,
	// but the important assertion is that the no-attachment path takes
	// the text-only fast path rather than building a multipart body.
	err := SendEmailWithAttachments(Config{}, []string{"a@b.c"}, "subj", "body", "", nil, nil)
	if err == nil {
		t.Fatal("expected error for missing smtp host")
	}
	if !strings.Contains(err.Error(), "smtp host") {
		t.Fatalf("expected smtp-host error from text-only fast path, got: %v", err)
	}
}

func TestSendEmailWithAttachments_RequiresFromOrUsername(t *testing.T) {
	err := SendEmailWithAttachments(
		Config{SMTPHost: "smtp.example.invalid"},
		[]string{"a@b.c"}, "subj", "body", "", nil,
		[]EmailAttachment{{Filename: "doc.pdf", Data: []byte("dummy")}},
	)
	if err == nil {
		t.Fatal("expected error when both from and username empty")
	}
}
