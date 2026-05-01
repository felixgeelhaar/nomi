// Package gmail implements the Gmail plugin — a tool-only plugin that
// uses the Gmail REST API for operations the SMTP/IMAP email plugin
// can't express (HTML drafts, label management, thread search,
// archive). v1 is Google-only; the Provider interface keeps the door
// open for IMAP-based equivalents if a "Gmail-API-without-OAuth" need
// shows up.
package gmail

import (
	"context"
	"time"
)

// PluginID is the stable reverse-DNS identifier.
const PluginID = "com.nomi.gmail"

// Message is the trimmed cross-provider representation of a Gmail
// message. Anything provider-specific (Gmail's snippet, internalDate,
// historyId) hangs off ProviderData so callers don't bind to one
// backend's shape.
type Message struct {
	ID       string
	ThreadID string
	From     string
	To       []string
	Cc       []string
	Subject  string
	// Snippet is a short body preview; full content reads come back
	// only when the caller explicitly requests the whole thread.
	Snippet      string
	Date         time.Time
	Labels       []string
	BodyText     string // plaintext body, populated by ReadThread; empty in search results
	BodyHTML     string // HTML body, populated by ReadThread; empty in search results
	ProviderData map[string]any
}

// Thread is one Gmail conversation.
type Thread struct {
	ID       string
	Subject  string // derived from the first message's subject
	Snippet  string // Gmail's per-thread snippet
	Messages []Message
}

// SendOptions is the input to Send. Body is plaintext; if HTML is set,
// the message is sent as multipart/alternative with both parts.
// Attachments are inline by default — Gmail's labels distinguish.
type SendOptions struct {
	To          []string
	Cc          []string
	Bcc         []string
	Subject     string
	Body        string
	HTML        string
	Attachments []Attachment
	// ThreadID lets a reply thread itself in Gmail. Optional.
	ThreadID string
	// Draft true creates a draft instead of sending.
	Draft bool
}

// Attachment is a single file payload. ContentType drives the part
// MIME header; ContentID enables inline-image embedding ("cid:...").
type Attachment struct {
	Filename    string
	ContentType string
	ContentID   string
	Data        []byte
}

// SendResult is what Send returns: the message id (or draft id, when
// Draft was true).
type SendResult struct {
	MessageID string
	ThreadID  string
	IsDraft   bool
}

// Provider abstracts the Gmail backend. Each method maps to one Gmail
// REST endpoint. v1 has one implementation (GoogleProvider over
// gmail.googleapis.com); the interface exists so tests don't need a
// real Google account and so a future IMAP-via-OAuth provider could
// drop in.
type Provider interface {
	// Send delivers a message (or saves a draft when opts.Draft).
	Send(ctx context.Context, opts SendOptions) (SendResult, error)

	// SearchThreads runs a Gmail query (the same syntax as the web
	// search box) and returns matching thread metadata. limit caps
	// results — Gmail returns ~100 per page; v1 fetches one page.
	SearchThreads(ctx context.Context, query string, limit int) ([]Thread, error)

	// ReadThread fetches a thread including every message's body.
	// Heavier than SearchThreads — only call after a search narrowed
	// the candidate set.
	ReadThread(ctx context.Context, threadID string) (Thread, error)

	// GetMessage fetches one message's metadata + headers + body.
	// Used by triggers to enrich a HistoryEvent's bare message id
	// before deciding whether the event matches a rule.
	GetMessage(ctx context.Context, messageID string) (Message, error)

	// Label adds and removes labels on a message in one call. add and
	// remove are Gmail label IDs (e.g. "STARRED", "INBOX") or
	// user-defined label resource ids ("Label_123").
	Label(ctx context.Context, messageID string, add, remove []string) error

	// Archive removes the INBOX label from a message — Gmail's
	// canonical "archive" operation. Convenience wrapper over Label.
	Archive(ctx context.Context, messageID string) error

	// LatestHistoryID returns the current historyId for the mailbox.
	// Triggers call this on first poll to establish a baseline so the
	// next poll's History call only returns events that occurred
	// after the trigger started.
	LatestHistoryID(ctx context.Context) (string, error)

	// History returns mailbox events since startHistoryID. labelFilter
	// (if non-empty) restricts the response to events involving that
	// label — useful for label_watch triggers but ignored by others
	// since the runtime filter cost is negligible. Returns the events
	// plus the newest historyId observed (which the caller stores for
	// the next poll's startHistoryID).
	History(ctx context.Context, startHistoryID string, labelFilter string) ([]HistoryEvent, string, error)
}

// HistoryEvent is one mailbox change observed by the History API.
// Kind distinguishes between a brand-new message and an existing
// message that gained a label — both are interesting to triggers
// but want different rule-matching logic.
type HistoryEvent struct {
	HistoryID string
	Kind      HistoryEventKind
	MessageID string
	ThreadID  string
	// AddedLabelIDs is populated for HistoryLabelAdded events;
	// empty for HistoryMessageAdded.
	AddedLabelIDs []string
}

// HistoryEventKind enumerates the deltas we care about. Gmail's
// history API also reports messagesDeleted and labelsRemoved, but
// triggers don't fire on removals in v1.
type HistoryEventKind string

const (
	HistoryMessageAdded HistoryEventKind = "message_added"
	HistoryLabelAdded   HistoryEventKind = "label_added"
)

// ProviderKind enumerates supported backends. Mirrors the calendar
// plugin's pattern — we have one provider in v1 but the constant is
// already wired so future additions don't churn the connection
// schema.
type ProviderKind string

const (
	ProviderGoogle ProviderKind = "google"
)

// IsValid reports whether the kind is recognized.
func (k ProviderKind) IsValid() bool {
	return k == ProviderGoogle
}
