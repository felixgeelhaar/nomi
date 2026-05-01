// Package calendar implements the Calendar plugin — a tool-only plugin
// for listing, creating, updating, and deleting events across a
// provider-agnostic interface. v1 ships Google Calendar. Outlook and
// CalDAV slot in behind the same Provider interface.
package calendar

import (
	"context"
	"time"
)

// PluginID is the stable reverse-DNS identifier.
const PluginID = "com.nomi.calendar"

// Event is the trimmed representation of a calendar event the plugin
// works with across providers. Fields that don't exist on a given
// provider (e.g. Google Calendar doesn't have Outlook's "isAllDay")
// map to empty / zero values rather than provider-specific types so
// the runtime never has to know which backend answered.
type Event struct {
	ID          string
	Title       string
	Description string
	Start       time.Time
	End         time.Time
	Attendees   []string // email addresses
	Location    string
	// ProviderData carries any provider-specific fields we want to
	// round-trip without modeling explicitly (e.g. Google's
	// hangoutLink). Opaque to callers.
	ProviderData map[string]any
}

// FreeSlot is a contiguous free block returned by FindFreeSlots.
type FreeSlot struct {
	Start time.Time
	End   time.Time
}

// Provider abstracts a calendar backend. Each Connection picks one
// provider (Google today; Outlook / CalDAV future); the tool layer
// routes calls through this interface so tool implementations stay
// backend-agnostic.
type Provider interface {
	// ListUpcoming returns events starting between from and to, ordered
	// by start time. limit caps the result set — callers wanting "next
	// meeting" ask for 1.
	ListUpcoming(ctx context.Context, calendarID string, from, to time.Time, limit int) ([]Event, error)

	// CreateEvent inserts a new event and returns the created row
	// including the provider-assigned ID.
	CreateEvent(ctx context.Context, calendarID string, event Event) (Event, error)

	// UpdateEvent patches an existing event. Missing fields are left
	// unchanged on the provider side.
	UpdateEvent(ctx context.Context, calendarID, eventID string, event Event) (Event, error)

	// DeleteEvent removes an event. Idempotent: deleting an already-
	// gone event must not error.
	DeleteEvent(ctx context.Context, calendarID, eventID string) error

	// FindFreeSlots returns contiguous free blocks of at least `duration`
	// between from and to, across the supplied calendarIDs. Primary
	// calendar is typically "primary" on Google / "calendar" on Outlook.
	FindFreeSlots(ctx context.Context, calendarIDs []string, from, to time.Time, duration time.Duration) ([]FreeSlot, error)
}

// ProviderKind enumerates supported backends. Exposed to the UI so the
// connection form can render a dropdown.
type ProviderKind string

const (
	ProviderGoogle  ProviderKind = "google"
	ProviderOutlook ProviderKind = "outlook" // not implemented in v1
)

// IsValid reports whether the kind is recognized.
func (k ProviderKind) IsValid() bool {
	switch k {
	case ProviderGoogle, ProviderOutlook:
		return true
	}
	return false
}
