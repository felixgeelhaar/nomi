package tunnel

import (
	"context"
	"log"
)

// noopAdapter is a no-op tunnel that returns an empty URL.
// Used when tunneling is disabled.
type noopAdapter struct{}

func (a *noopAdapter) Start(ctx context.Context, localAddr string) (string, error) {
	log.Println("[tunnel] No-op tunnel: inbound webhooks disabled")
	return "", nil
}

func (a *noopAdapter) Stop() error { return nil }

func (a *noopAdapter) URL() string { return "" }
