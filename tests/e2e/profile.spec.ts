import { test, expect } from '@playwright/test';

test.describe('Profile', () => {
    test('Loads and updates profile', async ({ page }) => {
        // Mock Auth
        await page.route('**/auth/v1/user', async route => {
            if (route.request().method() === 'PUT') {
                const body = route.request().postDataJSON();
                await route.fulfill({
                    json: {
                        id: 't1',
                        email: 'trainee@example.com',
                        user_metadata: { ...body.data }
                    }
                });
            } else {
                await route.fulfill({
                    json: {
                        id: 't1',
                        email: 'trainee@example.com',
                        user_metadata: { role: 'TRAINEE', full_name: 'Original Name' }
                    }
                });
            }
        });

        // We assume the page loads successfully. 
        // Since we don't have a reliable session setup without a real backend or complex mock, 
        // we rely on the component using the mocked network responses.

        // Mock Token Endpoint for Login
        await page.route('**/auth/v1/token*', async route => {
            await route.fulfill({
                json: {
                    access_token: 'fake-token',
                    token_type: 'bearer',
                    expires_in: 3600,
                    refresh_token: 'fake-refresh',
                    user: {
                        id: 't1',
                        aud: 'authenticated',
                        role: 'authenticated',
                        email: 'trainee@example.com',
                    }
                }
            });
        });

        // Mock Profiles Endpoint (needed for AuthContext to load profile and redirect)
        await page.route('**/rest/v1/profiles*', async route => {
            const method = route.request().method();

            if (method === 'GET') {
                await route.fulfill({
                    json: [{ // Return ARRAY
                        id: 't1',
                        full_name: 'Original Name',
                        role: 'TRAINEE',
                        email: 'trainee@example.com',
                        is_active: true
                    }]
                });
                return;
            }

            if (method === 'PATCH' || method === 'POST') { // updateProfile uses UPDATE (PATCH in REST)
                const body = route.request().postDataJSON();
                // Just return success
                await route.fulfill({ status: 200, json: body });
                return;
            }

            await route.continue();
        });

        // Login logic
        await page.goto('/login');
        await page.getByLabel(/e-mail-adresse/i).fill('trainee@example.com');
        await page.getByLabel(/passwort/i).fill('password123');
        await page.getByRole('button', { name: /anmelden/i }).click();

        // Now navigate or expect redirect
        await expect(page).toHaveURL(/\/trainee\/dashboard/, { timeout: 10000 }); // Wait for redirect

        await page.goto('/trainee/profile');

        // Wait for profile to load
        await expect(page.getByText('Original Name')).toBeVisible({ timeout: 10000 });

        // Edit
        await page.getByLabel(/profil bearbeiten/i).click();

        // Change Name - Adjust selector if needed based on Profile.tsx check
        await page.getByLabel(/vollständiger name/i).fill('Updated Name');

        await page.getByText('Speichern').click();

        // Verify update
        await expect(page.getByText('Updated Name')).toBeVisible();
    });
});
