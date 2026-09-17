import * as api from '../api.js';
import { money, dateLabel } from '../finance.js';
import { mount, card, stat, empty, progress, field, select, dateField, form, bindForm, button, click, message, errorText, escapeHTML as e, pagination, wirePagination } from '../ui.js';

export async function savingsPage({ user }) {
  let selected = null; let creating = false; let page = 0;
  async function load(next = page) {
    page = next;
    const goals = await api.allGoals(user.id);
    const goal = creating ? null : goals.find(row => row.goal_id === selected) || goals.find(row => row.status === 'active') || goals[0];
    selected = goal?.goal_id ?? null;
    const history = goal ? await api.history('savings_contributions', 'contribution_id', page, { goal_id: goal.goal_id }) : { rows: [], hasMore: false };
    mount('Savings Goals', 'Set money aside for what matters. Contributions reserve cash from your spending cycle.',
      `<div class="goal-picker">${goals.length ? select('selected-goal', 'Your goals', [['', 'Create a new goal'], ...goals.map(row => [row.goal_id, `${row.goal_name} (${row.status})`])], selected ?? '') : ''}${button('New goal', 'new-goal', false)}</div><section class="content-grid-2">` +
      card(goal ? goal.goal_name : 'Your next goal', goal ? `<div class="stats-grid">${stat('Saved', money(goal.saved_amount))}${stat('Target', money(goal.target_amount))}</div>${progress(goal.saved_amount, goal.target_amount)}<p class="form-hint">Status: ${e(goal.status)}</p>` + (goal.status !== 'cancelled' ? button('Cancel goal', 'cancel-goal') : empty('Saved money remains reserved. Canceling a goal does not refund contributions.')) : empty('Create your first goal to start tracking progress.'), 'card-green') +
      card(goal ? 'Edit goal details' : 'Create a goal', form('goal-form', field('goal_name', 'Goal name', goal?.goal_name, 'text', 'required maxlength="120"') + field('target_amount', 'Target amount (ZAR)', goal?.target_amount, 'number', 'required'), goal ? 'Save goal details' : 'Create goal')) + '</section>' +
      `<section class="content-grid-2 section-gap">` +
      card('Add to savings', goal?.status === 'active' ? form('contribution-form', field('amount', 'Amount to save (ZAR)', '', 'number', 'required') + dateField('contribution_date', 'Contribution date'), 'Add to goal', 'Only record money you actually set aside. This lowers cycle spendable money.') : empty('Choose an active goal to add a contribution.')) +
      card('Contribution history', (history.rows.length ? history.rows.map(row => `<div class="record-row"><span>${e(dateLabel(row.contribution_date))}</span><strong>${e(money(row.amount))}</strong></div>`).join('') : empty('No contributions for this goal yet.')) + pagination(page, history.hasMore)) + '</section>');
    bindForm('goal-form', async data => { const row = await api.rpc('save_goal', { ...data, id: selected }); selected = row.goal_id; creating = false; await load(0); });
    bindForm('contribution-form', async data => { await api.rpc('contribute', { ...data, goal_id: selected }); await load(0); });
    click('new-goal', async () => { creating = true; await load(0); document.getElementById('goal_name')?.focus(); });
    click('cancel-goal', async () => {
      if (!confirm('Cancel this goal? Existing saved money will remain reserved.')) return;
      await api.rpc('cancel_goal', { id: selected }); await load(); message('Goal canceled.');
    });
    document.getElementById('selected-goal')?.addEventListener('change', async event => {
      creating = !event.target.value; selected = Number(event.target.value) || null;
      try { await load(0); } catch (error) { message(errorText(error), true); }
    });
    wirePagination(page, history.hasMore, load);
  }
  await load();
}
