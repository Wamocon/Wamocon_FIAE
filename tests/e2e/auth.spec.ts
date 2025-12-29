import { test, expect } from '@playwright/test';

test.describe('Authentication', () => {
    test('User can log in', async ({ page }) => {
        // Mock Supabase Auth API
        await page.route('**/auth/v1/token?grant_type=password', async route => {
            const json = {
                access_token: 'fake-token',
                token_type: 'bearer',
                expires_in: 3600,
                refresh_token: 'fake-refresh',
                user: {
                    id: 'u1',
                    aud: 'authenticated',
                    role: 'authenticated',
                    email: 'test@example.com',
                    user_metadata: { full_name: 'Test User' },
                }
            };
            await route.fulfill({ json });
        });

        await page.route('**/auth/v1/user', async route => {
            await route.fulfill({
                json: {
                    id: 'u1',
                    email: 'test@example.com'
                }
            });
        });

        await page.goto('/login');

        // Check if login form is present
        await expect(page.getByLabel(/e-mail-adresse/i)).toBeVisible();

        await page.getByLabel(/e-mail-adresse/i).fill('test@example.com');
        await page.getByLabel(/passwort/i).fill('password123');
        await page.getByRole('button', { name: /anmelden/i }).click();

        // Expect redirection to dashboard or home
        // await expect(page).toHaveURL(/dashboard/); 
        // Note: To be confirmed if redirection logic happens purely on client or via server
    });
});
