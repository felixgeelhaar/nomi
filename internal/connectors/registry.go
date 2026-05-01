package connectors

import (
	"context"
	"fmt"
	"log"
	"sync"
)

// Registry manages the lifecycle of all connectors
type Registry struct {
	connectors map[string]Connector
	status     map[string]*ConnectorStatus
	mu         sync.RWMutex
}

// NewRegistry creates a new connector registry
func NewRegistry() *Registry {
	return &Registry{
		connectors: make(map[string]Connector),
		status:     make(map[string]*ConnectorStatus),
	}
}

// Register adds a connector to the registry
func (r *Registry) Register(c Connector) error {
	r.mu.Lock()
	defer r.mu.Unlock()

	name := c.Name()
	if name == "" {
		return fmt.Errorf("connector name cannot be empty")
	}

	if _, exists := r.connectors[name]; exists {
		return fmt.Errorf("connector '%s' already registered", name)
	}

	r.connectors[name] = c
	r.status[name] = &ConnectorStatus{
		Name:    name,
		Enabled: c.IsEnabled(),
		Running: false,
	}

	log.Printf("Connector registered: %s (enabled=%v)", name, c.IsEnabled())
	return nil
}

// Unregister removes a connector from the registry
func (r *Registry) Unregister(name string) error {
	r.mu.Lock()
	defer r.mu.Unlock()

	c, exists := r.connectors[name]
	if !exists {
		return fmt.Errorf("connector '%s' not found", name)
	}

	// Stop if running
	if status := r.status[name]; status != nil && status.Running {
		_ = c.Stop()
	}

	delete(r.connectors, name)
	delete(r.status, name)
	return nil
}

// Get retrieves a connector by name
func (r *Registry) Get(name string) (Connector, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()

	c, exists := r.connectors[name]
	if !exists {
		return nil, fmt.Errorf("connector '%s' not found", name)
	}

	return c, nil
}

// List returns all registered connectors
func (r *Registry) List() []Connector {
	r.mu.RLock()
	defer r.mu.RUnlock()

	result := make([]Connector, 0, len(r.connectors))
	for _, c := range r.connectors {
		result = append(result, c)
	}
	return result
}

// Names returns all registered connector names
func (r *Registry) Names() []string {
	r.mu.RLock()
	defer r.mu.RUnlock()

	names := make([]string, 0, len(r.connectors))
	for name := range r.connectors {
		names = append(names, name)
	}
	return names
}

// StartAll starts all enabled connectors. Connector Start() may block on
// network I/O (e.g. Telegram's initial getMe), so we release the registry
// lock before calling it and reacquire only to update status. Holding the
// write lock across Start() would freeze every other registry method until
// the slowest connector returns.
func (r *Registry) StartAll(ctx context.Context) error {
	type target struct {
		name string
		c    Connector
	}

	r.mu.Lock()
	var targets []target
	for name, c := range r.connectors {
		if !c.IsEnabled() {
			continue
		}
		status := r.status[name]
		if status == nil || status.Running {
			continue
		}
		targets = append(targets, target{name, c})
	}
	r.mu.Unlock()

	for _, t := range targets {
		err := t.c.Start(ctx)

		r.mu.Lock()
		status := r.status[t.name]
		if status != nil {
			if err != nil {
				status.LastError = err.Error()
			} else {
				status.Running = true
				status.LastError = ""
			}
		}
		r.mu.Unlock()

		if err != nil {
			log.Printf("Failed to start connector %s: %v", t.name, err)
			continue
		}
		log.Printf("Connector started: %s", t.name)
	}

	return nil
}

// StopAll stops all running connectors
func (r *Registry) StopAll() error {
	r.mu.Lock()
	defer r.mu.Unlock()

	for name, c := range r.connectors {
		status := r.status[name]
		if status == nil || !status.Running {
			continue
		}

		if err := c.Stop(); err != nil {
			status.LastError = err.Error()
			log.Printf("Failed to stop connector %s: %v", name, err)
			continue
		}

		status.Running = false
		log.Printf("Connector stopped: %s", name)
	}

	return nil
}

// Status returns the status of a specific connector
func (r *Registry) Status(name string) (*ConnectorStatus, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()

	status, exists := r.status[name]
	if !exists {
		return nil, fmt.Errorf("connector '%s' not found", name)
	}

	// Return a copy
	return &ConnectorStatus{
		Name:      status.Name,
		Enabled:   status.Enabled,
		Running:   status.Running,
		LastError: status.LastError,
	}, nil
}

// AllStatuses returns the status of all connectors
func (r *Registry) AllStatuses() []ConnectorStatus {
	r.mu.RLock()
	defer r.mu.RUnlock()

	result := make([]ConnectorStatus, 0, len(r.status))
	for _, s := range r.status {
		result = append(result, ConnectorStatus{
			Name:      s.Name,
			Enabled:   s.Enabled,
			Running:   s.Running,
			LastError: s.LastError,
		})
	}
	return result
}

// SendMessage sends a message through a specific connector.
func (r *Registry) SendMessage(connectorName, connectionID, recipientID, message string) error {
	c, err := r.Get(connectorName)
	if err != nil {
		return err
	}

	return c.SendMessage(connectionID, recipientID, message)
}

// ManifestCapabilities returns the capability allowlist declared by the named
// connector's manifest, or ok=false if no connector with that name is
// registered. The runtime uses this as the ceiling when evaluating permissions
// for runs originating from this connector.
func (r *Registry) ManifestCapabilities(name string) ([]string, bool) {
	c, err := r.Get(name)
	if err != nil {
		return nil, false
	}
	return c.Manifest().Permissions, true
}

// IsRunning returns true if the specified connector is running
func (r *Registry) IsRunning(name string) bool {
	r.mu.RLock()
	defer r.mu.RUnlock()

	status, exists := r.status[name]
	return exists && status.Running
}

// Restart stops and starts a connector
func (r *Registry) Restart(ctx context.Context, name string) error {
	r.mu.Lock()
	defer r.mu.Unlock()

	c, exists := r.connectors[name]
	if !exists {
		return fmt.Errorf("connector '%s' not found", name)
	}

	status := r.status[name]
	if status == nil {
		return fmt.Errorf("connector '%s' status not found", name)
	}

	// Stop if running
	if status.Running {
		if err := c.Stop(); err != nil {
			status.LastError = err.Error()
			log.Printf("Failed to stop connector %s for restart: %v", name, err)
			return err
		}
		status.Running = false
	}

	// Update enabled status from connector
	status.Enabled = c.IsEnabled()

	// Start if enabled
	if status.Enabled {
		if err := c.Start(ctx); err != nil {
			status.LastError = err.Error()
			log.Printf("Failed to start connector %s after restart: %v", name, err)
			return err
		}
		status.Running = true
		status.LastError = ""
	}

	return nil
}
