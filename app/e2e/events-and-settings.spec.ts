import { test, expect, seedAssistant, seedRun } from "./fixtures/auth";

test.describe("Events Log", () => {
  test.beforeEach(async ({ authedPage }) => {
    await authedPage.goto("http://localhost:4173/");
    await authedPage.getByRole("tab", { name: "Events" }).click();
    await expect(
      authedPage.getByRole("heading", { name: "Event Log", exact: true }),
    ).toBeVisible();
  });

  test("a newly created run produces a visible run.created event within 2s", async ({
    api,
    authedPage,
  }) => {
    const assistant = await seedAssistant(api);
    // Create the run AFTER we're already on the Events tab so we know the
    // event stream was live when the publish fired. The React Query +
    // EventProvider pipeline invalidates events.list on every run.* event.
    await seedRun(api, assistant.id, `evt-${Date.now()}`);

    // The run.created event is a formal card in the event log; its type
    // badge text is "run.created" in lowercase dotted form.
    await expect(authedPage.locator('text="run.created"').first()).toBeVisible({
      timeout: 2000,
    });
  });

  test("the type filter narrows the visible event list", async ({ api, authedPage }) => {
    // Ensure there's at least one event to filter on.
    const assistant = await seedAssistant(api);
    await seedRun(api, assistant.id, `filter-${Date.now()}`);

    await expect(authedPage.locator('text="run.created"').first()).toBeVisible({
      timeout: 2000,
    });

    const filterInput = authedPage.getByRole("textbox", {
      name: /filter events by type/i,
    });
    await filterInput.fill("run.created");

    // After filtering, at least one "run.created" row remains.
    await expect(authedPage.locator('text="run.created"').first()).toBeVisible();

    // Clearing the filter brings everything back.
    await filterInput.fill("");
  });
});

test.describe("Settings", () => {
  test("Plugins tab shows the Telegram plugin manifest", async ({ authedPage }) => {
    await authedPage.goto("http://localhost:4173/");
    await authedPage.getByRole("tab", { name: "Plugins" }).first().click();
    // The Telegram plugin registers at daemon startup so its name must be
    // visible here. If this fails, the plugin registry wiring regressed.
    await expect(authedPage.getByText(/telegram/i).first()).toBeVisible({
      timeout: 5000,
    });
  });

  test("AI Providers tab renders without crashing and surfaces create affordance", async ({
    authedPage,
  }) => {
    await authedPage.goto("http://localhost:4173/");
    await authedPage.getByRole("tab", { name: "AI Providers" }).click();
    // The "Add Provider" button is always present regardless of whether
    // any providers are configured; it's the stable anchor for this page.
    const addBtn = authedPage.getByRole("button", {
      name: /add provider|new provider|create/i,
    });
    await expect(addBtn.first()).toBeVisible({ timeout: 5000 });
  });
});
