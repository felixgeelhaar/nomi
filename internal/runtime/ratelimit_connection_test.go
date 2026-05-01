package runtime

import "testing"

func TestAllowConnectionToolCall_EmptyIDOptsOut(t *testing.T) {
	rl := newRateLimiter(100, 10, 1, 1)
	// Empty connection id must never be rate-limited — system tools
	// (filesystem, shell, llm) don't route through plugin Connections.
	for i := 0; i < 10; i++ {
		if !rl.AllowConnectionToolCall("") {
			t.Fatalf("empty connection id should always be allowed (iter %d)", i)
		}
	}
}

func TestAllowConnectionToolCall_EnforcesBudget(t *testing.T) {
	rl := newRateLimiter(100, 10, 1, 1)
	// burst=1 — first call allowed, second denied.
	if !rl.AllowConnectionToolCall("gmail-work") {
		t.Fatal("first call should be allowed")
	}
	if rl.AllowConnectionToolCall("gmail-work") {
		t.Fatal("second call in same burst should be denied")
	}
	// A different connection has its own bucket.
	if !rl.AllowConnectionToolCall("gmail-personal") {
		t.Fatal("second connection should have its own budget")
	}
}

func TestForgetConnection_ClearsBucket(t *testing.T) {
	rl := newRateLimiter(100, 10, 1, 1)
	_ = rl.AllowConnectionToolCall("c")
	if rl.AllowConnectionToolCall("c") {
		t.Fatal("bucket should be empty after single allow")
	}
	rl.ForgetConnection("c")
	if !rl.AllowConnectionToolCall("c") {
		t.Fatal("after Forget, a fresh bucket should allow")
	}
}
