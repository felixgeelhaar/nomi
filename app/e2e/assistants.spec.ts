import { test, expect, seedAssistant } from "./fixtures/auth";

/**
 * Strict assistants test. Seed via the API so the test doesn't depend on
 * whatever state the local daemon happens to carry.
 */

test.describe("Assistant CRUD", () => {
  test.beforeEach(async ({ authedPage }) => {
    await authedPage.goto("http://localhost:4173/");
    // Switch to the Assistants tab via the sidebar tablist.
    await authedPage.getByRole("tab", { name: "Assistants" }).click();
    await expect(
      authedPage.getByRole("heading", { name: "Assistants", exact: true }),
    ).toBeVisible();
  });

  test("seeded assistant shows in the list", async ({ api, authedPage }) => {
    const created = await seedAssistant(api, { name: `test-${Date.now()}` });
    // The assistants tab fetches on mount via React Query; the seeded
    // row must appear within the standard refetch window.
    await expect(authedPage.getByText(created.name)).toBeVisible({ timeout: 5000 });
  });

  test("deleting an assistant removes it from the list", async ({ api, authedPage }) => {
    const created = await seedAssistant(api, { name: `delete-${Date.now()}` });
    const row = authedPage.locator("div", { hasText: created.name }).first();
    await expect(row).toBeVisible({ timeout: 5000 });

    // Click the "Delete" button on the card — it's the destructive
    // variant that opens the ConfirmDialog.
    const deleteBtn = row
      .locator("..")
      .locator("button", { hasText: /^Delete$/ })
      .first();
    await deleteBtn.click();

    // ConfirmDialog appears with the destructive styling. Focus starts on
    // Cancel as a guard-rail; the confirm button is the second action.
    const dialog = authedPage.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: /^Delete$/ }).click();

    // Row disappears from the list (optimistic update + cache
    // invalidation propagating the real delete).
    await expect(authedPage.getByText(created.name)).toBeHidden({ timeout: 5000 });

    // And the API confirms.
    const check = await api.get(`/assistants/${created.id}`);
    expect(check.status()).toBe(404);
  });

  test("cancel button on the delete dialog leaves the assistant intact", async ({
    api,
    authedPage,
  }) => {
    const created = await seedAssistant(api, { name: `keep-${Date.now()}` });
    const row = authedPage.locator("div", { hasText: created.name }).first();
    await expect(row).toBeVisible({ timeout: 5000 });

    const deleteBtn = row
      .locator("..")
      .locator("button", { hasText: /^Delete$/ })
      .first();
    await deleteBtn.click();

    const dialog = authedPage.getByRole("dialog");
    await dialog.getByRole("button", { name: /^Cancel$/ }).click();

    // Dialog closes; assistant is still there on the UI and in the API.
    await expect(dialog).toBeHidden();
    await expect(authedPage.getByText(created.name)).toBeVisible();
    const check = await api.get(`/assistants/${created.id}`);
    expect(check.ok()).toBeTruthy();
  });
});
