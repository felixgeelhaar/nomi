package connectors

import (
	"context"
	"testing"
	"time"
)

// mockConnector is a test implementation of the Connector interface
type mockConnector struct {
	name     string
	enabled  bool
	started  bool
	stopped  bool
	messages []string
}

func (m *mockConnector) Start(ctx context.Context) error {
	m.started = true
	return nil
}

func (m *mockConnector) Stop() error {
	m.stopped = true
	return nil
}

func (m *mockConnector) SendMessage(connectionID string, recipientID string, message string) error {
	m.messages = append(m.messages, connectionID+"/"+recipientID+": "+message)
	return nil
}

func (m *mockConnector) Name() string {
	return m.name
}

func (m *mockConnector) Manifest() ConnectorManifest {
	return ConnectorManifest{
		ID:      "test." + m.name,
		Name:    m.name,
		Version: "1.0.0",
	}
}

func (m *mockConnector) IsEnabled() bool {
	return m.enabled
}

func TestRegistryRegisterAndGet(t *testing.T) {
	reg := NewRegistry()
	conn := &mockConnector{name: "test-conn", enabled: true}

	if err := reg.Register(conn); err != nil {
		t.Fatalf("Failed to register: %v", err)
	}

	got, err := reg.Get("test-conn")
	if err != nil {
		t.Fatalf("Failed to get: %v", err)
	}

	if got.Name() != "test-conn" {
		t.Errorf("Expected name 'test-conn', got '%s'", got.Name())
	}

	// Duplicate registration should fail
	if err := reg.Register(conn); err == nil {
		t.Error("Expected duplicate registration to fail")
	}
}

func TestRegistryStartAllAndStopAll(t *testing.T) {
	reg := NewRegistry()
	enabled := &mockConnector{name: "enabled", enabled: true}
	disabled := &mockConnector{name: "disabled", enabled: false}

	_ = reg.Register(enabled)
	_ = reg.Register(disabled)

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()

	if err := reg.StartAll(ctx); err != nil {
		t.Fatalf("StartAll failed: %v", err)
	}

	if !enabled.started {
		t.Error("Expected enabled connector to be started")
	}
	if disabled.started {
		t.Error("Expected disabled connector to NOT be started")
	}

	if err := reg.StopAll(); err != nil {
		t.Fatalf("StopAll failed: %v", err)
	}

	if !enabled.stopped {
		t.Error("Expected enabled connector to be stopped")
	}
}

func TestRegistryStatus(t *testing.T) {
	reg := NewRegistry()
	conn := &mockConnector{name: "status-test", enabled: true}
	_ = reg.Register(conn)

	status, err := reg.Status("status-test")
	if err != nil {
		t.Fatalf("Failed to get status: %v", err)
	}

	if !status.Enabled {
		t.Error("Expected status to show enabled")
	}
	if status.Running {
		t.Error("Expected status to show not running")
	}
}

func TestRegistrySendMessage(t *testing.T) {
	reg := NewRegistry()
	conn := &mockConnector{name: "msg-test", enabled: true}
	_ = reg.Register(conn)

	if err := reg.SendMessage("msg-test", "conn1", "user1", "hello"); err != nil {
		t.Fatalf("SendMessage failed: %v", err)
	}

	if len(conn.messages) != 1 {
		t.Fatalf("Expected 1 message, got %d", len(conn.messages))
	}

	if conn.messages[0] != "conn1/user1: hello" {
		t.Errorf("Expected 'conn1/user1: hello', got '%s'", conn.messages[0])
	}
}

func TestRegistryList(t *testing.T) {
	reg := NewRegistry()
	_ = reg.Register(&mockConnector{name: "a", enabled: true})
	_ = reg.Register(&mockConnector{name: "b", enabled: false})

	list := reg.List()
	if len(list) != 2 {
		t.Fatalf("Expected 2 connectors, got %d", len(list))
	}

	names := reg.Names()
	if len(names) != 2 {
		t.Fatalf("Expected 2 names, got %d", len(names))
	}
}
