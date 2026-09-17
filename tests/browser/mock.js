import { today } from '../../frontend/js/finance.js';
export const userId = '11111111-1111-4111-8111-111111111111';
export function sessionFor(user) {
  const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
  return { access_token: `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ sub: user.id, aud: 'authenticated', role: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600 })}.test`, refresh_token: 'test-refresh', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, token_type: 'bearer', user };
}
export async function mockSupabase(page, { signedIn = true, onboarded = true, failReads = false } = {}) {
  const user = { id: userId, aud: 'authenticated', role: 'authenticated', email: 'tester@example.com', created_at: '2026-01-01T00:00:00Z', app_metadata: { provider: 'email' }, user_metadata: { full_name: 'Alex Tester', account_type: 'Student', lasttill_onboarding_complete: onboarded } };
  const profile = { id: userId, full_name: 'Alex Tester', account_type: 'Student', monthly_cycle: '1st to month-end', salary_day: null, currency: 'ZAR', is_active: true, created_at: '2026-01-01T00:00:00Z' };
  const preferences = { setting_id: 1, user_id: userId, notify_budget_alerts: true, notify_low_balance: true, notify_goal_progress: true };
  const tables = { categories: [{ category_id: 1, name: 'Groceries' }, { category_id: 2, name: 'Transport' }], expenses: [], income_sources: [], savings_goals: [], savings_contributions: [], emergency_fund_transactions: [], tillcheck_history: [], notifications: [], emergency_funds: [] };
  const requests = [];
  if (signedIn) await page.addInitScript(session => {
    if (!sessionStorage.getItem('lasttill.test-seeded')) {
      localStorage.setItem('sb-lasttill-test-auth-token', JSON.stringify(session));
      sessionStorage.setItem('lasttill.test-seeded', 'true');
    }
  }, sessionFor(user));
  await page.route('https://lasttill-test.supabase.co/**', async route => {
    const req = route.request(); const url = new URL(req.url());
    const body = req.postData() ? JSON.parse(req.postData()) : {};
    requests.push({ path: url.pathname, method: req.method(), body, query: url.searchParams.toString() });
    const respond = (value, status = 200, headers = {}) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(value), headers });
    if (url.pathname.endsWith('/auth/v1/user')) {
      if (req.method() === 'PUT') Object.assign(user.user_metadata, body.data || {});
      return respond(user);
    }
    if (url.pathname.endsWith('/auth/v1/token')) return respond(sessionFor(user));
    if (url.pathname.endsWith('/auth/v1/signup')) return respond({ user, session: null });
    if (url.pathname.endsWith('/auth/v1/verify')) return respond(sessionFor(user));
    if (url.pathname.includes('/auth/v1/')) return respond({});
    if (failReads && req.method() === 'GET') return respond({ message: 'Test database unavailable' }, 503);
    const name = url.pathname.split('/').pop();
    if (url.pathname.includes('/rpc/')) {
      const data = body.p_data || {};
      const income = tables.income_sources.reduce((s, r) => s + Number(r.amount), 0);
      const spent = tables.expenses.reduce((s, r) => s + Number(r.amount), 0);
      const saved = tables.savings_contributions.reduce((s, r) => s + Number(r.amount), 0);
      const deposits = tables.emergency_fund_transactions.filter(r => r.type === 'deposit').reduce((s, r) => s + Number(r.amount), 0);
      const remaining = income - spent - saved - deposits;
      if (name === 'lt_summary') return respond({ start: `${today().slice(0, 7)}-01`, end: '2026-10-01', today: today(), days: 14, income, expenses: spent, savings: saved, deposits, remaining, safe_daily: Math.floor(Math.max(0, remaining) * 100 / 14) / 100 });
      if (name === 'lt_budget') return respond({ budget_id: 1, month: body.p_month, income, spent, categories: tables.budget_categories || [] });
      if (name === 'lt_save_profile') { Object.assign(profile, data); return respond(profile); }
      if (name === 'lt_save_income') {
        const row = { ...data, income_id: data.id || tables.income_sources.length + 1 };
        tables.income_sources = tables.income_sources.filter(r => r.income_id !== row.income_id); tables.income_sources.push(row); return respond(row);
      }
      if (name === 'lt_save_category') {
        const row = { ...data, budget_category_id: 1, spent_amount: spent, name: tables.categories.find(r => r.category_id === Number(data.category_id)).name };
        tables.budget_categories = [row]; return respond(row);
      }
      if (name === 'lt_save_expense') {
        const row = { ...data, expense_id: data.id || tables.expenses.length + 1 };
        tables.expenses = tables.expenses.filter(r => r.expense_id !== row.expense_id); tables.expenses.push(row); return respond(row);
      }
      if (name === 'lt_save_goal') {
        const row = { ...data, goal_id: data.id || tables.savings_goals.length + 1, saved_amount: 0, status: 'active' };
        tables.savings_goals = tables.savings_goals.filter(r => r.goal_id !== row.goal_id); tables.savings_goals.push(row); return respond(row);
      }
      if (name === 'lt_contribute') {
        const row = { ...data, contribution_id: tables.savings_contributions.length + 1 }; tables.savings_contributions.push(row);
        tables.savings_goals.find(r => r.goal_id === Number(data.goal_id)).saved_amount += Number(data.amount); return respond(row);
      }
      if (name === 'lt_save_fund') { tables.emergency_funds = [{ fund_id: 1, user_id: userId, current_balance: 0, ...data }]; return respond(tables.emergency_funds[0]); }
      if (name === 'lt_fund_transaction') {
        if (!tables.emergency_funds.length) tables.emergency_funds.push({ fund_id: 1, current_balance: 0, target_amount: 0 });
        if (data.type === 'withdrawal' && Number(data.amount) > tables.emergency_funds[0].current_balance) return respond({ message: 'Withdrawal exceeds available emergency money' }, 400);
        const row = { ...data, fund_id: 1, transaction_id: tables.emergency_fund_transactions.length + 1 };
        tables.emergency_fund_transactions.push(row); tables.emergency_funds[0].current_balance += Number(data.amount) * (data.type === 'deposit' ? 1 : -1); return respond(row);
      }
      if (name === 'lt_check_purchase') {
        const row = { ...data, check_id: tables.tillcheck_history.length + 1, remaining_before: remaining, remaining_after: remaining - Number(data.amount), safe_daily_before: 50, safe_daily_after: 40, category_exceeded: false, category_unbudgeted: true, was_purchased: false, created_at: `${today()}T12:00:00Z` };
        tables.tillcheck_history.push(row); return respond(row);
      }
      if (name === 'lt_purchase_check') {
        const row = tables.tillcheck_history.find(r => r.check_id === Number(data.id)); row.was_purchased = true; return respond(row);
      }
      const deletes = { lt_delete_expense: ['expenses', 'expense_id'], lt_delete_income: ['income_sources', 'income_id'], lt_delete_category: ['budget_categories', 'budget_category_id'] };
      if (deletes[name]) { const [table, key] = deletes[name]; tables[table] = tables[table].filter(row => row[key] !== Number(data.id)); return respond({ id: data.id }); }
      if (name === 'lt_cancel_goal') { const row = tables.savings_goals.find(r => r.goal_id === Number(data.id)); row.status = 'cancelled'; return respond(row); }
      return respond({});
    }
    if (name === 'profiles') return respond(profile);
    if (name === 'user_settings') { if (req.method() === 'PATCH') Object.assign(preferences, body); return respond(preferences); }
    if (name === 'emergency_funds') return respond(tables.emergency_funds[0] || null);
    if (req.method() === 'HEAD') return route.fulfill({ status: 200, headers: { 'content-range': `0-0/${tables.notifications.filter(row => !row.is_read).length}`, 'access-control-expose-headers': 'content-range' } });
    if (name === 'notifications' && req.method() === 'PATCH') {
      const row = tables.notifications.find(item => item.notification_id === Number(url.searchParams.get('notification_id')?.slice(3)));
      if (!row) return respond({ message: 'Notification not found' }, 404);
      Object.assign(row, body);
      return respond(row);
    }
    return respond(tables[name] || []);
  });
  return { user, profile, tables, preferences, requests };
}
