package statekit

import (
	"errors"
	"fmt"
	"testing"
)

func TestMachineCurrentStartsAtInitial(t *testing.T) {
	m := NewMachine("start")
	if got := m.Current(); got != "start" {
		t.Fatalf("Current = %q, want %q", got, "start")
	}
}

func TestMachineTransitionRequiresKnownState(t *testing.T) {
	m := NewMachine("a")
	m.AddTransition("a", "b", nil)
	if err := m.Transition("nonexistent", nil); err == nil {
		t.Fatal("expected error transitioning to unknown state")
	}
}

func TestMachineTransitionRequiresDeclaredEdge(t *testing.T) {
	m := NewMachine("a")
	m.AddState("c")
	m.AddTransition("a", "b", nil)
	if err := m.Transition("c", nil); err == nil {
		t.Fatal("expected error for undeclared edge a→c")
	}
	if m.Current() != "a" {
		t.Fatalf("state mutated on failed transition: %s", m.Current())
	}
}

func TestMachineGuardCanVeto(t *testing.T) {
	vetoed := errors.New("veto")
	m := NewMachine("a")
	m.AddTransition("a", "b", func(_, _ State, _ interface{}) error {
		return vetoed
	})
	err := m.Transition("b", nil)
	if err == nil {
		t.Fatal("expected guard to veto")
	}
	if !errors.Is(err, vetoed) {
		t.Fatalf("expected wrapped veto, got %v", err)
	}
	if m.Current() != "a" {
		t.Fatalf("state should not advance when guard vetoes: %s", m.Current())
	}
}

func TestMachineGuardReceivesContext(t *testing.T) {
	var capturedCtx interface{}
	m := NewMachine("a")
	m.AddTransition("a", "b", func(from, to State, ctx interface{}) error {
		if from != "a" || to != "b" {
			t.Fatalf("guard got wrong edge: %s → %s", from, to)
		}
		capturedCtx = ctx
		return nil
	})
	if err := m.Transition("b", "payload"); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if capturedCtx != "payload" {
		t.Fatalf("guard did not receive context; got %v", capturedCtx)
	}
}

func TestMachineCanTransitionFromCurrentOnly(t *testing.T) {
	m := NewMachine("a")
	m.AddTransition("a", "b", nil)
	m.AddTransition("b", "c", nil)
	if !m.CanTransition("b") {
		t.Error("a→b should be allowed")
	}
	if m.CanTransition("c") {
		t.Error("a→c should NOT be allowed (only b→c is declared)")
	}
}

func TestMachineValidTransitionsEnumeratesCurrentEdges(t *testing.T) {
	m := NewMachine("a")
	m.AddTransition("a", "b", nil)
	m.AddTransition("a", "c", nil)
	m.AddTransition("b", "c", nil)

	valid := m.ValidTransitions()
	seen := map[State]bool{}
	for _, s := range valid {
		seen[s] = true
	}
	if len(valid) != 2 || !seen["b"] || !seen["c"] {
		t.Fatalf("ValidTransitions from 'a' = %v, want [b, c]", valid)
	}
}

func TestMachineSetCurrentSkipsValidation(t *testing.T) {
	// SetCurrent is an escape hatch used by repositories when rehydrating
	// persisted state. It must not check whether the incoming state is
	// reachable from the prior state — it's a raw assignment.
	m := NewMachine("a")
	m.AddTransition("a", "b", nil)
	m.SetCurrent("unknown")
	if m.Current() != "unknown" {
		t.Fatalf("SetCurrent did not apply: %s", m.Current())
	}
}

func TestMachineTableDrivenTransitions(t *testing.T) {
	m := NewMachine("draft")
	m.AddTransition("draft", "review", nil)
	m.AddTransition("review", "published", nil)
	m.AddTransition("review", "draft", nil)
	m.AddTransition("published", "archived", nil)

	type step struct {
		from State
		to   State
		ok   bool
	}
	cases := []step{
		{"draft", "review", true},
		{"review", "draft", true},
		{"draft", "published", false},
		{"draft", "archived", false},
		{"published", "review", false},
	}

	for _, c := range cases {
		t.Run(fmt.Sprintf("%s→%s", c.from, c.to), func(t *testing.T) {
			m.SetCurrent(c.from)
			err := m.Transition(c.to, nil)
			if c.ok && err != nil {
				t.Fatalf("expected transition to succeed: %v", err)
			}
			if !c.ok && err == nil {
				t.Fatal("expected transition to fail")
			}
		})
	}
}
