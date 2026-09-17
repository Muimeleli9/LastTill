import * as api from '../api.js';
import { today, money, dateLabel, cents, percent } from '../finance.js';
import { mount, card, empty, icon, message, errorText, escapeHTML as e } from '../ui.js';

const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;
const CATEGORY_ICONS = {
  'groceries': 'shopping-basket', 'transport': 'bus-front', 'family support': 'heart-handshake',
  'social': 'users', 'food & dining': 'utensils', 'data & airtime': 'smartphone',
  'personal': 'user', 'clothing': 'shirt', 'other': 'tag'
};

function monthBounds(month) {
  const start = `${month}-01`;
  const end = new Date(`${start}T12:00:00Z`);
  end.setUTCMonth(end.getUTCMonth() + 1);
  return { start, end: end.toISOString().slice(0, 10) };
}

function monthLabel(month) {
  return new Intl.DateTimeFormat('en-ZA', { month: 'long', year: 'numeric', timeZone: 'UTC' })
    .format(new Date(`${month}-01T12:00:00Z`));
}

function shiftMonth(month, delta) {
  const date = new Date(`${month}-01T12:00:00Z`);
  date.setUTCMonth(date.getUTCMonth() + delta);
  return date.toISOString().slice(0, 7);
}

function categoryIcon(name) {
  return CATEGORY_ICONS[String(name).toLowerCase()] || 'receipt-text';
}

function progressClass(ratio) {
  if (ratio >= 100) return 'budget-full';
  if (ratio >= 80) return 'budget-warning';
  return 'budget-safe';
}

export async function historyPage({ user }) {
  const current = today().slice(0, 7);
  const names = new Map((await api.categories()).map(row => [Number(row.category_id), row.name]));
  let month = new URLSearchParams(location.search).get('month');
  if (!MONTH_PATTERN.test(month || '') || month > current) month = current;
  let loading = false;

  async function goto(next) {
    if (loading) return;
    loading = true;
    try { await load(next); } catch (error) { message(errorText(error), true); } finally { loading = false; }
  }

  async function load(next = month) {
    month = next;
    const { start, end } = monthBounds(month);
    const [expenses, budget] = await Promise.all([api.monthExpenses(user.id, start, end), api.budget(start)]);
    const isCurrent = month === current;
    const spentCents = expenses.reduce((total, row) => total + cents(row.amount), 0);
    const spent = spentCents / 100;
    const income = Number(budget.income) || 0;
    const remaining = (cents(income) - spentCents) / 100;
    const days = isCurrent
      ? Math.max(0, Math.round((new Date(`${end}T12:00:00Z`) - new Date(`${today()}T12:00:00Z`)) / 86400000))
      : 0;

    const limits = new Map((budget.categories || []).map(row => [Number(row.category_id), Number(row.limit_amount)]));
    const grouped = new Map();
    expenses.forEach(row => {
      const id = Number(row.category_id);
      const entry = grouped.get(id) || { id, name: names.get(id) || 'Category', totalCents: 0 };
      entry.totalCents += cents(row.amount);
      grouped.set(id, entry);
    });
    const breakdown = [...grouped.values()].sort((a, b) => b.totalCents - a.totalCents);

    const spentCaption = income > 0
      ? (spentCents > cents(income)
        ? `Over income by ${money((spentCents - cents(income)) / 100)}`
        : `${Math.min(100, Math.round(spent / income * 100))}% of income`)
      : 'No income recorded';

    const categoryRows = breakdown.length ? breakdown.map((entry, index) => {
      const limit = limits.get(entry.id);
      const total = entry.totalCents / 100;
      const ratio = limit ? percent(total, limit) : null;
      const over = limit ? entry.totalCents > cents(limit) : false;
      return `<div class="history-category">
        <div class="history-category-top">
          <div class="history-category-name">
            <div class="category-circle">${icon(categoryIcon(entry.name))}</div>
            <div><strong>${e(entry.name)}</strong><span>${over ? 'Over monthly limit' : index === 0 ? 'Largest spending category' : 'Spending this month'}</span></div>
          </div>
          <strong class="history-category-amount ${over ? 'history-negative' : ''}">${e(money(total))}</strong>
        </div>
        ${limit ? `<div class="progress-track"><div class="progress-fill ${progressClass(ratio)}" style="width:${ratio}%"></div></div>
          <div class="history-progress-info"><span>${e(money(total))} of ${e(money(limit))}</span><span>${Math.round(ratio)}%</span></div>`
        : '<div class="history-progress-info"><span>No monthly limit set</span><span>—</span></div>'}
      </div>`;
    }).join('') : empty('No spending was recorded in this month.');

    const transactions = expenses.length ? `<div class="transaction-list">${expenses.map(row => `
      <div class="transaction-item">
        <div class="transaction-icon">${icon(categoryIcon(names.get(Number(row.category_id)) || ''))}</div>
        <div class="transaction-main"><strong>${e(row.name)}</strong><span>${e(names.get(Number(row.category_id)) || 'Category')} · ${e(dateLabel(row.expense_date))}</span></div>
        <div class="transaction-amount">−${e(money(row.amount))}</div>
      </div>`).join('')}</div>` : empty('No transactions recorded in this month.');

    const largest = breakdown[0];
    const largestRatio = largest && limits.get(largest.id) ? percent(largest.totalCents / 100, limits.get(largest.id)) : null;
    let insightText;
    let statusBox = '';
    if (!expenses.length) {
      insightText = 'No spending was recorded in this month. Every expense you record builds this history.';
    } else if (income > 0 && spentCents > cents(income)) {
      insightText = `${largest ? `${largest.name} is your largest spending category, ` : ''}but total spending passed the income recorded for this month.`;
      statusBox = `<div class="status-box status-danger">Spending exceeded the ${e(money(income))} income recorded for this month by ${e(money((spentCents - cents(income)) / 100))}.</div>`;
    } else if (income === 0 && spentCents > 0) {
      insightText = `${largest ? `${largest.name} is your largest spending category, ` : 'Spending exists, '}but no income was recorded for this month.`;
      statusBox = `<div class="status-box status-warning">${e(money(spent))} was spent with no income recorded for this month.</div>`;
    } else if (largest && largestRatio !== null && largest.totalCents > cents(limits.get(largest.id))) {
      insightText = `${largest.name} is your largest spending category and it passed its monthly limit.`;
      statusBox = `<div class="status-box status-danger">You've exceeded your ${e(largest.name)} limit by ${e(money((largest.totalCents - cents(limits.get(largest.id))) / 100))}.</div>`;
    } else if (largest && largestRatio !== null && largestRatio >= 90) {
      insightText = `${largest.name} is your largest spending category and is close to the monthly limit.`;
      statusBox = `<div class="status-box status-warning">You've used ${Math.round(largestRatio)}% of your ${e(largest.name)} budget. ${e(money((cents(limits.get(largest.id)) - largest.totalCents) / 100))} remains.</div>`;
    } else {
      insightText = largest ? `${largest.name} is your largest spending category this month.` : 'No spending was recorded in this month.';
      if (expenses.length && limits.size) statusBox = '<div class="status-box status-safe">Spending is tracking within your category limits.</div>';
    }

    const safeDaily = isCurrent && days > 0 ? money(Math.floor(Math.max(0, cents(remaining)) / days) / 100) : '—';

    mount('Spending History', 'Look back at how you managed your money each month.',
      `<section class="history-month-selector">
        <button class="month-arrow" id="prev-month" type="button" aria-label="Previous month">${icon('chevron-left')}</button>
        <div class="selected-month"><span>Viewing</span><strong>${e(monthLabel(month))}</strong></div>
        <button class="month-arrow" id="next-month" type="button" aria-label="Next month" ${isCurrent ? 'disabled' : ''}>${icon('chevron-right')}</button>
      </section>
      <section class="history-summary-grid">
        <article class="history-summary-card">
          <div class="history-summary-icon">${icon('wallet')}</div>
          <div><span>Monthly Income</span><strong>${e(money(income))}</strong><small>${e(monthLabel(month))} income</small></div>
        </article>
        <article class="history-summary-card">
          <div class="history-summary-icon">${icon('receipt-text')}</div>
          <div><span>Total Spent</span><strong>${e(money(spent))}</strong><small class="${spentCents > cents(income) && income > 0 ? 'history-negative' : ''}">${e(spentCaption)}</small></div>
        </article>
        <article class="history-summary-card remaining">
          <div class="history-summary-icon">${icon('piggy-bank')}</div>
          <div><span>Remaining</span><strong class="${remaining < 0 ? 'history-negative' : ''}">${e(money(remaining))}</strong><small>${remaining < 0 ? 'Income overspent' : 'Money still available'}</small></div>
        </article>
        <article class="history-summary-card">
          <div class="history-summary-icon">${icon('calendar-days')}</div>
          <div><span>Days Remaining</span><strong>${isCurrent ? days : '—'}</strong><small>${isCurrent ? 'Until month-end' : 'Month complete'}</small></div>
        </article>
      </section>
      <section class="history-layout">
        <div class="history-main-column">
          <article class="card">
            <div class="card-heading">
              <div><p class="card-label">Where your money went</p><h3>Spending Breakdown</h3></div>
              <div class="card-icon">${icon('chart-no-axes-column')}</div>
            </div>
            ${categoryRows}
          </article>
          <article class="card">
            <div class="card-heading">
              <div><p class="card-label">${e(monthLabel(month))} activity</p><h3>Transactions</h3></div>
              <div class="history-transaction-count">${expenses.length} transaction${expenses.length === 1 ? '' : 's'}</div>
            </div>
            ${transactions}
          </article>
        </div>
        <div class="history-side-column">
          <article class="card history-result-card">
            <div class="history-result-icon">${icon('calendar-check')}</div>
            <p class="card-label">Month summary</p>
            <h3>${e(monthLabel(month))} ${isCurrent ? 'so far' : 'summary'}</h3>
            <div class="history-result-amount ${remaining < 0 ? 'history-negative' : ''}">${e(money(remaining))}</div>
            <p class="history-result-label">${remaining < 0 ? 'over your income' : 'remaining'}</p>
            <div class="history-result-divider"></div>
            <div class="history-result-row"><span>Income used</span><strong>${income > 0 ? `${Math.min(100, Math.round(spent / income * 100))}%` : '—'}</strong></div>
            <div class="history-result-row"><span>Safe daily spend</span><strong>${e(safeDaily)}</strong></div>
          </article>
          <article class="card card-green">
            <div class="card-heading">
              <div><p class="card-label">Spending insight</p><h3>Your month at a glance</h3></div>
              <div class="card-icon">${icon('sparkles')}</div>
            </div>
            <p class="history-insight-text">${e(insightText)}</p>
            ${statusBox}
          </article>
          <article class="card">
            <div class="card-heading">
              <div><p class="card-label">Quick access</p><h3>Previous Months</h3></div>
            </div>
            ${[1, 2, 3].map(delta => {
              const target = shiftMonth(month, -delta);
              return `<a class="previous-month-card" href="history.html?month=${target}">
                <div><strong>${e(monthLabel(target))}</strong><span>View spending summary</span></div>
                ${icon('chevron-right')}
              </a>`;
            }).join('')}
          </article>
        </div>
      </section>`);

    history.replaceState(null, '', month === current ? 'history.html' : `history.html?month=${month}`);
    document.getElementById('prev-month')?.addEventListener('click', () => goto(shiftMonth(month, -1)));
    document.getElementById('next-month')?.addEventListener('click', () => { if (month < current) goto(shiftMonth(month, 1)); });
  }

  await load();
}
