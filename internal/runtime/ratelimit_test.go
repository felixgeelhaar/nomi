package runtime

import "testing"

func TestTokenBucketBurstThenDenies(t *testing.T) {
	b := newTokenBucket(60, 3) // 1/sec rate, 3 burst
	for i := 0; i < 3; i++ {
		if !b.Allow() {
			t.Fatalf("burst call %d should be allowed", i)
		}
	}
	if b.Allow() {
		t.Fatal("4th call should be denied: burst exhausted and no refill yet")
	}
}

func TestRateLimiterPerSourceIsolation(t *testing.T) {
	rl := newRateLimiter(60, 1, 60, 1)
	if !rl.AllowRun("telegram") {
		t.Fatal("first telegram run should pass")
	}
	if rl.AllowRun("telegram") {
		t.Fatal("second telegram run should be denied (burst 1)")
	}
	if !rl.AllowRun("slack") {
		t.Fatal("slack source shouldn't share telegram's budget")
	}
}

func TestRateLimiterPerRunIsolation(t *testing.T) {
	rl := newRateLimiter(60, 1, 60, 2)
	for i := 0; i < 2; i++ {
		if !rl.AllowToolCall("run-A") {
			t.Fatalf("run-A call %d should pass", i)
		}
	}
	if rl.AllowToolCall("run-A") {
		t.Fatal("run-A third call should be denied")
	}
	if !rl.AllowToolCall("run-B") {
		t.Fatal("run-B has its own budget")
	}
}

func TestRateLimiterForgetRun(t *testing.T) {
	rl := newRateLimiter(60, 1, 60, 1)
	if !rl.AllowToolCall("run-X") {
		t.Fatal("first call should pass")
	}
	if rl.AllowToolCall("run-X") {
		t.Fatal("second call should be denied before forget")
	}
	rl.ForgetRun("run-X")
	if !rl.AllowToolCall("run-X") {
		t.Fatal("after ForgetRun the bucket is recreated with full burst")
	}
}
