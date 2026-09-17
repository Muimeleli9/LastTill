import * as api from '../api.js';
import { getClient } from '../supabase-client.js';
import { today, money, dateLabel, FREQUENCIES, cents } from '../finance.js';
import { mount, card, stat, empty, categoryCards, field, select, dateField, form, bindForm, button, click, message, errorText, escapeHTML as e, pagination, wirePagination } from '../ui.js';

export async function budgetPage({ user }) {
  const categories = await api.categories();
  let month = today().slice(0, 7); let page = 0; let editing = null;
  async function load(next = page) {
    page = next;
    const start = `${month}-01`;
    const end = new Date(`${start}T12:00:00Z`); end.setUTCMonth(end.getUTCMonth() + 1);
    const [budget, receipts] = await Promise.all([api.budget(start), api.result(getClient().from('income_sources').select('*').eq('user_id', user.id).gte('received_date', start).lt('received_date', end.toISOString().slice(0, 10)).order('income_id', { ascending: false }).range(page * 10, page * 10 + 10))]);
    const rows = receipts.slice(0, 10); const hasMore = receipts.length > 10;
    const budgeted = budget.categories.reduce((sum, row) => sum + cents(row.limit_amount), 0) / 100;
    const receipt = editing || {};
    mount('Your Budget', 'Calendar-month limits and actual income receipts. Frequency does not automatically add future income.',
      `<div class="month-picker">${field('budget-month', 'Calendar month', month, 'month', 'required')}</div><section class="stats-grid">${stat('Income received', money(budget.income))}${stat('Total allocated', money(budgeted))}${stat('Ordinary expenses', money(budget.spent))}${stat('Unallocated income', money(Number(budget.income) - budgeted))}</section>` +
      `<section class="content-grid-2">` + card('Spending limits', categoryCards(budget.categories) + budget.categories.map(row => `<div class="inline-actions"><span>${e(row.name)}</span>${button('Edit limit', `edit-limit-${row.budget_category_id}`)}${button('Remove limit', `remove-limit-${row.budget_category_id}`)}</div>`).join('')) +
      card('Add or update a category limit', categories.length ? form('category-form', select('category_id', 'Shared category', categories.map(row => [row.category_id, row.name]), '', 'required') + field('limit_amount', 'Limit (ZAR)', '', 'number', 'min="0" required'), 'Save category limit', 'This allocates an existing shared category. It does not create a global category.') : empty('No shared categories are configured. Ask your database administrator to seed them.')) + '</section>' +
      `<section class="content-grid-2 section-gap">` + card(editing ? 'Edit income receipt' : 'Record income received', form('income-form', field('source_name', 'Source name', receipt.source_name, 'text', 'required maxlength="120"') + field('amount', 'Amount (ZAR)', receipt.amount, 'number', 'required') + select('frequency', 'Frequency', FREQUENCIES, receipt.frequency || 'Monthly', 'required') + dateField('received_date', 'Received date', receipt.received_date || today()), editing ? 'Update receipt' : 'Add income') + (editing ? button('Cancel editing', 'cancel-income') : '')) +
      card('Income history for this month', rows.length ? rows.map(row => `<div class="record-row"><div><strong>${e(row.source_name)}</strong><small>${e(dateLabel(row.received_date))} · ${e(row.frequency)}</small><strong>${e(money(row.amount))}</strong></div><div class="inline-actions">${button('Edit', `edit-income-${row.income_id}`)}${button('Delete', `delete-income-${row.income_id}`)}</div></div>`).join('') + pagination(page, hasMore) : empty('No income receipts in this month.')) + '</section>');
    document.getElementById('budget-month')?.addEventListener('change', async event => {
      if (!/^\d{4}-\d{2}$/.test(event.target.value)) return;
      month = event.target.value; editing = null;
      try { await load(0); } catch (error) { message(errorText(error), true); }
    });
    bindForm('category-form', async data => { await api.rpc('save_category', { ...data, month: start }); await load(); });
    bindForm('income-form', async data => { await api.rpc('save_income', { ...data, id: editing?.income_id }); editing = null; await load(); });
    click('cancel-income', async () => { editing = null; await load(); });
    budget.categories.forEach(row => {
      click(`edit-limit-${row.budget_category_id}`, () => {
        document.getElementById('category_id').value = row.category_id;
        document.getElementById('limit_amount').value = row.limit_amount;
        document.getElementById('limit_amount').focus();
      });
      click(`remove-limit-${row.budget_category_id}`, async () => {
        if (!confirm(`Remove the ${row.name} limit? Recorded expenses will remain.`)) return;
        await api.rpc('delete_category', { id: row.budget_category_id }); await load(); message('Category limit removed.');
      });
    });
    rows.forEach(row => {
      click(`edit-income-${row.income_id}`, async () => { editing = row; await load(); document.getElementById('source_name')?.focus(); });
      click(`delete-income-${row.income_id}`, async () => {
        if (!confirm(`Delete income receipt “${row.source_name}”?`)) return;
        await api.rpc('delete_income', { id: row.income_id }); editing = null; await load(); message('Income receipt deleted.');
      });
    });
    wirePagination(page, hasMore, load);
  }
  await load();
}
