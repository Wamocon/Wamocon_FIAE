import { test, expect } from '@playwright/test';

test.describe('Dashboard', () => {
    test('Loads dashboard data', async ({ page }) => {
        page.on('console', msg => console.log('PAGE LOG:', msg.text()));
        page.on('request', request => console.log('>>', request.method(), request.url()));

        // Mock Auth
        await page.route('**/auth/v1/user', async route => {
            await route.fulfill({
                json: {
                    id: 't1',
                    email: 'trainee@example.com',
                    user_metadata: { role: 'TRAINEE' }
                }
            });
        });

        // Mock Dashboard API
        await page.route('**/api/trainee/dashboard', async route => { // STRICT match
            console.log('Intercepted dashboard API request');
            await route.fulfill({
                json: {
                    modules: [{ id: 'c1', title: 'Course 1', progress: 50 }],
                    nextItem: { lessonTitle: 'Keep Going' },
                    weeklyProgress: [],
                    skillRadar: [],
                    achievements: [],
                    deadlines: []
                }
            });
        });

        // Mock Profiles Endpoint
        await page.route('**/rest/v1/profiles*', async route => {
            await route.fulfill({
                json: [{ // Return ARRAY
                    id: 't1',
                    full_name: 'Original Name',
                    role: 'TRAINEE',
                    email: 'trainee@example.com',
                    is_active: true
                }]
            });
        });

        // Mock Token (Login)
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

        // Login
        await page.goto('/login');
        await page.getByLabel(/e-mail-adresse/i).fill('trainee@example.com');
        await page.getByLabel(/passwort/i).fill('password123');
        await page.getByRole('button', { name: /anmelden/i }).click();

        await expect(page).toHaveURL(/\/trainee\/dashboard/);

        // Verify Dashboard Content
        try {
            await expect(page.getByText('Course 1')).toBeVisible({ timeout: 5000 });
        } catch (e) {
            console.log('Dashboard content assertion failed. Body:', await page.locator('body').innerText());
            throw e;
        }
    });
});
