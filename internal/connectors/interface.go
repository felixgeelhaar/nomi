package connectors

import "context"

// Connector defines the interface for all Nomi connectors (Telegram, Slack, Discord, etc.)
type Connector interface {
	// Start initializes and begins the connector's event loop (e.g., polling, webhook)
	Start(ctx context.Context) error

	// Stop gracefully shuts down the connector
	Stop() error

	// SendMessage sends a message through this connector to a specific recipient
	// using a concrete connection/account instance.
	SendMessage(connectionID string, recipientID string, message string) error

	// Name returns the unique identifier for this connector
	Name() string

	// Manifest returns metadata about this connector
	Manifest() ConnectorManifest

	// IsEnabled returns whether the connector is configured and ready to run
	IsEnabled() bool
}

// ConnectorManifest represents metadata about a connector
type ConnectorManifest struct {
	ID           string                 `json:"id"`
	Name         string                 `json:"name"`
	Version      string                 `json:"version"`
	Description  string                 `json:"description"`
	Author       string                 `json:"author,omitempty"`
	Permissions  []string               `json:"permissions"`
	ConfigSchema map[string]ConfigField `json:"config_schema,omitempty"`
}

// ConfigField describes a single configuration field for a connector
type ConfigField struct {
	Type        string `json:"type"` // "string", "boolean", "number"
	Label       string `json:"label"`
	Required    bool   `json:"required"`
	Default     string `json:"default,omitempty"`
	Description string `json:"description,omitempty"`
}

// ConnectorStatus represents the runtime status of a connector
type ConnectorStatus struct {
	Name      string `json:"name"`
	Enabled   bool   `json:"enabled"`
	Running   bool   `json:"running"`
	LastError string `json:"last_error,omitempty"`
}
