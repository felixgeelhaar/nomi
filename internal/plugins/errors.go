package plugins

import "fmt"

// ErrConnectionNotBound is the sentinel runtime error for a tool call
// targeting a plugin Connection that the calling assistant isn't bound to.
// ADR 0001 §7 calls this the "hard wall": a jailbroken LLM that tries to
// invoke a plugin tool against an unauthorized Connection fails loud,
// before the tool is even dispatched. Plugin tool implementations should
// wrap this error via ConnectionNotBoundError so callers can unwrap it
// consistently.
var ErrConnectionNotBound = fmt.Errorf("connection_not_bound")

// ConnectionNotBoundError formats a user-facing error describing which
// (assistant, connection, plugin) binding is missing. The wrapped sentinel
// lets runtime code match with errors.Is.
func ConnectionNotBoundError(assistantID, connectionID, pluginID string) error {
	return fmt.Errorf("%w: assistant %q has no enabled binding to connection %q of plugin %q",
		ErrConnectionNotBound, assistantID, connectionID, pluginID)
}

// ApprovalCopyForConnection renders the human-readable approval prompt
// for a capability that operates on a named Connection. The approval
// dialog surfaces the connection display name so the user can spot a
// mis-targeted call ("approve email from personal@…" vs "from work@…")
// before clicking allow.
//
// Returned format is deliberately short — the UI renders it as the
// prompt subtitle below the assistant's own approval message.
func ApprovalCopyForConnection(capability, connectionName string) string {
	if connectionName == "" {
		return fmt.Sprintf("Capability: %s", capability)
	}
	return fmt.Sprintf("Capability: %s — via %s", capability, connectionName)
}
