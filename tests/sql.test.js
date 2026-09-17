import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { cycleRange, CYCLES } from '../frontend/js/finance.js';

const db = new PGlite();
const owner = '11111111-1111-4111-8111-111111111111';
const other = '22222222-2222-4222-8222-222222222222';
let day; let month; let income; let expense; let goal; let check; let migration;
async function asUser(id = owner) {
  await db.exec('reset role');
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id]);
  await db.exec('set role authenticated');
}
async function rpc(name, data) {
  const args = data === undefined ? '' : '$1::jsonb';
  return (await db.query(`select public.lt_${name}(${args}) as value`, data === undefined ? [] : [JSON.stringify(data)])).rows[0].value;
}
async function budget() { return (await db.query('select public.lt_budget($1::date) as value', [month])).rows[0].value; }
before(async () => {
  await db.exec(await readFile(new URL('./fixtures/schema.sql', import.meta.url), 'utf8'));
  migration = await readFile(new URL('../supabase/migrations/202609170001_app_logic.sql', import.meta.url), 'utf8');
  await db.exec(migration);
  await db.exec(migration); // Safe to rerun without duplicate triggers or policies.
  await db.query('insert into auth.users(id,raw_user_meta_data) values($1,$3),($2,$3)', [owner, other, JSON.stringify({ full_name: 'Test User', account_type: 'Student' })]);
  day = (await db.query('select public.lt_today()::text as day')).rows[0].day;
  month = `${day.slice(0, 7)}-01`;
  await asUser();
  await rpc('save_profile', { full_name: 'Test User', account_type: 'Student', monthly_cycle: CYCLES[0] });
});
after(async () => { await db.close(); });

test('profiles and settings are provisioned once; other profiles stay private', async () => {
  assert.equal((await db.query('select * from profiles')).rows.length, 1);
  assert.equal((await db.query('select * from user_settings')).rows.length, 1);
  assert.equal((await db.query('select * from categories')).rows.length, 9);
});
test('all financial input validation runs on the server', async () => {
  for (const amount of ['0', '-2', '1.001', 'NaN', 'Infinity', '10000000000']) {
    await assert.rejects(rpc('save_income', { source_name: 'Salary', amount, frequency: 'Monthly', received_date: day }));
  }
  await assert.rejects(rpc('save_profile', { full_name: '', account_type: 'Student', monthly_cycle: CYCLES[0] }));
  await assert.rejects(rpc('save_profile', { full_name: 'Name', account_type: 'Admin', monthly_cycle: CYCLES[0] }));
  await assert.rejects(rpc('save_profile', { full_name: 'Name', account_type: 'Student', monthly_cycle: CYCLES[1], salary_day: 32 }));
  await assert.rejects(rpc('save_income', { source_name: 'Future', amount: '1', frequency: 'Monthly', received_date: '2999-01-01' }));
});
test('income and late-created budget categories initialize from existing records', async () => {
  income = await rpc('save_income', { source_name: 'Salary', amount: '1000.00', frequency: 'Monthly', received_date: day });
  expense = await rpc('save_expense', { category_id: 1, name: 'Groceries', amount: '90', expense_date: day, payment_method: 'Cash' });
  await rpc('save_category', { month, category_id: 1, limit_amount: '100' });
  const data = await budget();
  assert.equal(data.income, 1000);
  assert.equal(data.categories[0].spent_amount, 90);
  assert.equal((await rpc('summary')).remaining, 910);
});
test('expense changes and removal recalculate exactly once', async () => {
  await rpc('save_expense', { id: expense.expense_id, category_id: 1, name: 'Groceries', amount: '100', expense_date: day, payment_method: 'Transfer' });
  assert.equal((await budget()).categories[0].spent_amount, 100);
  await rpc('delete_expense', { id: expense.expense_id });
  assert.equal((await budget()).categories[0].spent_amount, 0);
  await rpc('save_income', { id: income.income_id, source_name: 'Salary', amount: '1200', frequency: 'Monthly', received_date: day });
  assert.equal((await budget()).income, 1200);
});
test('goal contributions, completion, and fund spending preserve cash-flow rules', async () => {
  goal = await rpc('save_goal', { goal_name: 'Laptop', target_amount: '200' });
  await rpc('contribute', { goal_id: goal.goal_id, amount: '100', contribution_date: day });
  await rpc('fund_transaction', { type: 'deposit', amount: '200', transaction_date: day });
  assert.equal((await rpc('summary')).remaining, 900);
  await rpc('fund_transaction', { type: 'withdrawal', amount: '65', reason: 'Medication', transaction_date: day });
  assert.equal((await rpc('summary')).remaining, 900);
  assert.equal(Number((await db.query('select current_balance from emergency_funds')).rows[0].current_balance), 135);
  await assert.rejects(rpc('fund_transaction', { type: 'withdrawal', amount: '136', reason: 'Other', transaction_date: day }), /exceeds/);
  await rpc('contribute', { goal_id: goal.goal_id, amount: '100', contribution_date: day });
  assert.equal((await db.query('select status from savings_goals')).rows[0].status, 'completed');
  assert.equal((await rpc('summary')).remaining, 800);
  await assert.rejects(rpc('contribute', { goal_id: goal.goal_id, amount: '1', contribution_date: day }), /active/);
});
test('TillCheck snapshots do not spend money; confirmation is idempotent', async () => {
  check = await rpc('check_purchase', { item_name: 'Dinner', category_id: 1, amount: '150' });
  assert.equal(check.remaining_before, 800);
  assert.equal(check.remaining_after, 650);
  assert.equal(check.category_exceeded, true);
  assert.equal((await rpc('summary')).remaining, 800);
  await rpc('purchase_check', { id: check.check_id, payment_method: 'Bank Card' });
  await rpc('purchase_check', { id: check.check_id, payment_method: 'Bank Card' });
  assert.equal((await rpc('summary')).remaining, 650);
  assert.equal((await db.query('select * from expenses')).rows.length, 1);
  assert.equal((await budget()).categories[0].spent_amount, 150);
});
test('milestone notifications are unique and only read state is client-editable', async () => {
  const count = (await db.query('select * from notifications')).rows.length;
  await rpc('save_category', { month, category_id: 1, limit_amount: '100' });
  assert.equal((await db.query('select * from notifications')).rows.length, count);
  await db.query('update notifications set is_read=true');
  await assert.rejects(db.query("update notifications set message='forged'"), /permission denied/);
  await assert.rejects(db.query('delete from notifications'), /permission denied/);
});
test('direct computed-total writes and internal helper execution are denied', async () => {
  for (const sql of [
    'update savings_goals set saved_amount=9999', 'update emergency_funds set current_balance=9999',
    'update budget_categories set spent_amount=0', 'update budgets set total_income=9999',
    'update profiles set is_active=false', "update profiles set currency='USD'",
    "update profiles set monthly_cycle='Salary date to next salary date',salary_day=null",
    "select public.lt_write('save_fund','{}')",
    'select public.recalc_budget_category_spent(1,1)'
  ]) await assert.rejects(db.query(sql), /permission denied/);
});
test('direct profile name updates still enforce nonblank names', async () => {
  await assert.rejects(db.query("update profiles set full_name='   '"), /lt_full_name/);
});
test('moving receipts and expenses updates both calendar-month buckets', async () => {
  const previousDate = new Date(`${month}T12:00:00Z`);
  previousDate.setUTCDate(0);
  const previous = previousDate.toISOString().slice(0, 10);
  const previousMonth = `${previous.slice(0, 7)}-01`;
  await db.exec('begin');
  try {
    await rpc('save_income', { id: income.income_id, source_name: 'Salary', amount: '1200', frequency: 'Monthly', received_date: previous });
    assert.equal(Number((await db.query('select total_income from budgets where period_month=$1', [month])).rows[0].total_income), 0);
    assert.equal(Number((await db.query('select total_income from budgets where period_month=$1', [previousMonth])).rows[0].total_income), 1200);
    await rpc('delete_income', { id: income.income_id });
    assert.equal(Number((await db.query('select total_income from budgets where period_month=$1', [previousMonth])).rows[0].total_income), 0);
    const row = await rpc('save_expense', { category_id: 1, name: 'Moving expense', amount: '25', expense_date: day, payment_method: 'Cash' });
    await rpc('save_category', { month: previousMonth, category_id: 2, limit_amount: '100' });
    await rpc('save_expense', { id: row.expense_id, category_id: 2, name: 'Moving expense', amount: '30', expense_date: previous, payment_method: 'Cash' });
    assert.equal((await budget()).categories[0].spent_amount, 150);
    const oldBudget = (await db.query('select public.lt_budget($1) as value', [previousMonth])).rows[0].value;
    assert.equal(oldBudget.categories[0].spent_amount, 30);
  } finally { await db.exec('rollback'); }
});
test('low-balance milestones respect preferences and deduplicate alerts', async () => {
  await db.exec('begin');
  try {
    await db.exec('update user_settings set notify_low_balance=false');
    await rpc('save_expense', { category_id: 1, name: 'Large purchase', amount: '600', expense_date: day, payment_method: 'Cash' });
    assert.equal((await db.query("select * from notifications where event_key like 'balance:%'")).rows.length, 0);
    await db.exec('update user_settings set notify_low_balance=true');
    await rpc('save_expense', { category_id: 1, name: 'Final purchase', amount: '50', expense_date: day, payment_method: 'Cash' });
    const alerts = (await db.query("select event_key from notifications where event_key like 'balance:%'")).rows;
    assert.equal(alerts.length, 2);
    await rpc('save_category', { month, category_id: 1, limit_amount: '100' });
    assert.equal((await db.query("select * from notifications where event_key like 'balance:%'")).rows.length, 2);
  } finally { await db.exec('rollback'); }
});
test('migration rejects inconsistent existing totals without rewriting them', async () => {
  await db.exec('reset role');
  try {
    for (const [table, column] of [['budgets', 'total_income'], ['budget_categories', 'spent_amount'], ['savings_goals', 'saved_amount'], ['emergency_funds', 'current_balance']]) {
      const original = (await db.query(`select ${column} as value from ${table}`)).rows.map(row => row.value);
      await db.exec(`update ${table} set ${column}=${column}+1`);
      try {
        await assert.rejects(db.exec(migration), /totals disagree/);
      } finally { await db.exec('rollback'); }
      const unchanged = (await db.query(`select ${column} as value from ${table}`)).rows.map(row => Number(row.value));
      assert.deepEqual(unchanged, original.map(value => Number(value) + 1));
      await db.exec(`update ${table} set ${column}=${column}-1`);
    }
    await db.exec(migration);
  } finally { await asUser(); }
});
test('two-user RLS isolates parent and child rows and RPC identifiers', async () => {
  await asUser(other);
  for (const table of ['income_sources', 'budgets', 'budget_categories', 'expenses', 'savings_goals', 'savings_contributions', 'emergency_funds', 'emergency_fund_transactions', 'tillcheck_history', 'notifications']) {
    assert.equal((await db.query(`select * from ${table}`)).rows.length, 0, table);
  }
  await assert.rejects(rpc('purchase_check', { id: check.check_id, payment_method: 'Cash' }), /not found/);
  await assert.rejects(rpc('contribute', { goal_id: goal.goal_id, amount: '10', contribution_date: day }), /active/);
  await assert.rejects(rpc('delete_income', { id: income.income_id }), /not found/);
  assert.equal((await rpc('summary')).income, 0);
  await asUser();
});
test('SQL salary boundaries agree with calendar-safe frontend calculations', async () => {
  await rpc('save_profile', { full_name: 'Test User', account_type: 'Employed', monthly_cycle: CYCLES[1], salary_day: 31 });
  await db.exec('reset role');
  for (const on of ['2024-02-28', '2024-02-29', '2025-02-28', '2026-01-01', '2026-04-30']) {
    const row = (await db.query('select start_date::text,end_date::text,days from public.lt_cycle($1)', [on])).rows[0];
    const expected = cycleRange(on, CYCLES[1], 31);
    assert.deepEqual(row, { start_date: expected.start, end_date: expected.end, days: expected.days });
  }
  await asUser();
});
test('anonymous access and inactive accounts cannot read personal data or mutate', async () => {
  await db.exec('reset role');
  await db.query("select set_config('request.jwt.claim.sub','',false)");
  await db.exec('set role anon');
  assert.equal((await db.query('select * from profiles')).rows.length, 0);
  await assert.rejects(rpc('summary'), /permission denied/);
  await db.exec('reset role');
  await db.query('update profiles set is_active=false where id=$1', [owner]);
  await asUser();
  assert.equal((await db.query('select * from expenses')).rows.length, 0);
  await assert.rejects(rpc('save_fund', { target_amount: '100' }), /active/);
});
