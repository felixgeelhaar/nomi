package hub

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func newKeysAndClient(t *testing.T) (ed25519.PublicKey, ed25519.PrivateKey, *Client) {
	t.Helper()
	pub, priv, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatalf("keygen: %v", err)
	}
	c, err := NewClient(pub, nil)
	if err != nil {
		t.Fatalf("NewClient: %v", err)
	}
	return pub, priv, c
}

// signCatalog is the test-side helper that mirrors what the NomiHub
// publisher tooling will do: marshal a Catalog, sign it with the
// root private key, return the wire bytes.
func signCatalog(t *testing.T, priv ed25519.PrivateKey, cat Catalog) []byte {
	t.Helper()
	body, err := json.Marshal(cat)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	wire, err := SignCatalog(priv, body)
	if err != nil {
		t.Fatalf("SignCatalog: %v", err)
	}
	return wire
}

func sampleCatalog() Catalog {
	return Catalog{
		SchemaVersion: SchemaVersion,
		GeneratedAt:   time.Now().UTC().Truncate(time.Second),
		Entries: []Entry{
			{
				PluginID:             "com.example.x",
				Name:                 "Example X",
				LatestVersion:        "0.1.0",
				Capabilities:         []string{"network.outgoing"},
				NetworkAllowlist:     []string{"api.example.com"},
				InstallSizeBytes:     420000,
				SHA256:               "deadbeef",
				BundleURL:            "https://hub.example/bundles/x-0.1.0.nomi-plugin",
				PublisherFingerprint: "FP-1234",
			},
		},
	}
}

func TestParse_HappyPath(t *testing.T) {
	_, priv, client := newKeysAndClient(t)
	wire := signCatalog(t, priv, sampleCatalog())
	cat, err := client.Parse(wire)
	if err != nil {
		t.Fatalf("Parse: %v", err)
	}
	if len(cat.Entries) != 1 || cat.Entries[0].PluginID != "com.example.x" {
		t.Fatalf("entries drifted: %+v", cat.Entries)
	}
}

func TestParse_RejectsTamperedCatalog(t *testing.T) {
	_, priv, client := newKeysAndClient(t)
	wire := signCatalog(t, priv, sampleCatalog())
	// Flip a byte inside the inner catalog payload — signature should
	// no longer verify.
	tampered := []byte(strings.Replace(string(wire), "Example X", "Evil X", 1))
	_, err := client.Parse(tampered)
	if !errors.Is(err, ErrCatalogSignatureBad) {
		t.Fatalf("expected ErrCatalogSignatureBad, got %v", err)
	}
}

func TestParse_RejectsWrongRootKey(t *testing.T) {
	// Legitimate-looking catalog but signed with a different key from
	// the one our client trusts → must reject. Models the case where
	// hub.nomi.ai serves an attacker-controlled mirror.
	_, attackerPriv, _ := ed25519.GenerateKey(rand.Reader)
	_, _, client := newKeysAndClient(t)
	wire := signCatalog(t, attackerPriv, sampleCatalog())
	if _, err := client.Parse(wire); !errors.Is(err, ErrCatalogSignatureBad) {
		t.Fatalf("expected ErrCatalogSignatureBad for foreign key, got %v", err)
	}
}

func TestParse_RejectsMalformedEnvelope(t *testing.T) {
	_, _, client := newKeysAndClient(t)
	if _, err := client.Parse([]byte(`{not json`)); !errors.Is(err, ErrCatalogParseFailed) {
		t.Fatalf("expected ErrCatalogParseFailed, got %v", err)
	}
}

func TestParse_RejectsUnknownSchemaVersion(t *testing.T) {
	_, priv, client := newKeysAndClient(t)
	cat := sampleCatalog()
	cat.SchemaVersion = 999
	wire := signCatalog(t, priv, cat)
	_, err := client.Parse(wire)
	if !errors.Is(err, ErrCatalogVersionUnknown) {
		t.Fatalf("expected ErrCatalogVersionUnknown, got %v", err)
	}
}

func TestParse_RejectsShortSignature(t *testing.T) {
	_, _, client := newKeysAndClient(t)
	wire, _ := json.Marshal(SignedCatalog{
		Catalog:   json.RawMessage(`{"schema_version":1,"entries":[]}`),
		Signature: []byte{1, 2, 3},
	})
	if _, err := client.Parse(wire); !errors.Is(err, ErrCatalogSignatureBad) {
		t.Fatalf("expected ErrCatalogSignatureBad, got %v", err)
	}
}

func TestFetch_HappyPath(t *testing.T) {
	_, priv, client := newKeysAndClient(t)
	wire := signCatalog(t, priv, sampleCatalog())
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write(wire)
	}))
	defer srv.Close()

	cat, err := client.Fetch(context.Background(), srv.URL)
	if err != nil {
		t.Fatalf("Fetch: %v", err)
	}
	if cat.SchemaVersion != SchemaVersion {
		t.Fatalf("schema version drift: %d", cat.SchemaVersion)
	}
}

func TestFetch_HTTPErrorMapsToFetchFailed(t *testing.T) {
	_, _, client := newKeysAndClient(t)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusNotFound)
	}))
	defer srv.Close()
	_, err := client.Fetch(context.Background(), srv.URL)
	if !errors.Is(err, ErrCatalogFetchFailed) {
		t.Fatalf("expected ErrCatalogFetchFailed, got %v", err)
	}
}

func TestFetch_BoundsResponseSize(t *testing.T) {
	_, _, client := newKeysAndClient(t)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Stream a hostile response that exceeds the cap. No
		// Content-Length so the writer doesn't short-circuit on
		// reaching declared size.
		_, _ = io.CopyN(w, &repeatReader{b: 'X'}, maxCatalogBytes+10)
	}))
	defer srv.Close()
	_, err := client.Fetch(context.Background(), srv.URL)
	if !errors.Is(err, ErrCatalogFetchFailed) {
		t.Fatalf("expected fetch-failed for oversized body, got %v", err)
	}
}

// repeatReader is a never-ending stream of one byte. Avoid pulling in
// a dep just for this — used only by the size-bound test.
type repeatReader struct{ b byte }

func (r *repeatReader) Read(p []byte) (int, error) {
	for i := range p {
		p[i] = r.b
	}
	return len(p), nil
}

func TestNewClient_RejectsBadRootKey(t *testing.T) {
	_, err := NewClient(ed25519.PublicKey{1, 2, 3}, nil)
	if err == nil {
		t.Fatal("expected NewClient to reject too-short root key")
	}
}
