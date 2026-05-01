package statekit

import (
	"fmt"
)

// State represents a state in the state machine
type State string

// IsValid checks if the state is valid (non-empty)
func (s State) IsValid() bool {
	return s != ""
}

// Transition represents a valid state transition
type Transition struct {
	From State
	To   State
}

// GuardFunc is a function that validates if a transition is allowed
type GuardFunc func(from, to State, context interface{}) error

// StateMachine defines the interface for state machines
type StateMachine interface {
	Current() State
	Transition(to State, context interface{}) error
	CanTransition(to State) bool
	ValidTransitions() []State
}

// Machine implements a generic state machine
type Machine struct {
	current     State
	transitions map[Transition]GuardFunc
	states      map[State]bool
}

// NewMachine creates a new state machine
func NewMachine(initial State) *Machine {
	return &Machine{
		current:     initial,
		transitions: make(map[Transition]GuardFunc),
		states:      make(map[State]bool),
	}
}

// AddState registers a valid state
func (m *Machine) AddState(state State) {
	m.states[state] = true
}

// AddTransition registers a valid transition with an optional guard
func (m *Machine) AddTransition(from, to State, guard GuardFunc) {
	m.transitions[Transition{From: from, To: to}] = guard
	m.AddState(from)
	m.AddState(to)
}

// Current returns the current state
func (m *Machine) Current() State {
	return m.current
}

// SetCurrent sets the current state (use with caution)
func (m *Machine) SetCurrent(state State) {
	m.current = state
}

// CanTransition checks if a transition to the target state is valid
func (m *Machine) CanTransition(to State) bool {
	transition := Transition{From: m.current, To: to}
	_, exists := m.transitions[transition]
	return exists
}

// Transition attempts to transition to a new state
func (m *Machine) Transition(to State, context interface{}) error {
	if !m.states[to] {
		return fmt.Errorf("invalid state: %s", to)
	}

	transition := Transition{From: m.current, To: to}
	guard, exists := m.transitions[transition]
	if !exists {
		return fmt.Errorf("invalid transition from %s to %s", m.current, to)
	}

	// Run guard if present
	if guard != nil {
		if err := guard(m.current, to, context); err != nil {
			return fmt.Errorf("transition guard failed: %w", err)
		}
	}

	m.current = to
	return nil
}

// ValidTransitions returns all valid next states from current state
func (m *Machine) ValidTransitions() []State {
	var valid []State
	for transition := range m.transitions {
		if transition.From == m.current {
			valid = append(valid, transition.To)
		}
	}
	return valid
}
