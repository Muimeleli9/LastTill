import * as api from '../api.js';
import { money, today, dateLabel } from '../finance.js';
import { mount, card, stat, empty, categoryCards, summaryCards, progress, escapeHTML as e, button, click, message, pagination, wirePagination } from '../ui.js';

export async function dashboard({ user, profile }) {
  let page = 0;
  async function load(next = page) {
    page = next;
    const [summary, budget, goals, fund, expenses, checks, notifications, unread] = await Promise.all([
      api.summary(), api.budget(`${today().slice(0, 7)}-01`), api.allGoals(user.id), api.fund(user.id),
      api.history('expenses', 'expense_id', 0, { user_id: user.id }),
      api.history('tillcheck_history', 'check_id', 0, { user_id: user.id }),
      api.history('notifications', 'notification_id', page, { user_id: user.id }), api.unreadCount(user.id)
    ]);
    const goal = goals.find(item => item.status === 'active') || goals.find(item => item.status === 'completed');
    const lastCheck = checks.rows[0];
    mount(`Hello, ${profile.full_name.split(' ')[0]}`, 'A clear view of what you can spend, save, and protect.',
      summaryCards(summary) + `<div class="dashboard-grid"><div class="dashboard-column">` +
      card('Calendar-month category budgets', categoryCards(budget.categories) + '<a class="choose-link" href="budget.html">Manage budget →</a>') +
      card('Savings goal', goal ? `<h3>${e(goal.goal_name)}</h3><div class="goal-number"><strong>${e(money(goal.saved_amount))}</strong><span>of ${e(money(goal.target_amount))}</span></div>${progress(goal.saved_amount, goal.target_amount)}<a class="choose-link" href="savings.html">Manage savings →</a>` : empty('Your next goal starts here.') + '<a class="choose-link" href="savings.html">Create a goal →</a>', 'card-green') +
      card('Emergency fund', stat('Protected balance', money(fund?.current_balance || 0)) + '<p class="form-hint">Emergency spending is separate from ordinary spending money.</p><a class="choose-link" href="emergency.html">Manage emergency money →</a>', 'card-warning') +
      `</div><div class="dashboard-column">` +
      card('TillCheck', (lastCheck ? `<p class="form-hint">Latest check: ${e(lastCheck.item_name)}</p>${stat('Daily allowance after that check', money(lastCheck.safe_daily_after))}` : empty('See how a purchase changes your daily allowance before spending.')) + '<a class="btn btn-primary btn-full" href="tillcheck.html">Check a purchase</a>') +
      card('Recent expenses', expenses.rows.length ? `<div class="record-list">${expenses.rows.slice(0, 5).map(row => `<div class="record-row"><div><strong>${e(row.name)}</strong><small>${e(dateLabel(row.expense_date))}</small></div><strong>−${e(money(row.amount))}</strong></div>`).join('')}</div><a class="choose-link" href="expense.html">View expense history →</a>` : empty('No expenses yet. Record your first purchase on Add Expense.')) +
      card('Your spending plan', `${Number(summary.remaining) < 0 ? `<div class="status-box status-danger">Your cycle is over your income by ${e(money(-Number(summary.remaining)))}. Review expenses and income before taking on more spending.</div>` : '<p class="goal-note">Your daily allowance excludes money reserved for savings and emergency deposits.</p>'}${stat('Reserved this cycle', money(Number(summary.savings) + Number(summary.deposits)))}`,'card-green') +
      `</div></div><section class="section-gap">` +
      card(`Notifications · ${unread} unread`, `<div class="record-list">${notifications.rows.length ? notifications.rows.map(row => `<div class="record-row ${row.is_read ? '' : 'unread'}"><div><strong>${e(row.title)}</strong><p>${e(row.message)}</p><small>${e(dateLabel(row.created_at))}</small></div>${row.is_read ? '<span>Read</span>' : button('Mark read', `read-${row.notification_id}`)}</div>`).join('') : empty('You’re all caught up.')} </div>${pagination(page, notifications.hasMore)}`) + '</section>');
    notifications.rows.forEach(row => click(`read-${row.notification_id}`, async () => { await api.markRead(row.notification_id, user.id); await load(); message('Notification marked read.'); }));
    wirePagination(page, notifications.hasMore, load);
  }
  await load();
}
