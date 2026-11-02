import { expect, test } from '@playwright/test';

test('loads the dashboard, lists the agent service, and streams its logs', async ({ page }) => {
  await page.goto('/');

  // The app shell renders.
  await expect(page.getByText('Flightdeck')).toBeVisible();

  // The fake agent's service appears in the sidebar (name + host).
  const service = page.getByRole('button').filter({ hasText: 'e2e-host' }).first();
  await expect(service).toBeVisible({ timeout: 15_000 });

  // Selecting it streams live logs from the control plane.
  await service.click();
  await expect(page.getByText('E2E hello world').first()).toBeVisible({ timeout: 15_000 });
});
