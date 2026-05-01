import { test, expect } from "./fixtures/auth";

test.describe("Health & Connection", () => {
  test("app loads and reaches the daemon", async ({ authedPage }) => {
    await authedPage.goto("http://localhost:4173/");

    // Header brand.
    await expect(authedPage.getByText("Nomi").first()).toBeVisible();

    // Connection badge goes through "Checking..." briefly then settles on
    // "Connected" once the first /health call succeeds. We wait for the
    // settled state rather than accepting any of the three possibilities
    // — if the badge never reaches Connected, the daemon link is broken.
    await expect(authedPage.getByText("Connected", { exact: true })).toBeVisible({
      timeout: 10_000,
    });
  });

  test("sidebar exposes every top-level tab via role=tab", async ({ authedPage }) => {
    await authedPage.goto("http://localhost:4173/");

    // The sidebar is a real tablist (feature #27). Every entry should be
    // reachable by accessible name. This doubles as the a11y-regression
    // guard: if someone reverts to plain buttons, this fails.
    for (const name of [
      "Chats",
      "Assistants",
      "Approvals",
      "Memory",
      "Events",
      "Plugins",
      "AI Providers",
    ]) {
      await expect(authedPage.getByRole("tab", { name })).toBeVisible();
    }

    // Click through two tabs and assert the selection state updates.
    await authedPage.getByRole("tab", { name: "Events" }).click();
    await expect(
      authedPage.getByRole("tab", { name: "Events" }),
    ).toHaveAttribute("aria-selected", "true");

    await authedPage.getByRole("tab", { name: "Assistants" }).click();
    await expect(
      authedPage.getByRole("tab", { name: "Assistants" }),
    ).toHaveAttribute("aria-selected", "true");
  });
});
