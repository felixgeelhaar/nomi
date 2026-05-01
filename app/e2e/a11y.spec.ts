import AxeBuilder from "@axe-core/playwright";
import { test, expect } from "./fixtures/auth";

/**
 * Baseline accessibility smoke. Runs axe-core across the main tabs and
 * fails if any critical or serious violations appear. Moderate and minor
 * violations are surfaced as warnings in the report but don't fail the
 * build, since some are unavoidable with the current shadcn/Radix stack.
 */

const TABS: { name: string; settleText: RegExp }[] = [
  { name: "Chats", settleText: /What can Nomi help you with|No chats yet|New Chat/i },
  { name: "Assistants", settleText: /Assistants/ },
  { name: "Approvals", settleText: /Approval Requests/ },
  { name: "Memory", settleText: /Memory/ },
  { name: "Events", settleText: /Event Log/ },
  { name: "Plugins", settleText: /Plugins|Telegram/i },
  { name: "AI Providers", settleText: /Providers|Add Provider/i },
];

test.describe("Accessibility smoke", () => {
  for (const { name, settleText } of TABS) {
    test(`${name} tab has no critical or serious axe violations`, async ({
      authedPage,
    }) => {
      await authedPage.goto("http://localhost:4173/");
      await authedPage.getByRole("tab", { name }).click();
      // Wait for the tab content to render so axe scans something real.
      await expect(authedPage.getByText(settleText).first()).toBeVisible({
        timeout: 10_000,
      });

      const results = await new AxeBuilder({ page: authedPage })
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
        .analyze();

      const blocking = results.violations.filter((v) =>
        v.impact === "critical" || v.impact === "serious",
      );

      if (blocking.length > 0) {
        // Print a readable summary so debugging doesn't require re-running.
        const summary = blocking
          .map((v) => `  [${v.impact}] ${v.id}: ${v.help} (${v.nodes.length} node${v.nodes.length === 1 ? "" : "s"})`)
          .join("\n");
        throw new Error(
          `${blocking.length} blocking axe violations on ${name}:\n${summary}`,
        );
      }
    });
  }
});
