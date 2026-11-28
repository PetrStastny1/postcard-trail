import { expect, test } from '@playwright/test'

test('the game page loads', async ({ page }) => {
  await page.goto('/')
  await expect(page).toHaveTitle('Postcard Trail')
})
