import * as api from '../api.js';
import { today, money, dateLabel, PAYMENTS } from '../finance.js';
import { mount, card, empty, summaryCards, field, select, dateField, form, bindForm, button, click, message, escapeHTML as e, pagination, wirePagination } from '../ui.js';

export async function expensePage({ user }) {
  const categories = await api.categories();
  const names = new Map(categories.map(row => [row.category_id, row.name]));
  let page = 0; let editing = null;
  async function load(next = page) {
    page = next;
    const [summary, history] = await Promise.all([api.summary(), api.history('expenses', 'expense_id', page, { user_id: user.id })]);
    const row = editing || {};
    mount('Add Expense', 'Record ordinary spending here. Use Emergency Fund for spending from protected money.', summaryCards(summary) +
      card(editing ? 'Edit expense' : 'Expense details', form('expense-form',
        field('name', 'Expense name', row.name, 'text', 'required maxlength="150"') + field('amount', 'Amount (ZAR)', row.amount, 'number', 'required') +
        select('category_id', 'Category', categories.map(category => [category.category_id, category.name]), row.category_id, 'required') +
        dateField('expense_date', 'Expense date', row.expense_date || today()) + select('payment_method', 'Payment method', PAYMENTS, row.payment_method, 'required') +
        `<div class="form-group full"><label for="note">Note (optional)</label><textarea class="form-control" id="note" name="note" maxlength="2000">${e(row.note)}</textarea></div>`, editing ? 'Update expense' : 'Save expense') + (editing ? button('Cancel editing', 'cancel-edit') : '')) +
      `<section class="section-gap">` + card('Expense history', (history.rows.length ? history.rows.map(item => `<div class="record-row"><div><strong>${e(item.name)}</strong><small>${e(dateLabel(item.expense_date))} · ${e(names.get(item.category_id) || 'Category')} · ${e(item.payment_method)}</small>${item.note ? `<p>${e(item.note)}</p>` : ''}<strong>${e(money(item.amount))}</strong></div><div class="inline-actions">${button('Edit', `edit-${item.expense_id}`)}${button('Delete', `delete-${item.expense_id}`)}</div></div>`).join('') : empty('No expenses recorded yet.')) + pagination(page, history.hasMore)) + '</section>');
    bindForm('expense-form', async data => { await api.rpc('save_expense', { ...data, id: editing?.expense_id }); editing = null; await load(); });
    click('cancel-edit', async () => { editing = null; await load(); });
    history.rows.forEach(item => {
      click(`edit-${item.expense_id}`, async () => { editing = item; await load(); document.getElementById('name')?.focus(); });
      click(`delete-${item.expense_id}`, async () => {
        if (!confirm(`Delete expense “${item.name}”? This updates your budget totals.`)) return;
        await api.rpc('delete_expense', { id: item.expense_id }); editing = null; await load(); message('Expense deleted.');
      });
    });
    wirePagination(page, history.hasMore, load);
  }
  await load();
}
