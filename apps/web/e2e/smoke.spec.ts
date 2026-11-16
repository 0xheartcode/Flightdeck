import { expect, test } from '@playwright/test';

test('loads the dashboard, lists the agent service, and streams its logs', async ({ page }) => {
  await page.goto('/');

  // The app shell renders. Match the sidebar brand exactly: body copy now also
  // contains the word "Flightdeck" (e.g. the Overview subtitle), so a loose
  // substring match would be ambiguous under Playwright strict mode.
  await expect(page.getByText('Flightdeck', { exact: true })).toBeVisible();

  // The fake agent's service appears as a row in the Overview table (by host).
  const row = page.getByRole('row').filter({ hasText: 'e2e-host' });
  await expect(row).toBeVisible({ timeout: 15_000 });

  // Opening it streams live logs from the control plane.
  await row.click();
  await expect(page.getByText('E2E hello world').first()).toBeVisible({ timeout: 15_000 });
});
