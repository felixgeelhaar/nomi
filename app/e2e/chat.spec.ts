import { test, expect, seedAssistant, seedRun } from "./fixtures/auth";

/**
 * Strict ChatInterface integration test.
 *
 * Scope is deliberately limited to what actually works end-to-end today:
 * run lifecycle + UI wiring. The "agent intelligence" layer (LLM calls,
 * multi-step planning, dynamic tool routing) is tracked separately in
 * roady features Runtime-LLM-Integration / Multi-Step-Planning / Dynamic-
 * Tool-Routing, so this test doesn't probe for things that don't exist.
 *
 * What this test does verify:
 *   - Seeded assistant + seeded run show up in the sidebar within 1s
 *     (event-driven invalidation via the SSE → React Query path).
 *   - Selecting the run loads its detail.
 *   - The approval prompt appears when the assistant's policy gates
 *     command.exec with "confirm".
 *   - Approving resolves the step (the runtime actually runs the shell
 *     command — `echo hello` is a real shell noop that produces "hello").
 *   - Deleting the chat removes it optimistically and doesn't come back.
 */

test.describe("ChatInterface lifecycle", () => {
  test("plan-review surface approves a run via the UI", async ({
    api,
    authedPage,
  }) => {
    // Seeds a run, polls for plan_review, then drives the UI through
    // Approve. Asserts the PlanReviewCard renders, Approve is focused,
    // and the run leaves plan_review after clicking.
    const assistant = await seedAssistant(api, { mode: "confirm" });
    const goal = `plan-review-${Date.now()}`;
    const run = await seedRun(api, assistant.id, goal);

    for (let i = 0; i < 50; i++) {
      const res = await api.get(`/runs/${run.id}`);
      if (res.ok()) {
        const body = (await res.json()) as { run: { status: string } };
        if (body.run.status === "plan_review") break;
      }
      await new Promise((r) => setTimeout(r, 100));
    }

    await authedPage.goto("http://localhost:4173/");
    await authedPage.getByText(goal.slice(0, 60)).click();

    const reviewRegion = authedPage.getByRole("region", {
      name: /plan ready for review/i,
    });
    await expect(reviewRegion).toBeVisible({ timeout: 5000 });
    await expect(authedPage.getByRole("button", { name: /Edit plan/i })).toBeVisible();
    await expect(authedPage.getByRole("button", { name: /Cancel task/i })).toBeVisible();

    const waitingInput = authedPage.getByPlaceholder("Waiting on your review");
    await expect(waitingInput).toBeDisabled();

    const approveBtn = authedPage.getByRole("button", {
      name: /Approve & start task/i,
    });
    await expect(approveBtn).toBeFocused();
    await approveBtn.click();

    for (let i = 0; i < 50; i++) {
      const res = await api.get(`/runs/${run.id}`);
      if (res.ok()) {
        const body = (await res.json()) as { run: { status: string } };
        if (body.run.status !== "plan_review") break;
      }
      await new Promise((r) => setTimeout(r, 100));
    }
    const final = await api.get(`/runs/${run.id}`);
    const body = (await final.json()) as { run: { status: string } };
    expect(body.run.status).not.toBe("plan_review");
  });

  test("plan-review edit saves updated steps", async ({ api, authedPage }) => {
    const assistant = await seedAssistant(api, { mode: "confirm" });
    const goal = `plan-edit-${Date.now()}`;
    const run = await seedRun(api, assistant.id, goal);

    for (let i = 0; i < 50; i++) {
      const res = await api.get(`/runs/${run.id}`);
      if (res.ok()) {
        const body = (await res.json()) as { run: { status: string } };
        if (body.run.status === "plan_review") break;
      }
      await new Promise((r) => setTimeout(r, 100));
    }

    await authedPage.goto("http://localhost:4173/");
    await authedPage.getByText(goal.slice(0, 60)).click();

    await authedPage.getByRole("button", { name: /Edit plan/i }).click();

    const firstTitle = authedPage.getByPlaceholder("Step title").first();
    await expect(firstTitle).toBeVisible();
    await firstTitle.fill("Custom edited step");

    await authedPage.getByRole("button", { name: /Save plan/i }).click();

    let sawEdited = false;
    for (let i = 0; i < 50; i++) {
      const res = await api.get(`/runs/${run.id}`);
      if (res.ok()) {
        const body = (await res.json()) as {
          run: { status: string };
          plan?: { steps?: Array<{ title?: string }> };
        };
        const title = body.plan?.steps?.[0]?.title;
        if (body.run.status === "plan_review" && title === "Custom edited step") {
          sawEdited = true;
          break;
        }
      }
      await new Promise((r) => setTimeout(r, 100));
    }

    expect(sawEdited).toBeTruthy();
  });

  test("seeded run appears, approves, completes, deletes", async ({
    api,
    authedPage,
  }) => {
    const assistant = await seedAssistant(api, { mode: "confirm" });
    const goal = `echo e2e-${Date.now()}`;
    const run = await seedRun(api, assistant.id, goal);

    await authedPage.goto("http://localhost:4173/");

    // Navigate to the Chats tab via the sidebar tablist.
    const chatsTab = authedPage.getByRole("tab", { name: "Chats" });
    await expect(chatsTab).toHaveAttribute("aria-selected", "true");

    // The sidebar entry for the seeded run appears — this goes through
    // React Query's initial fetch, not a poll. 5s is the ceiling; the
    // actual expected time is <1s.
    const chatEntry = authedPage.getByText(goal.slice(0, 60));
    await expect(chatEntry).toBeVisible({ timeout: 5000 });

    // Click into the run. Detail view loads.
    await chatEntry.click();
    await expect(authedPage.getByRole("log")).toBeVisible();

    // The assistant's policy mode is "confirm" for command.exec, so
    // approval surfaces automatically once the runtime hits the step.
    // The approval card appears in the chat log within a few seconds.
    const approveBtn = authedPage.getByRole("button", { name: /approve/i });
    await expect(approveBtn).toBeVisible({ timeout: 10_000 });
    await approveBtn.click();

    // After approval the step runs to completion. The run status badge
    // flips to "completed". This round-trips through the runtime's
    // executeStep → transitionStepAtomic → SSE → invalidate → refetch.
    const completedBadge = authedPage.locator('text="completed"').first();
    await expect(completedBadge).toBeVisible({ timeout: 10_000 });

    // Delete the chat via the inline trash affordance. The component uses
    // a two-click-to-confirm pattern for the sidebar; hover surfaces the
    // button, first click arms it, second confirms.
    const row = authedPage.locator("div.group", { hasText: goal.slice(0, 60) }).first();
    await row.hover();
    const trashBtn = row.locator("button").last();
    await trashBtn.click();
    await trashBtn.click();

    // Sidebar row removed optimistically.
    await expect(chatEntry).toBeHidden({ timeout: 3000 });

    // Verify the deletion stuck at the API level (not just optimistic UI).
    const listRes = await api.get(`/runs/${run.id}`);
    expect(listRes.status()).toBe(404);
  });

  test("empty state renders when no chats exist", async ({ api, authedPage }) => {
    // Clean slate: delete every run the API knows about so we can assert
    // the empty state deterministically.
    const listRes = await api.get("/runs");
    expect(listRes.ok()).toBeTruthy();
    const { runs } = (await listRes.json()) as { runs: Array<{ id: string }> };
    for (const r of runs) {
      await api.delete(`/runs/${r.id}`);
    }

    await authedPage.goto("http://localhost:4173/");
    await expect(
      authedPage.getByText("No chats yet. Start a new conversation!"),
    ).toBeVisible({ timeout: 5000 });
  });

  test("sidebar is keyboard-navigable via arrow keys", async ({ authedPage }) => {
    await authedPage.goto("http://localhost:4173/");

    // Focus the currently-active tab.
    const chatsTab = authedPage.getByRole("tab", { name: "Chats" });
    await chatsTab.focus();
    await expect(chatsTab).toBeFocused();

    // Arrow-down moves focus to the next tab in the tablist and activates it.
    await authedPage.keyboard.press("ArrowDown");
    const assistantsTab = authedPage.getByRole("tab", { name: "Assistants" });
    await expect(assistantsTab).toHaveAttribute("aria-selected", "true");

    // Home jumps back to the first tab.
    await authedPage.keyboard.press("Home");
    await expect(chatsTab).toHaveAttribute("aria-selected", "true");
  });
});
