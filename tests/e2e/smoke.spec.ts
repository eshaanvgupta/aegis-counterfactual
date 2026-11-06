import { expect, test, type Page } from '@playwright/test';

async function open(page: Page, view: string, label: RegExp) {
  if (await page.locator('.menu-toggle').isVisible()) await page.locator('.menu-toggle').click();
  await page.getByRole('navigation').getByRole('button', { name: label }).click();
  await expect(page.locator('.topbar h1')).toContainText(view);
}

test('every workstation view renders recorded evidence without errors', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await expect(page.locator('.topbar h1')).toHaveText('Mission Control');
  await expect(page.getByText('live chain · auto-sync')).toBeAttached();
  await expect(page.locator('.sync-meta')).toContainText('UTC');
  await expect(page.locator('.topbar')).toContainText('NEAR testnet');

  await open(page, 'Attack Laboratory', /Attack Laboratory/);
  await expect(page.locator('.card')).toHaveCount(23);
  await expect(page.locator('.card').filter({ hasText: 'as expected' })).toHaveCount(23);

  await open(page, 'Counterfactual Twin', /Counterfactual Twin/);
  await expect(page.getByText(/REFERENCE · authorized input/)).toBeVisible();
  await expect(page.getByText(/counterfactual variations blocked/)).toBeVisible();

  await open(page, 'Security Swarm', /Security Swarm/);
  await expect(page.locator('.flow-wrap')).toBeVisible();

  await open(page, 'Evidence Explorer', /Evidence Explorer/);
  await expect(page.getByText(/Receipt verified · decision/)).toBeVisible();
  await page.getByRole('button', { name: /Tamper/ }).click();
  await expect(page.getByText('Receipt failed independent verification')).toBeVisible();
  await page.getByRole('button', { name: /Restore original/ }).click();
  await expect(page.getByText(/Receipt verified · decision/)).toBeVisible();

  await open(page, 'Policy Vault', /Policy Vault/);
  await expect(page.getByText(/never in a browser/)).toBeVisible();

  await open(page, 'Agent Command Center', /Agent Command/);
  expect(errors).toEqual([]);
});

test('guided demonstration walks all eight steps', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/#demo');
  const dialog = page.getByRole('dialog', { name: 'Live demonstration' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText(/The owner authorizes exactly one payment/)).toBeVisible();
  for (let i = 0; i < 7; i++) await dialog.getByRole('button', { name: /^Next/ }).click();
  await expect(dialog.getByText('The financial authorization boundary was not.')).toBeVisible();
  await dialog.getByRole('button', { name: /Finish/ }).click();
  await expect(dialog).toBeHidden();
  expect(errors).toEqual([]);
});

test('no horizontal page overflow', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.topbar h1')).toHaveText('Mission Control');
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});

test('live contract probe is judged by the deployed NEAR vault', async ({ page }) => {
  test.setTimeout(90_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await open(page, 'Live Contract Probe', /Live Contract Probe/);
  // Default preset: a prompt-injected invoice. The real contract must block it.
  await expect(page.getByText(/Deployed contract: BLOCKED by/)).toBeVisible({ timeout: 45_000 });
  await expect(page.getByText('browser engine agrees with contract')).toBeVisible();
  await expect(page.getByText('canonical hash parity')).toBeVisible();
  // The authorized invoice is policy-clear on-chain.
  await page.getByRole('button', { name: 'Authorized invoice' }).click();
  await expect(page.getByText(/Deployed contract: policy-clear/)).toBeVisible({ timeout: 45_000 });
  // A swapped invoice with the same payee and amount is caught by the fingerprint binding.
  await page.getByRole('button', { name: 'Swapped invoice' }).click();
  await expect(page.getByText(/BLOCKED by 1 invariant/)).toBeVisible({ timeout: 45_000 });
  await expect(page.locator('.verdict')).toContainText('INVOICE_MISMATCH');
  expect(errors).toEqual([]);
});
