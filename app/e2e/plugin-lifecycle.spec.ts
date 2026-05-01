/**
 * Plugin lifecycle battle test: uninstall → reinstall → toggle →
 * marketplace browser → capability ceiling — all driven through the
 * actual UI. Replaces the Scout-driven walk that kept disconnecting
 * mid-test.
 *
 * Setup expectations:
 *   - nomid running on :8080 with NOMI_MARKETPLACE_ROOT_KEY set
 *   - vite preview running on :4173 with the dev token injected into
 *     dist/index.html (the app-dev script handles this)
 *   - HOME pointing at the data dir of the test daemon so the
 *     fixture finds the right auth.token
 *   - /tmp/e2e.nomi-plugin exists (the cmd/test-pack-bundle output
 *     used during the live walk)
 */
import { expect } from "@playwright/test";
import { existsSync } from "node:fs";
import { test } from "./fixtures/auth";

const E2E_PLUGIN_ID = "com.e2e.echo";
const E2E_BUNDLE_PATH = "/tmp/e2e.nomi-plugin";

test.describe("plugin lifecycle via UI", () => {
  test.beforeAll(() => {
    if (!existsSync(E2E_BUNDLE_PATH)) {
      throw new Error(
        `${E2E_BUNDLE_PATH} not found. Build it with: ROOT_PRIV=... go run ./cmd/test-pack-bundle internal/plugins/wasmhost/testdata/echo.wasm > ${E2E_BUNDLE_PATH}`,
      );
    }
  });

  test("plugin list order is stable across refetches (no card shuffle)", async ({
    api,
  }) => {
    // Real UX bug from the live walk: Go map iteration randomized
    // every API response, so the UI's 5s polling shuffled all the
    // plugin cards. The runtime contract is now id-sorted; pin it
    // here so the regression can't sneak back in.
    const responses: string[][] = [];
    for (let i = 0; i < 5; i++) {
      const resp = await api.get("/plugins");
      const j = (await resp.json()) as { plugins: Array<{ manifest: { id: string } }> };
      responses.push(j.plugins.map((p) => p.manifest.id));
    }
    // Every response must be identical AND sorted.
    const first = responses[0];
    const sorted = [...first].sort();
    expect(first).toEqual(sorted);
    for (let i = 1; i < responses.length; i++) {
      expect(responses[i]).toEqual(first);
    }
  });

  test("plugins page renders with new disable copy + no daemon jargon", async ({
    authedPage,
  }) => {
    await authedPage.goto("/");
    await authedPage.click("#tab-settings-plugins");
    const pluginPane = authedPage.locator(
      "#radix-_r_0_-content-plugins, [id*='content-plugins']",
    );
    await expect(pluginPane).toBeVisible();

    // The new copy should appear for any disabled plugin. The old
    // "Restart the daemon" string must be gone.
    const allText = await pluginPane.textContent();
    expect(allText).not.toContain("Restart the daemon");
    expect(allText).not.toContain("the daemon");
  });

  test("toggle round-trip (disable → daemon Stop, re-enable → Start)", async ({
    authedPage,
    api,
  }) => {
    // Make sure Telegram starts enabled so the test is deterministic.
    await api.patch(`/plugins/com.nomi.telegram/state`, {
      data: { enabled: true },
    });

    await authedPage.goto("/");
    await authedPage.click("#tab-settings-plugins");

    // The Telegram card's toggle is a label.relative.inline-flex with a
    // checkbox inside. Find the card (shadcn Card uses rounded-xl) by
    // id text + click its toggle.
    const telegramCard = authedPage
      .locator(".rounded-xl")
      .filter({ hasText: "com.nomi.telegram" });
    await expect(telegramCard).toBeVisible();
    const toggle = telegramCard.locator("label.relative.inline-flex").first();
    await toggle.click();

    // The hot-reload should flip both enabled (state) and running (status).
    await expect
      .poll(async () => {
        const r = await api.get("/plugins/com.nomi.telegram");
        const j = await r.json();
        return { enabled: j.state?.enabled, running: j.status?.running };
      })
      .toEqual({ enabled: false, running: false });

    // Round-trip back. Click again — state must return to enabled+running.
    await toggle.click();
    await expect
      .poll(async () => {
        const r = await api.get("/plugins/com.nomi.telegram");
        const j = await r.json();
        return { enabled: j.state?.enabled, running: j.status?.running };
      })
      .toEqual({ enabled: true, running: true });
  });

  test("uninstall via UI: trash → confirm → plugin disappears", async ({
    authedPage,
    api,
  }) => {
    // Start state: e2e plugin must be installed for this test to mean
    // anything. If not installed, install it first via the API so the
    // test is hermetic.
    const initial = await api.get(`/plugins/${E2E_PLUGIN_ID}`);
    if (initial.status() === 404) {
      const buf = await import("node:fs").then((fs) =>
        fs.readFileSync(E2E_BUNDLE_PATH),
      );
      const form = new FormData();
      form.append(
        "bundle",
        new Blob([buf], { type: "application/octet-stream" }),
        "e2e.nomi-plugin",
      );
      const installResp = await api.post("/plugins/install", {
        multipart: { bundle: { name: "e2e.nomi-plugin", mimeType: "application/octet-stream", buffer: buf } },
      });
      expect(installResp.status()).toBe(201);
    }

    await authedPage.goto("/");
    await authedPage.click("#tab-settings-plugins");

    // Trash icon button has an aria-label per the new UI.
    const trashBtn = authedPage.locator(
      `button[aria-label="Uninstall E2E Echo"]`,
    );
    await expect(trashBtn).toBeVisible();
    await trashBtn.click();

    // Confirmation pane opens with a Cancel + Uninstall button.
    const confirmPane = authedPage
      .locator(".border-destructive")
      .filter({ hasText: /Uninstall .*\?/ });
    await expect(confirmPane).toBeVisible();
    await confirmPane.locator('button:has-text("Uninstall")').click();

    // Plugin disappears from the list (registry unregisters + UI refetch).
    await expect(authedPage.getByText("ID: com.e2e.echo")).toBeHidden({
      timeout: 5000,
    });

    // API confirms the underlying state.
    const after = await api.get(`/plugins/${E2E_PLUGIN_ID}`);
    expect(after.status()).toBe(404);
  });

  test("install via UI: dialog → file upload → plugin appears", async ({
    authedPage,
    api,
  }) => {
    // Make sure the plugin is NOT installed at the start so we can
    // exercise the full install flow.
    const initial = await api.get(`/plugins/${E2E_PLUGIN_ID}`);
    if (initial.status() === 200) {
      await api.delete(`/plugins/${E2E_PLUGIN_ID}?cascade=true`);
    }

    await authedPage.goto("/");
    await authedPage.click("#tab-settings-plugins");

    // Open the install dialog.
    await authedPage.getByRole("button", { name: "Install plugin" }).click();
    const dialog = authedPage.locator('[role="dialog"]');
    await expect(dialog).toBeVisible();

    // Switch to file upload mode.
    await dialog.getByRole("button", { name: /Upload file/ }).click();

    // Pick the bundle file. Playwright's setInputFiles handles even
    // hidden inputs.
    await dialog.locator('input[type="file"]').setInputFiles(E2E_BUNDLE_PATH);

    // Click Install.
    await dialog.getByRole("button", { name: "Install" }).click();

    // Dialog closes on success and plugin appears in the list.
    await expect(authedPage.getByText("ID: com.e2e.echo")).toBeVisible({
      timeout: 10_000,
    });
    const after = await api.get(`/plugins/${E2E_PLUGIN_ID}`);
    expect(after.status()).toBe(200);
    const j = await after.json();
    expect(j.state?.distribution).toBe("marketplace");
  });

  test("marketplace browser shows friendly fallback when not configured", async ({
    authedPage,
  }) => {
    await authedPage.goto("/");
    await authedPage.click("#tab-settings-plugins");
    await authedPage.getByRole("button", { name: "Browse marketplace" }).click();

    const dialog = authedPage.locator('[role="dialog"]');
    await expect(dialog).toBeVisible();

    // The dialog should show EITHER the catalog (when configured) OR the
    // friendly "Marketplace not configured" panel. Either way, no
    // "daemon" jargon.
    const dialogText = await dialog.textContent();
    expect(dialogText).not.toContain("daemon");
    expect(dialogText).not.toContain("Daemon");
    // The catalog header should always render.
    expect(dialogText).toContain("Browse marketplace");
  });

  test("assistant builder: declared capabilities only shows 3 honest options", async ({
    authedPage,
  }) => {
    await authedPage.goto("/");
    await authedPage.click("#tab-assistants");

    // Open the create dialog. Use exact button text for stability —
    // a fuzzy regex caught unrelated buttons when the assistants list
    // grew in earlier tests.
    await authedPage
      .getByRole("button", { name: "Create Assistant", exact: true })
      .click();

    // Wait for the dialog to render.
    const dialog = authedPage.locator('[role="dialog"]');
    await expect(dialog).toBeVisible();

    // The Declared capabilities section lives inside the dialog as a
    // div.border.rounded-lg. Scoping the locator under the dialog
    // also avoids matching identically-styled blocks elsewhere on
    // the page.
    const capabilitiesSection = dialog
      .locator("div.border.rounded-lg")
      .filter({ hasText: "Declared capabilities" });
    await expect(capabilitiesSection).toBeVisible();
    const capsText = (await capabilitiesSection.textContent()) ?? "";
    expect(capsText).toContain("Filesystem");
    expect(capsText).toContain("Command");
    expect(capsText).toContain("Web");
    // The dead controls must not appear here anymore.
    expect(capsText).not.toContain("Memory");
    expect(capsText).not.toContain("Connector");
    expect(capsText).not.toContain("Code");
  });
});
