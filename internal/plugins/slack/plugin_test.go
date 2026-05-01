package slack

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestManifestShape(t *testing.T) {
	p := &Plugin{}
	m := p.Manifest()
	if m.ID != PluginID {
		t.Fatalf("id: %s", m.ID)
	}
	if m.Cardinality != "multi" {
		t.Fatalf("cardinality: %s", m.Cardinality)
	}
	if len(m.Contributes.Channels) != 1 || m.Contributes.Channels[0].Kind != "slack" {
		t.Fatalf("channels: %+v", m.Contributes.Channels)
	}
	if !m.Contributes.Channels[0].SupportsThreading {
		t.Fatal("slack must advertise SupportsThreading=true")
	}
	// Must require BOTH bot_token and app_token (Socket Mode needs both).
	keys := map[string]bool{}
	for _, cred := range m.Requires.Credentials {
		keys[cred.Key] = cred.Required
	}
	if !keys["bot_token"] || !keys["app_token"] {
		t.Fatalf("slack must require bot_token + app_token; got %+v", keys)
	}
}

func TestSplitExternalID_Valid(t *testing.T) {
	ch, ts, err := splitExternalID("C123:1700000000.000100")
	if err != nil {
		t.Fatalf("split: %v", err)
	}
	if ch != "C123" || ts != "1700000000.000100" {
		t.Fatalf("got %s / %s", ch, ts)
	}
}

func TestBuildApprovalBlocks_EncodesApprovalIDInActionIDs(t *testing.T) {
	blocks := buildApprovalBlocks("Nomi needs approval", "appr-123")
	// Expect 2 blocks: a Section and an Action.
	if len(blocks) != 2 {
		t.Fatalf("expected 2 blocks, got %d", len(blocks))
	}
	// Render to JSON and sniff for the expected action-id pattern; the
	// action IDs are the only thing the interactive handler will
	// dispatch on, so they must round-trip cleanly.
	rendered, err := json.Marshal(blocks)
	if err != nil {
		t.Fatalf("marshal blocks: %v", err)
	}
	if !strings.Contains(string(rendered), "nomi_approve:appr-123") {
		t.Fatalf("approve action id missing from rendered blocks: %s", rendered)
	}
	if !strings.Contains(string(rendered), "nomi_deny:appr-123") {
		t.Fatalf("deny action id missing from rendered blocks: %s", rendered)
	}
}

func TestSplitExternalID_Malformed(t *testing.T) {
	_, _, err := splitExternalID("no-separator-here")
	if err == nil {
		t.Fatal("expected error for malformed id")
	}
	if !strings.Contains(err.Error(), "malformed") {
		t.Fatalf("error message should signal malformed input: %v", err)
	}
}
