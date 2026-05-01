package discord

import "testing"

func TestManifestShape(t *testing.T) {
	p := &Plugin{}
	m := p.Manifest()
	if m.ID != PluginID {
		t.Fatalf("id: %s", m.ID)
	}
	if m.Cardinality != "multi" {
		t.Fatalf("cardinality: %s", m.Cardinality)
	}
	if len(m.Contributes.Channels) != 1 || m.Contributes.Channels[0].Kind != "discord" {
		t.Fatalf("channels: %+v", m.Contributes.Channels)
	}
	// Discord bot auth is a single token; the v1 manifest reflects that.
	if len(m.Requires.Credentials) != 1 || m.Requires.Credentials[0].Key != "bot_token" {
		t.Fatalf("credentials: %+v", m.Requires.Credentials)
	}
	want := map[string]bool{"discord.post": true, "network.outgoing": true, "filesystem.read": true}
	for _, cap := range m.Capabilities {
		if !want[cap] {
			t.Fatalf("unexpected capability %s", cap)
		}
	}
}
