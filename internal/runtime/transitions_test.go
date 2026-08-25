package runtime

import (
	"context"
	"sync"
	"testing"

	"go.klarlabs.de/nomi/internal/domain"
)

// TestTransitionRun_ConcurrentLoserGetsErrConcurrentTransition spins
// two goroutines trying to move the same run from RunCreated to two
// different next states. The CAS in transitionRun must let exactly one
// win; the other must surface ErrConcurrentTransition. Without the CAS
// both would silently succeed and the run.* event chain would carry a
// duplicated transition.
func TestTransitionRun_ConcurrentLoserGetsErrConcurrentTransition(t *testing.T) {
	rt, cleanup := setupTestRuntime(t)
	defer cleanup()

	// Seed an assistant + run row directly through the repos so we
	// control the starting status without racing CreateRun's executor
	// goroutine.
	if err := rt.assistantRepo.Create(&domain.AssistantDefinition{
		ID: "a", Name: "A", Role: "x",
	}); err != nil {
		t.Fatalf("seed assistant: %v", err)
	}
	run := &domain.Run{
		ID:          "run-cas-test",
		Goal:        "concurrent test",
		AssistantID: "a",
		Status:      domain.RunCreated,
		PlanVersion: 1,
	}
	if err := rt.runRepo.Create(run); err != nil {
		t.Fatalf("seed run: %v", err)
	}

	var (
		wg         sync.WaitGroup
		successes  int
		concurrent int
		errsMu     sync.Mutex
	)
	wg.Add(2)
	go func() {
		defer wg.Done()
		runCopy := *run
		err := rt.transitionRun(context.Background(), &runCopy, domain.RunPlanning)
		errsMu.Lock()
		defer errsMu.Unlock()
		if err == nil {
			successes++
			return
		}
		if err == ErrConcurrentTransition {
			concurrent++
		} else {
			t.Errorf("unexpected error from goroutine A: %v", err)
		}
	}()
	go func() {
		defer wg.Done()
		runCopy := *run
		err := rt.transitionRun(context.Background(), &runCopy, domain.RunPlanning)
		errsMu.Lock()
		defer errsMu.Unlock()
		if err == nil {
			successes++
			return
		}
		if err == ErrConcurrentTransition {
			concurrent++
		} else {
			t.Errorf("unexpected error from goroutine B: %v", err)
		}
	}()
	wg.Wait()

	if successes != 1 {
		t.Fatalf("expected exactly 1 successful transition, got %d", successes)
	}
	if concurrent != 1 {
		t.Fatalf("expected exactly 1 ErrConcurrentTransition, got %d", concurrent)
	}
}

// TestTransitionRun_StaleSnapshotLoserGetsErrConcurrentTransition covers the
// half of the race the CAS cannot see.
//
// transitionRun re-reads the row before validating. A loser whose read lands
// after the winner has already committed therefore never reaches the CAS at
// all: it validates planning -> planning, which the state machine rejects.
// Reporting that as an invalid transition tells the caller it asked for
// something illegal, when in truth it simply arrived second — and callers are
// documented to treat ErrConcurrentTransition as benign and everything else
// as a fault.
//
// The two-goroutine test above only hits this window when the scheduler
// happens to separate the reads, so it passed for a long time and then failed
// on a loaded machine. This one forces the ordering instead of hoping for it.
func TestTransitionRun_StaleSnapshotLoserGetsErrConcurrentTransition(t *testing.T) {
	rt, cleanup := setupTestRuntime(t)
	defer cleanup()

	if err := rt.assistantRepo.Create(&domain.AssistantDefinition{
		ID: "a", Name: "A", Role: "x",
	}); err != nil {
		t.Fatalf("seed assistant: %v", err)
	}
	run := &domain.Run{
		ID:          "run-stale-snapshot",
		Goal:        "stale snapshot",
		AssistantID: "a",
		Status:      domain.RunCreated,
		PlanVersion: 1,
	}
	if err := rt.runRepo.Create(run); err != nil {
		t.Fatalf("seed run: %v", err)
	}

	// The winner. Its snapshot is current, so it takes the row to planning.
	winner := *run
	if err := rt.transitionRun(context.Background(), &winner, domain.RunPlanning); err != nil {
		t.Fatalf("winner transition: %v", err)
	}

	// The loser still believes the run is created — the snapshot it was
	// handed before the winner committed.
	loser := *run
	err := rt.transitionRun(context.Background(), &loser, domain.RunPlanning)
	if err != ErrConcurrentTransition {
		t.Fatalf("stale-snapshot loser: got %v, want ErrConcurrentTransition", err)
	}
}

// TestTransitionRun_GenuinelyInvalidTransitionStillReportsInvalid guards the
// other direction: a caller holding an up-to-date snapshot that asks for a
// transition the state machine forbids must still be told so. Treating that
// as a lost race would hide real logic errors behind a benign one.
func TestTransitionRun_GenuinelyInvalidTransitionStillReportsInvalid(t *testing.T) {
	rt, cleanup := setupTestRuntime(t)
	defer cleanup()

	if err := rt.assistantRepo.Create(&domain.AssistantDefinition{
		ID: "a", Name: "A", Role: "x",
	}); err != nil {
		t.Fatalf("seed assistant: %v", err)
	}
	run := &domain.Run{
		ID:          "run-invalid",
		Goal:        "invalid",
		AssistantID: "a",
		Status:      domain.RunCreated,
		PlanVersion: 1,
	}
	if err := rt.runRepo.Create(run); err != nil {
		t.Fatalf("seed run: %v", err)
	}

	// Snapshot matches the row, so nothing raced; created -> completed is
	// simply not a legal move.
	snapshot := *run
	err := rt.transitionRun(context.Background(), &snapshot, domain.RunCompleted)
	if err == nil {
		t.Fatal("expected an error for created -> completed")
	}
	if err == ErrConcurrentTransition {
		t.Fatal("a genuinely invalid transition was reported as a lost race")
	}
}
