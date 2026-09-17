// Opt-in integration checks against a DISPOSABLE Supabase project with the
// supplied schema and app migration applied. Never point these at production.
// Required process environment: LASTTILL_TEST_SUPABASE_URL,
// LASTTILL_TEST_SERVICE_KEY, LASTTILL_TEST_PUBLISHABLE_KEY,
// LASTTILL_TEST_ALLOW_WRITES=yes. Secrets are not VITE_* variables.
// Creates two uniquely named users and removes only those users afterward.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { today } from '../frontend/js/finance.js';

const enabled = process.env.LASTTILL_TEST_ALLOW_WRITES === 'yes';
test('disposable Supabase: RLS, RPCs, concurrent financial writes, and idempotent purchase', { skip: !enabled, timeout: 120000 }, async () => {
  const url = process.env.LASTTILL_TEST_SUPABASE_URL;
  const service = process.env.LASTTILL_TEST_SERVICE_KEY;
  const key = process.env.LASTTILL_TEST_PUBLISHABLE_KEY;
  assert.ok(url && service && key, 'All LASTTILL_TEST_* variables must be configured');
  const options = { auth: { persistSession: false, autoRefreshToken: false } };
  const admin = createClient(url, service, options);
  const users = [];
  const clients = [];
  async function value(promise) { const response = await promise; assert.ifError(response.error); return response.data; }
  const rpc = (client, name, data) => value(client.rpc(`lt_${name}`, { p_data: data }));
  try {
    for (let i = 0; i < 2; i++) {
      const email = `lasttill-test-${randomUUID()}@example.com`;
      const password = `${randomUUID()}aA1!`;
      const created = await value(admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name: 'LastTill Test', account_type: 'Student' } }));
      users.push(created.user.id);
      const client = createClient(url, key, options);
      await value(client.auth.signInWithPassword({ email, password }));
      clients.push(client);
      await rpc(client, 'save_profile', { full_name: 'LastTill Test', account_type: 'Student', monthly_cycle: '1st to month-end' });
    }
    const [a, b] = clients;
    const secondA = createClient(url, key, options);
    const session = (await value(a.auth.getSession())).session;
    await value(secondA.auth.setSession({ access_token: session.access_token, refresh_token: session.refresh_token }));
    const day = today(); const month = `${day.slice(0, 7)}-01`;
    const categories = await value(a.from('categories').select('category_id').limit(1));
    assert.ok(categories.length, 'Seed shared categories before running tests');
    const category_id = categories[0].category_id;
    await rpc(a, 'save_income', { source_name: 'Test receipt', amount: '1000', frequency: 'Once-off', received_date: day });
    await rpc(a, 'save_category', { month, category_id, limit_amount: '100' });
    await Promise.all([a, secondA].map(client => rpc(client, 'save_expense', { name: 'Concurrent expense', amount: '50', category_id, expense_date: day, payment_method: 'Cash' })));
    const budget = await value(a.rpc('lt_budget', { p_month: month }));
    assert.equal(Number(budget.categories[0].spent_amount), 100);
    await Promise.all([a, secondA].map(client => rpc(client, 'fund_transaction', { type: 'deposit', amount: '50', transaction_date: day })));
    const withdrawals = await Promise.all([a, secondA].map(client => client.rpc('lt_fund_transaction', { p_data: { type: 'withdrawal', amount: '80', reason: 'Medication', transaction_date: day } })));
    assert.equal(withdrawals.filter(response => !response.error).length, 1, 'Only one overlapping withdrawal can succeed');
    const fund = await value(a.from('emergency_funds').select('*').single());
    assert.equal(Number(fund.current_balance), 20);
    const goal = await rpc(a, 'save_goal', { goal_name: 'Concurrent goal', target_amount: '200' });
    await Promise.all([a, secondA].map(client => rpc(client, 'contribute', { goal_id: goal.goal_id, amount: '100', contribution_date: day })));
    assert.equal(Number((await value(a.from('savings_goals').select('saved_amount').single())).saved_amount), 200);
    const check = await rpc(a, 'check_purchase', { item_name: 'Exactly once', amount: '10', category_id });
    await Promise.all([a, secondA].map(client => rpc(client, 'purchase_check', { id: check.check_id, payment_method: 'Cash' })));
    assert.equal((await value(a.from('expenses').select('*').eq('name', 'Exactly once'))).length, 1);
    const summary = await value(a.rpc('lt_summary'));
    assert.equal(Number(summary.remaining), 590);
    for (const table of ['income_sources', 'budgets', 'budget_categories', 'expenses', 'savings_goals', 'savings_contributions', 'emergency_funds', 'emergency_fund_transactions', 'tillcheck_history', 'notifications']) {
      assert.equal((await value(b.from(table).select('*'))).length, 0, `Cross-user read: ${table}`);
    }
    assert.ok((await b.rpc('lt_purchase_check', { p_data: { id: check.check_id, payment_method: 'Cash' } })).error);
    assert.ok((await b.rpc('lt_contribute', { p_data: { goal_id: goal.goal_id, amount: '1', contribution_date: day } })).error);
    assert.ok((await a.from('emergency_funds').update({ current_balance: 9999 }).eq('fund_id', fund.fund_id)).error);
    assert.ok((await a.from('savings_goals').update({ saved_amount: 9999 }).eq('goal_id', goal.goal_id)).error);
    const alerts = await value(a.from('notifications').select('event_key'));
    assert.equal(new Set(alerts.map(row => row.event_key)).size, alerts.length);
    const anon = createClient(url, key, options);
    assert.ok((await anon.rpc('lt_summary')).error);
    assert.equal((await value(anon.from('profiles').select('*'))).length, 0);
  } finally {
    for (const client of clients) await client.auth.signOut();
    for (const id of users) {
      const { error } = await admin.auth.admin.deleteUser(id);
      assert.ifError(error);
    }
  }
});
