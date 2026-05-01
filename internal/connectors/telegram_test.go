package connectors

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
)

func TestTelegramSendMessageUsesRequestedConnection(t *testing.T) {
	var mu sync.Mutex
	seen := make([]string, 0, 2)

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		seen = append(seen, r.URL.Path)
		mu.Unlock()
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"ok":true}`))
	}))
	defer srv.Close()

	c := NewTelegramConnector(TelegramConfig{
		Enabled: true,
		Connections: []TelegramConnection{
			{ID: "a", Name: "A", BotToken: "token-a", Enabled: true},
			{ID: "b", Name: "B", BotToken: "token-b", Enabled: true},
		},
	}, nil, nil, nil)
	c.apiBase = srv.URL

	if err := c.SendMessage("a", "111", "hello a"); err != nil {
		t.Fatalf("send via connection a failed: %v", err)
	}
	if err := c.SendMessage("b", "222", "hello b"); err != nil {
		t.Fatalf("send via connection b failed: %v", err)
	}

	mu.Lock()
	defer mu.Unlock()
	if len(seen) != 2 {
		t.Fatalf("expected 2 requests, got %d", len(seen))
	}
	if !strings.Contains(seen[0], "/bottoken-a/sendMessage") {
		t.Fatalf("first request used wrong token path: %s", seen[0])
	}
	if !strings.Contains(seen[1], "/bottoken-b/sendMessage") {
		t.Fatalf("second request used wrong token path: %s", seen[1])
	}
}

func TestTelegramSendMessageFailsWhenConnectionDisabled(t *testing.T) {
	c := NewTelegramConnector(TelegramConfig{
		Enabled: true,
		Connections: []TelegramConnection{
			{ID: "a", Name: "A", BotToken: "token-a", Enabled: false},
			{ID: "b", Name: "B", BotToken: "token-b", Enabled: true},
		},
	}, nil, nil, nil)

	err := c.SendMessage("a", "111", "hello")
	if err == nil {
		t.Fatal("expected error for disabled connection")
	}
	if !strings.Contains(err.Error(), "disabled") {
		t.Fatalf("expected disabled error, got: %v", err)
	}
}

func TestTelegramSendMessageFailsWhenConnectionMissing(t *testing.T) {
	c := NewTelegramConnector(TelegramConfig{
		Enabled: true,
		Connections: []TelegramConnection{
			{ID: "a", Name: "A", BotToken: "token-a", Enabled: true},
		},
	}, nil, nil, nil)

	err := c.SendMessage("missing", "111", "hello")
	if err == nil {
		t.Fatal("expected error for unknown connection")
	}
	if !strings.Contains(err.Error(), "not found") {
		t.Fatalf("expected not found error, got: %v", err)
	}
}

func TestTelegramHandleMessageRecordsRunConnection(t *testing.T) {
	// This test validates map behavior independent of runtime wiring.
	c := NewTelegramConnector(TelegramConfig{}, nil, nil, nil)
	c.setRunConnection("run-1", "conn-1")

	connID, ok := c.connectionForRun("run-1")
	if !ok {
		t.Fatal("expected run->connection mapping to exist")
	}
	if connID != "conn-1" {
		t.Fatalf("expected conn-1, got %s", connID)
	}

	// Ensure mappings are independent.
	c.setRunConnection("run-2", "conn-2")
	connID2, ok := c.connectionForRun("run-2")
	if !ok || connID2 != "conn-2" {
		t.Fatalf("expected run-2->conn-2 mapping, got %q ok=%v", connID2, ok)
	}
}

func TestTelegramSendMessagePayload(t *testing.T) {
	var body telegramMessagePayload
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Fatalf("decode payload: %v", err)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"ok":true}`))
	}))
	defer srv.Close()

	c := NewTelegramConnector(TelegramConfig{
		Enabled:     true,
		Connections: []TelegramConnection{{ID: "a", Name: "A", BotToken: "token-a", Enabled: true}},
	}, nil, nil, nil)
	c.apiBase = srv.URL

	if err := c.SendMessage("a", "123", "hi"); err != nil {
		t.Fatalf("send failed: %v", err)
	}

	if body.ChatID != "123" || body.Text != "hi" || body.ParseMode != "Markdown" {
		t.Fatalf("unexpected payload: %+v", body)
	}
}
