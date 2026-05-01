package calendar

import (
	"testing"
	"time"
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
	// Calendar is tool-only — must not advertise a channel role.
	if len(m.Contributes.Channels) != 0 {
		t.Fatalf("calendar must not contribute a channel role: %+v", m.Contributes.Channels)
	}
	// Must contribute all five tool names the runtime will register.
	want := map[string]bool{
		"calendar.list_upcoming":   false,
		"calendar.create_event":    false,
		"calendar.update_event":    false,
		"calendar.delete_event":    false,
		"calendar.find_free_slots": false,
	}
	for _, tc := range m.Contributes.Tools {
		if _, ok := want[tc.Name]; ok {
			want[tc.Name] = true
		}
	}
	for name, ok := range want {
		if !ok {
			t.Fatalf("manifest missing tool: %s", name)
		}
	}
	// Capabilities must include both the read + write narrow capabilities
	// plus network.outgoing (for the HTTP calls to the API).
	capsSeen := map[string]bool{}
	for _, c := range m.Capabilities {
		capsSeen[c] = true
	}
	for _, want := range []string{"calendar.read", "calendar.write", "network.outgoing"} {
		if !capsSeen[want] {
			t.Fatalf("manifest missing capability %q", want)
		}
	}
}

func TestParseInt(t *testing.T) {
	if got := parseInt(map[string]interface{}{}, "missing", 42); got != 42 {
		t.Fatalf("default fallback: %d", got)
	}
	if got := parseInt(map[string]interface{}{"limit": float64(25)}, "limit", 0); got != 25 {
		t.Fatalf("float coercion: %d", got)
	}
	if got := parseInt(map[string]interface{}{"limit": "10"}, "limit", 0); got != 10 {
		t.Fatalf("string fallback: %d", got)
	}
}

func TestParseTime_RFC3339Required(t *testing.T) {
	in := map[string]interface{}{"from": "2026-05-01T10:00:00Z"}
	got, err := parseTime(in, "from", time.Time{})
	if err != nil {
		t.Fatalf("parseTime: %v", err)
	}
	if got.Year() != 2026 || got.Month() != time.May {
		t.Fatalf("parsed time wrong: %v", got)
	}
	_, err = parseTime(map[string]interface{}{"from": "not-a-date"}, "from", time.Time{})
	if err == nil {
		t.Fatal("expected error on non-RFC3339 input")
	}
}

func TestStringSliceFromInput_CoerceShapes(t *testing.T) {
	cases := []struct {
		in   interface{}
		want int
	}{
		{nil, 0},
		{"", 0},
		{"a@b.c", 1},
		{[]string{"a", "b"}, 2},
		{[]interface{}{"a", "", "b"}, 2},
	}
	for _, c := range cases {
		in := map[string]interface{}{"attendees": c.in}
		if got := len(stringSliceFromInput(in, "attendees")); got != c.want {
			t.Fatalf("stringSliceFromInput(%v) = %d, want %d", c.in, got, c.want)
		}
	}
}
