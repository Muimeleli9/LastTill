import * as api from '../api.js';
import { money, dateLabel, PAYMENTS, classifyCheck } from '../finance.js';
import { mount, card, stat, empty, summaryCards, field, select, form, bindForm, button, click, escapeHTML as e, pagination, wirePagination } from '../ui.js';

export async function tillcheckPage({ user }) {
  const categories = await api.categories();
  const names = new Map(categories.map(row => [row.category_id, row.name]));
  let last = null; let page = 0;
  const verdictTone = verdict => ({ UNSAFE: 'danger', CAUTION: 'caution', 'WITHIN PLAN': 'safe' }[verdict] || '');
  const verdictBox = check => {
    const verdict = classifyCheck(check);
    const category = names.get(Number(check.category_id)) || 'this category';
    if (verdict === 'UNSAFE') return `<p class="status-box status-danger">This purchase would push your cycle ${e(money(Math.abs(Number(check.remaining_after))))} past the money you have left. Recording it would overspend your income.</p>`;
    if (check.category_exceeded) return `<p class="status-box status-warning">This purchase would push ${e(category)} over its calendar-month limit.</p>`;
    if (verdict === 'CAUTION') return `<p class="status-box status-warning">This purchase would cut your safe daily spend from ${e(money(check.safe_daily_before))} to ${e(money(check.safe_daily_after))}. Check your plan before buying.</p>`;
    return '<p class="status-box status-safe">This purchase stays within your remaining money and category limits.</p>';
  };
  async function load(next = page) {
    page = next;
    const [summary, history] = await Promise.all([api.summary(), api.history('tillcheck_history', 'check_id', page, { user_id: user.id })]);
    let result = empty('Enter a purchase to see its effect. Checking never records an expense.');
    if (last) {
      const verdict = last.category_exceeded === undefined ? 'SAVED SNAPSHOT' : classifyCheck(last);
      result = `<span class="tillcheck-badge ${verdictTone(verdict)}">${verdict}</span><h3 class="section-gap">${e(last.item_name)} · ${e(money(last.amount))}</h3><div class="stats-grid section-gap">${stat('Before / day', money(last.safe_daily_before))}${stat('After / day', money(last.safe_daily_after))}${stat('Remaining before purchase', money(last.remaining_before))}${stat('Remaining after purchase', money(last.remaining_after))}</div>${last.category_exceeded === undefined ? '' : verdictBox(last)}<p class="form-hint">${last.category_unbudgeted ? 'This category has no calendar-month limit. ' : ''}This is a snapshot from ${e(dateLabel(last.created_at))}, not a guarantee of affordability. Recording a purchase uses today’s date.</p>` +
        (last.was_purchased ? '<p class="status-box">Purchase already recorded.</p>' : form('purchase-form', select('payment_method', 'Payment method', PAYMENTS, '', 'required'), 'Record this purchase', 'Only confirm after you actually buy it. Do not also add the same expense manually.'));
    }
    mount('TillCheck', 'Understand a purchase before you spend. Your emergency money stays protected.', summaryCards(summary) + `<section class="content-grid-2">` +
      card('Can I afford this?', form('check-form', field('item_name', 'What do you want to buy?', '', 'text', 'required maxlength="150"') + field('amount', 'Price (ZAR)', '', 'number', 'required') + select('category_id', 'Category', categories.map(row => [row.category_id, row.name]), '', 'required'), 'Check purchase')) +
      card('Purchase impact', result, 'card-green') + '</section><section class="section-gap">' +
      card('Check history', (history.rows.length ? history.rows.map(row => {
        const verdict = classifyCheck(row);
        const tone = verdictTone(verdict);
        return `<div class="record-row"><div><strong>${e(row.item_name)} · ${e(money(row.amount))}</strong><small>${e(dateLabel(row.created_at))} · ${row.was_purchased ? 'Purchased' : 'Not recorded as purchased'}</small></div><div class="inline-actions"><span class="check-verdict ${tone}">${verdict}</span>${button('View check', `view-${row.check_id}`)}</div></div>`;
      }).join('') : empty('Your checks will appear here.')) + pagination(page, history.hasMore)) + '</section>');
    bindForm('check-form', async data => { last = await api.rpc('check_purchase', data); await load(0); }, 'Purchase checked. No expense was recorded.');
    bindForm('purchase-form', async data => {
      if (!confirm(`Record an expense of ${money(last.amount)} for “${last.item_name}” today?`)) return false;
      last = await api.rpc('purchase_check', { ...data, id: last.check_id }); await load();
    }, 'Purchase recorded exactly once.');
    history.rows.forEach(row => click(`view-${row.check_id}`, async () => { last = row; await load(); }));
    wirePagination(page, history.hasMore, load);
  }
  await load();
}
