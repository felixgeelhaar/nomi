package llm

import (
	"strings"
	"testing"
)

func TestNormalizeEndpoint(t *testing.T) {
	cases := []struct {
		in, want string
		wantErr  string
	}{
		{in: "", want: ""},
		{in: "  ", want: ""},
		{in: "http://127.0.0.1:11434", want: "http://127.0.0.1:11434/v1"},
		{in: "http://127.0.0.1:11434/", want: "http://127.0.0.1:11434/v1"},
		{in: "http://localhost:1234", want: "http://localhost:1234/v1"},
		{in: "http://127.0.0.1:11434/v1", want: "http://127.0.0.1:11434/v1"},
		{in: "https://api.openai.com/v1", want: "https://api.openai.com/v1"},
		{in: "https://example.com/proxy/openai", want: "https://example.com/proxy/openai"},
		{in: "HTTP://Example.com", want: "http://Example.com/v1"},
		{in: "file:///etc/passwd", wantErr: "scheme"},
		{in: "javascript:alert(1)", wantErr: "scheme"},
		{in: "gopher://internal", wantErr: "scheme"},
		{in: "ftp://example.com", wantErr: "scheme"},
		{in: "localhost:11434", wantErr: "scheme"},
		{in: "not a url", wantErr: "scheme"},
		{in: "http://", wantErr: "host"},
		{in: "https:///v1", wantErr: "host"},
	}
	for _, c := range cases {
		got, err := NormalizeEndpoint(c.in)
		if c.wantErr != "" {
			if err == nil {
				t.Errorf("NormalizeEndpoint(%q) expected error containing %q, got nil (value=%q)", c.in, c.wantErr, got)
				continue
			}
			if !strings.Contains(err.Error(), c.wantErr) {
				t.Errorf("NormalizeEndpoint(%q) error = %q, want to contain %q", c.in, err.Error(), c.wantErr)
			}
			continue
		}
		if err != nil {
			t.Errorf("NormalizeEndpoint(%q) unexpected error: %v", c.in, err)
			continue
		}
		if got != c.want {
			t.Errorf("NormalizeEndpoint(%q) = %q, want %q", c.in, got, c.want)
		}
	}
}
