import { test, expect } from '@playwright/test';

test.describe('TripMap E2E WOW', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('http://localhost:5173');
        await page.click('text=Sign In');
        await page.click('text=Open Master Dashboard');
    });

    test('1. Dashboard UI visibility', async ({ page }) => {
        await expect(page.locator('table')).toBeVisible();
        await expect(page.locator('.recharts-responsive-container')).toBeVisible();
    });

    test('2. Add Trip functionally', async ({ page }) => {
        await page.click('text=+ Add New Trip');
        await page.fill('#dest-input', 'Dubai');
        await page.fill('#desc-input', 'Luxury Desert');
        await page.fill('#price-input', '4500');
        await page.fill('#days-input', '6');
        await page.click('text=Confirm Trip');
        await expect(page.locator('table')).toContainText('Dubai');
    });

    test('3. Update Trip data', async ({ page }) => {
        await page.locator('text=📝').first().click();
        await page.fill('#dest-input', 'Updated Destination');
        await page.click('text=Confirm Trip');
        await expect(page.locator('table')).toContainText('Updated Destination');
    });

    test('4. Remove Trip and check log', async ({ page }) => {
        await page.locator('text=🗑️').first().click();
        await expect(page.locator('#status-display')).toContainText('DELETE');
    });
});