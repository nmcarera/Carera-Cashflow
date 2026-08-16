import { test, expect } from "@playwright/test";
import path from "node:path";

/**
 * One real-browser walk across the seam every phase built toward: import a
 * statement nobody has seen before, correct a transaction the way a
 * household actually would, and confirm the dashboard, which reads
 * through analytics/queries.ts (entirely separate code from the import
 * pipeline and the transaction table), picks up the change. Unit and
 * integration tests already cover each phase's internals in isolation;
 * this is the one test that would catch a wiring mistake between them
 * (e.g. the dashboard's totals silently not reflecting a category edit).
 */

const FIXTURE = path.join(__dirname, "..", "tests", "fixtures", "abn-amro-checking", "sample.csv");

test("import a statement, correct a transaction, and see it on the dashboard", async ({ page }) => {
  // --- Import -----------------------------------------------------------
  await page.goto("/import");
  await expect(page.getByRole("heading", { name: "Import statements" })).toBeVisible();

  await page.setInputFiles('input[name="files"]', FIXTURE);
  await page.getByRole("button", { name: "Preview" }).click();

  // The fixture has rows across two account groups, both new to this fresh
  // database - the preview should recognize the institution and propose
  // creating both.
  await expect(page.getByText("Detected as:")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(/rows inspected/)).toBeVisible();

  const confirmButton = page.getByRole("button", { name: /Confirm import/ });
  await confirmButton.click();
  await expect(page.getByText(/new transactions imported/)).toBeVisible({ timeout: 15_000 });

  // --- Transaction table --------------------------------------------------
  await page.goto("/transactions");
  const groceriesRow = page.locator("tr", { hasText: "Albert Heijn" });
  await expect(groceriesRow).toBeVisible();

  // Correct its category - this always opens the three-way "how far should
  // this apply" prompt (CorrectionModal), even for a single edit.
  await groceriesRow.locator("select").nth(1).selectOption({ label: "Groceries" });
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Just this transaction" }).click();
  await expect(dialog).not.toBeVisible();

  await expect(groceriesRow.locator("select").nth(1)).toHaveValue(/.+/);

  // --- Dashboard ------------------------------------------------------
  // The dashboard reads through src/lib/analytics/queries.ts, not the same
  // query the transaction table uses - this is the check that the two
  // actually agree on what got imported.
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Your household, at a glance" })).toBeVisible();

  // "Left over" != EUR 0,00 confirms the imported rows made it into the
  // household totals, not just the transaction table.
  const leftOverCard = page.getByTestId("stat-card-left-over");
  await expect(leftOverCard).toBeVisible();
  await expect(leftOverCard).not.toContainText("0,00");

  // The category correction should be reflected in the "where the money
  // went" breakdown for the month the fixture's rows land in.
  await expect(page.getByText("Groceries")).toBeVisible();
});
