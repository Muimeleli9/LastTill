import { test, expect } from '@playwright/test';
import { mockSupabase } from './mock.js';

const pages = [
  ['dashboard', 'Hello, Alex'], ['budget', 'Your Budget'], ['expense', 'Add Expense'],
  ['savings', 'Savings Goals'], ['emergency', 'Emergency Fund'], ['tillcheck', 'TillCheck'],
  ['profile', 'My Profile'], ['settings', 'Settings']
];
for (const mobile of [false, true]) {
  test(`all application pages render real empty states at ${mobile ? 'mobile' : 'desktop'} width`, async ({ page }, testInfo) => {
    await page.setViewportSize(mobile ? { width: 390, height: 844 } : { width: 1440, height: 1000 });
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await mockSupabase(page);
    for (const [file, title] of pages) {
      await page.goto(`/${file}.html`);
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(title);
      if (file === 'dashboard') await page.screenshot({ path: testInfo.outputPath('dashboard.png'), fullPage: true });
      await expect(page.locator('body')).not.toContainText('Rita');
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
    }
    if (mobile) {
      await page.getByRole('button', { name: 'Menu', exact: true }).click();
      await expect(page.getByRole('navigation').getByRole('link', { name: 'Dashboard' })).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(page.getByRole('button', { name: 'Menu', exact: true })).toHaveAttribute('aria-expanded', 'false');
    }
    expect(errors).toEqual([]);
  });
}
test('private pages redirect before requesting personal data', async ({ page }) => {
  const mock = await mockSupabase(page, { signedIn: false });
  await page.goto('/expense.html');
  await expect(page).toHaveURL(/login.html\?next=expense.html/);
  await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();
  expect(mock.requests.filter(r => r.path.includes('/rest/'))).toEqual([]);
});
test('signup validates passwords and passes name/account type to Auth', async ({ page }, testInfo) => {
  const mock = await mockSupabase(page, { signedIn: false });
  await page.goto('/register.html');
  await expect(page.getByRole('heading', { name: 'Start your next chapter' })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('signup-desktop.png'), fullPage: true });
  await page.getByLabel('Full name', { exact: true }).fill('Taylor User');
  await page.getByLabel('Email address').fill('taylor@example.com');
  await page.getByLabel('Create a password', { exact: true }).fill('Example123!');
  await page.getByLabel('Confirm password').fill('Different123!');
  await page.getByRole('button', { name: 'Create account', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Passwords do not match');
  expect(mock.requests.some(r => r.path.endsWith('/signup'))).toBeFalsy();
  await page.getByLabel('Confirm password').fill('Example123!');
  await page.getByRole('radio', { name: /Employed/ }).check();
  await page.getByRole('button', { name: 'Create account', exact: true }).click();
  await expect(page.locator('#feedback')).toContainText('Check your inbox');
  expect(mock.requests.find(r => r.path.endsWith('/signup')).body.data).toEqual({ full_name: 'Taylor User', account_type: 'Employed' });
});
test('email login keeps destination local and restores the session', async ({ page }) => {
  await mockSupabase(page, { signedIn: false });
  await page.goto('/login.html?next=https://example.com');
  await page.getByLabel('Email address').fill('tester@example.com');
  await page.getByLabel('Password', { exact: true }).fill('Example123!');
  await page.getByRole('button', { name: 'Log In', exact: true }).click();
  await expect(page).toHaveURL(/dashboard.html$/);
  await expect(page.getByRole('heading', { name: 'Hello, Alex' })).toBeVisible();
});
test('Google login requests OAuth with PKCE and local callback', async ({ page }) => {
  await mockSupabase(page, { signedIn: false });
  await page.goto('/login.html');
  await page.getByRole('button', { name: 'Continue with Google' }).click();
  await expect(page).toHaveURL(/auth\/v1\/authorize/);
  const url = new URL(page.url());
  expect(url.searchParams.get('provider')).toBe('google');
  expect(url.searchParams.get('redirect_to')).toBe('http://127.0.0.1:5174/auth-callback.html');
  expect(url.searchParams.get('code_challenge_method')).toBe('s256');
});
test('confirmation resend and password reset request use configured callbacks', async ({ page }) => {
  const mock = await mockSupabase(page, { signedIn: false });
  await page.goto('/login.html');
  await page.getByLabel('Email address').fill('tester@example.com');
  await page.locator('summary').click();
  await page.getByRole('button', { name: 'Resend confirmation' }).click();
  await expect(page.locator('#feedback')).toContainText('confirmation is needed');
  await page.getByRole('button', { name: 'Send reset link' }).click();
  await expect(page.locator('#feedback')).toContainText('password-reset link');
  expect(mock.requests.some(r => r.path.endsWith('/recover') && r.query.includes('flow%3Drecovery'))).toBeTruthy();
});
test('callback errors clear URL credentials and offer login', async ({ page }) => {
  await mockSupabase(page, { signedIn: false });
  await page.goto('/auth-callback.html?error=access_denied&token_hash=secret-test');
  await expect(page.getByRole('alert')).toContainText('canceled or the link expired');
  expect(page.url()).not.toContain('secret-test');
  await expect(page.getByRole('link', { name: 'Return to Log In' })).toBeVisible();
});
test('recovery callback leads to password reset, never the dashboard', async ({ page }) => {
  const mock = await mockSupabase(page, { signedIn: false });
  await page.goto('/auth-callback.html?flow=recovery&token_hash=test-recovery&type=recovery');
  await expect(page).toHaveURL(/reset-password.html$/);
  await expect(page.getByRole('heading', { name: 'Choose a new password' })).toBeVisible();
  await page.getByLabel('Create a password', { exact: true }).fill('NewExample123!');
  await page.getByLabel('Confirm password').fill('NewExample123!');
  await page.getByRole('button', { name: 'Update password' }).click();
  await expect(page).toHaveURL(/login.html$/);
  expect(mock.requests.some(r => r.method === 'PUT' && r.body.password === 'NewExample123!')).toBeTruthy();
});
test('onboarding saves profile before marking completion', async ({ page }) => {
  const mock = await mockSupabase(page, { onboarded: false });
  await page.goto('/dashboard.html');
  await expect(page).toHaveURL(/onboarding.html$/);
  await page.getByLabel('Account type', { exact: true }).selectOption('Entrepreneur');
  await page.getByLabel('Cash-flow cycle').selectOption('Salary date to next salary date');
  await page.getByLabel('Salary day (1–31)').fill('31');
  await page.getByRole('button', { name: 'Start planning' }).click();
  await expect(page).toHaveURL(/dashboard.html$/);
  const profileIndex = mock.requests.findIndex(r => r.path.endsWith('/lt_save_profile'));
  const markerIndex = mock.requests.findIndex(r => r.method === 'PUT' && r.body.data?.lasttill_onboarding_complete);
  expect(profileIndex).toBeGreaterThan(-1); expect(markerIndex).toBeGreaterThan(profileIndex);
});
test('income receipts and category limits persist through the intended RPCs', async ({ page }) => {
  const mock = await mockSupabase(page);
  await page.goto('/budget.html');
  await page.getByLabel('Source name').fill('Salary');
  await page.getByLabel('Amount (ZAR)', { exact: true }).fill('1000.25');
  await page.getByRole('button', { name: 'Add income' }).click();
  await expect(page.locator('#feedback')).toContainText('Saved successfully');
  expect(mock.tables.income_sources[0].amount).toBe('1000.25');
  await page.getByLabel('Limit (ZAR)').fill('0');
  await page.getByRole('button', { name: 'Save category limit' }).click();
  await expect(page.locator('#feedback')).toContainText('Saved successfully');
  expect(mock.tables.budget_categories[0].limit_amount).toBe('0');
});
test('expenses save safely, escape user text, edit and delete', async ({ page }) => {
  const mock = await mockSupabase(page); page.on('dialog', d => d.accept());
  await page.goto('/expense.html');
  await page.getByLabel('Expense name', { exact: true }).fill('<img src=x onerror=alert(1)>');
  await page.getByLabel('Amount (ZAR)', { exact: true }).fill('19.99');
  await page.getByRole('button', { name: 'Save expense' }).click();
  await expect(page.locator('#feedback')).toContainText('Saved successfully');
  expect(mock.tables.expenses).toHaveLength(1);
  await expect(page.locator('.record-row img')).toHaveCount(0);
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  await page.getByLabel('Expense name', { exact: true }).fill('Groceries');
  await page.getByRole('button', { name: 'Update expense' }).click();
  await expect(page.locator('#feedback')).toContainText('Saved successfully');
  expect(mock.tables.expenses[0].name).toBe('Groceries');
  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(page.locator('#feedback')).toContainText('Expense deleted');
  expect(mock.tables.expenses).toHaveLength(0);
});
test('savings goals support creating, contributing and canceling', async ({ page }) => {
  const mock = await mockSupabase(page); page.on('dialog', d => d.accept());
  await page.goto('/savings.html');
  await page.getByLabel('Goal name').fill('Laptop');
  await page.getByLabel('Target amount (ZAR)').fill('2000');
  await page.getByRole('button', { name: 'Create goal', exact: true }).click();
  await page.getByLabel('Amount to save (ZAR)').fill('100');
  await page.getByRole('button', { name: 'Add to goal' }).click();
  await expect(page.locator('#feedback')).toContainText('Saved successfully');
  expect(mock.tables.savings_goals[0].saved_amount).toBe(100);
  await page.getByRole('button', { name: 'Cancel goal' }).click();
  await expect(page.locator('#feedback')).toContainText('Goal canceled');
});
test('emergency deposits, withdrawals and validation work', async ({ page }) => {
  const mock = await mockSupabase(page); page.on('dialog', d => d.accept());
  await page.goto('/emergency.html');
  await page.getByLabel('Amount (ZAR)', { exact: true }).fill('100');
  await page.getByRole('button', { name: 'Record transaction' }).click();
  await expect(page.locator('#feedback')).toContainText('Saved successfully');
  await page.getByLabel('Transaction type').selectOption('withdrawal');
  await page.getByLabel('Amount (ZAR)', { exact: true }).fill('101');
  await page.getByRole('button', { name: 'Record transaction' }).click();
  await expect(page.getByRole('alert')).toContainText('exceeds');
  await page.getByLabel('Amount (ZAR)', { exact: true }).fill('20');
  await page.getByRole('button', { name: 'Record transaction' }).click();
  await expect(page.locator('#feedback')).toContainText('Saved successfully');
  expect(mock.tables.emergency_funds[0].current_balance).toBe(80);
});
test('TillCheck evaluates without an expense and purchases explicitly', async ({ page }) => {
  const mock = await mockSupabase(page); page.on('dialog', d => d.accept());
  await page.goto('/tillcheck.html');
  await page.getByLabel('What do you want to buy?').fill('Dinner');
  await page.getByLabel('Price (ZAR)').fill('100');
  await page.getByRole('button', { name: 'Check purchase', exact: true }).click();
  await expect(page.locator('#feedback')).toContainText('No expense was recorded');
  expect(mock.requests.filter(r => r.path.endsWith('/lt_save_expense'))).toHaveLength(0);
  await page.getByRole('button', { name: 'Record this purchase' }).click();
  await expect(page.getByText('Purchase already recorded.')).toBeVisible();
  expect(mock.requests.filter(r => r.path.endsWith('/lt_purchase_check'))).toHaveLength(1);
});
test('profile and preferences save, logout clears the local session', async ({ page }) => {
  const mock = await mockSupabase(page);
  await page.goto('/settings.html');
  await page.getByLabel('Full name', { exact: true }).fill('Alex Updated');
  await page.getByRole('button', { name: 'Save account details' }).click();
  await expect(page.locator('.profile-details strong')).toHaveText('Alex Updated');
  await page.getByLabel(/Calendar budget warnings/).uncheck();
  await page.getByRole('button', { name: 'Save preferences' }).click();
  await expect(page.locator('#feedback')).toContainText('Preferences saved');
  expect(mock.preferences.notify_budget_alerts).toBe(false);
  await page.getByRole('button', { name: 'Log Out', exact: true }).click();
  await expect(page).toHaveURL(/login.html$/);
  expect(await page.evaluate(() => localStorage.getItem('sb-lasttill-test-auth-token'))).toBeNull();
});
test('failed reads show an error, never invented zero balances', async ({ page }) => {
  const mock = await mockSupabase(page, { failReads: true });
  await page.goto('/dashboard.html');
  await expect(page.getByRole('heading', { name: 'Unable to load your account' })).toBeVisible();
  await expect(page.getByRole('alert')).toContainText('unavailable');
  await expect(page.getByRole('button', { name: 'Retry', exact: true })).toBeVisible();
  await expect(page.getByText('Cycle spendable money', { exact: true })).toHaveCount(0);
  expect(mock.requests.filter(r => r.path.endsWith('/profiles'))).toHaveLength(1);
});

test('canceling an emergency withdrawal neither writes nor announces success', async ({ page }) => {
  const mock = await mockSupabase(page);
  page.on('dialog', dialog => dialog.dismiss());
  await page.goto('/emergency.html');
  await page.getByLabel('Transaction type').selectOption('withdrawal');
  await page.getByLabel('Amount (ZAR)', { exact: true }).fill('20');
  await page.getByRole('button', { name: 'Record transaction' }).click();
  await expect(page.locator('#feedback')).toBeHidden();
  await expect(page.getByRole('button', { name: 'Record transaction' })).toBeEnabled();
  expect(mock.requests.filter(r => r.path.endsWith('/lt_fund_transaction'))).toHaveLength(0);
});

for (const failure of ['network', 'gateway']) {
  test(`a ${failure} write failure is not retried and explains uncertainty`, async ({ page }) => {
    await mockSupabase(page);
    let attempts = 0;
    await page.route('**/rest/v1/rpc/lt_save_expense', async route => {
      attempts++;
      if (failure === 'network') return route.abort('failed');
      return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ message: 'Service unavailable' }) });
    });
    await page.goto('/expense.html');
    await page.getByLabel('Expense name', { exact: true }).fill('Groceries');
    await page.getByLabel('Amount (ZAR)', { exact: true }).fill('25');
    await page.getByRole('button', { name: 'Save expense' }).click();
    await expect(page.getByRole('alert')).toContainText('outcome may be uncertain');
    await expect(page.getByRole('alert')).toContainText('check your history');
    await expect(page.getByRole('button', { name: 'Save expense' })).toBeEnabled();
    expect(attempts).toBe(1);
  });
}

test('a pending financial submission locks controls and rejects duplicate submits', async ({ page }) => {
  await mockSupabase(page);
  let attempts = 0;
  let release;
  const pending = new Promise(resolve => { release = resolve; });
  await page.route('**/rest/v1/rpc/lt_save_expense', async route => {
    attempts++;
    await pending;
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });
  await page.goto('/expense.html');
  await page.getByLabel('Expense name', { exact: true }).fill('Groceries');
  await page.getByLabel('Amount (ZAR)', { exact: true }).fill('25');
  const save = page.getByRole('button', { name: 'Save expense' });
  try {
    await save.click();
    await expect(save).toBeDisabled();
    await expect(page.locator('#feedback')).toHaveText('Saving…');
    await page.locator('#expense-form').dispatchEvent('submit');
  } finally { release(); }
  await expect(page.locator('#feedback')).toContainText('Saved successfully');
  expect(attempts).toBe(1);
});

test('email confirmation completes and removes callback credentials', async ({ page }) => {
  const mock = await mockSupabase(page, { signedIn: false });
  await page.goto('/auth-callback.html?token_hash=test-signup&type=signup');
  await expect(page).toHaveURL(/dashboard.html$/);
  expect(mock.requests.find(r => r.path.endsWith('/verify')).body).toMatchObject({ token_hash: 'test-signup', type: 'signup' });
});

test('expired recovery links cannot open the reset form', async ({ page }) => {
  await mockSupabase(page, { signedIn: false });
  await page.route('**/auth/v1/verify', route => route.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ message: 'Token has expired', code: 'otp_expired' }) }));
  await page.goto('/auth-callback.html?token_hash=expired&type=recovery');
  await expect(page.getByRole('alert')).toContainText('link has expired');
  await expect(page).toHaveURL(/auth-callback.html$/);
  await expect(page.getByRole('button', { name: 'Update password' })).toHaveCount(0);
});

test('unsupported callback types are rejected without verification', async ({ page }) => {
  const mock = await mockSupabase(page, { signedIn: false });
  await page.goto('/auth-callback.html?token_hash=test-token&type=invite');
  await expect(page.getByRole('alert')).toContainText('Unsupported email link');
  expect(mock.requests.some(r => r.path.endsWith('/verify'))).toBeFalsy();
  await expect(page).toHaveURL(/auth-callback.html$/);
});

test('mobile signup supports keyboard account selection and form focus', async ({ page }, testInfo) => {
  await mockSupabase(page, { signedIn: false });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/register.html');
  const student = page.getByRole('radio', { name: /Student/ });
  await student.focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('radio', { name: /Employed/ })).toBeChecked();
  await page.keyboard.press('Tab');
  await expect(page.getByLabel('Full name', { exact: true })).toBeFocused();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
  await page.screenshot({ path: testInfo.outputPath('signup-mobile.png'), fullPage: true });
});

test('income receipts and limits can be edited and removed', async ({ page }) => {
  const mock = await mockSupabase(page);
  page.on('dialog', dialog => dialog.accept());
  await page.goto('/budget.html');
  await page.getByLabel('Source name').fill('Salary');
  await page.getByLabel('Amount (ZAR)', { exact: true }).fill('1000');
  await page.getByRole('button', { name: 'Add income' }).click();
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  await page.getByLabel('Amount (ZAR)', { exact: true }).fill('1100');
  await page.getByRole('button', { name: 'Update receipt' }).click();
  await expect(page.locator('#feedback')).toContainText('Saved successfully');
  expect(mock.tables.income_sources[0].amount).toBe('1100');
  await page.getByLabel('Limit (ZAR)').fill('100');
  await page.getByRole('button', { name: 'Save category limit' }).click();
  await page.getByRole('button', { name: 'Edit limit' }).click();
  await page.getByLabel('Limit (ZAR)').fill('200');
  await page.getByRole('button', { name: 'Save category limit' }).click();
  await expect(page.locator('#feedback')).toContainText('Saved successfully');
  expect(mock.tables.budget_categories[0].limit_amount).toBe('200');
  await page.getByRole('button', { name: 'Remove limit' }).click();
  await expect(page.locator('#feedback')).toContainText('Category limit removed');
  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(page.locator('#feedback')).toContainText('Income receipt deleted');
  expect(mock.tables.income_sources).toHaveLength(0);
  expect(mock.tables.budget_categories).toHaveLength(0);
});

test('expense histories request bounded pages and navigate in both directions', async ({ page }) => {
  await mockSupabase(page);
  const offsets = [];
  await page.route('**/rest/v1/expenses?*', route => {
    const params = new URL(route.request().url()).searchParams;
    const offset = Number(params.get('offset')); const limit = Number(params.get('limit'));
    offsets.push(offset);
    expect(limit).toBe(11);
    const rows = Array.from({ length: 12 }, (_, i) => ({ expense_id: 12 - i, name: `Expense ${12 - i}`, category_id: 1, amount: '10', expense_date: '2026-01-01', payment_method: 'Cash' }));
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(rows.slice(offset, offset + limit)) });
  });
  await page.goto('/expense.html');
  await expect(page.locator('.record-row')).toHaveCount(10);
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(page.getByText('Page 2', { exact: true })).toBeVisible();
  await expect(page.locator('.record-row')).toHaveCount(2);
  await expect(page.getByRole('button', { name: 'Next', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Previous', exact: true }).click();
  await expect(page.getByText('Page 1', { exact: true })).toBeVisible();
  expect(offsets).toEqual([0, 10, 0]);
});

test('marking a notification read refreshes the exact unread count', async ({ page }) => {
  const mock = await mockSupabase(page);
  mock.tables.notifications.push({ notification_id: 1, title: 'Savings milestone', message: 'You reached 50%.', is_read: false, created_at: '2026-01-01T12:00:00Z' });
  await page.goto('/dashboard.html');
  await expect(page.getByRole('heading', { name: 'Notifications · 1 unread' })).toBeVisible();
  await page.getByRole('button', { name: 'Mark read' }).click();
  await expect(page.getByRole('heading', { name: 'Notifications · 0 unread' })).toBeVisible();
  expect(mock.tables.notifications[0].is_read).toBe(true);
});

test('an expired auth session leaves the protected page without personal reads', async ({ page }) => {
  const mock = await mockSupabase(page);
  await page.route('**/auth/v1/user', route => route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ message: 'Session expired' }) }));
  await page.goto('/dashboard.html');
  await expect(page).toHaveURL(/login.html(?:\?.*)?$/);
  await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();
  expect(mock.requests.filter(r => r.path.includes('/rest/'))).toHaveLength(0);
});

test('a PKCE callback without its verifier offers recovery and clears the code', async ({ page }) => {
  await mockSupabase(page, { signedIn: false });
  await page.route('**/auth/v1/token?*', route => route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ message: 'PKCE verifier missing', code: 'bad_code_verifier' }) }));
  await page.goto('/auth-callback.html?code=unusable-code');
  await expect(page.getByRole('alert')).toContainText('original browser session');
  await expect(page).toHaveURL(/auth-callback.html$/);
  await expect(page.getByRole('link', { name: 'Return to Log In' })).toBeVisible();
});
