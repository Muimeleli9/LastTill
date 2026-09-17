import * as api from '../api.js';
import { profileFields, wireSalaryDay, signOut } from '../auth.js';
import { dateLabel, money } from '../finance.js';
import { mount, card, stat, field, form, bindForm, click, button } from '../ui.js';

export function renderIdentity(profile) {
  document.querySelectorAll('.profile-details strong').forEach(el => { el.textContent = profile.full_name; });
  document.querySelectorAll('.profile-details span').forEach(el => { el.textContent = profile.account_type; });
  document.querySelectorAll('.profile-avatar').forEach(el => { el.textContent = profile.full_name.trim().slice(0, 1).toUpperCase(); });
}
export async function accountPage(context, isSettings = false) {
  async function load() {
    const [profile, settings, summary, fund] = await Promise.all([api.profile(context.user.id), api.settings(context.user.id), api.summary(), api.fund(context.user.id)]);
    context.profile = profile;
    renderIdentity(profile);
    const preferences = [
      ['notify_budget_alerts', 'Calendar budget warnings', 'Alerts at 90% and 100% of category limits.'],
      ['notify_low_balance', 'Low spendable balance', 'Alerts when cycle spendable money reaches 10% or zero.'],
      ['notify_goal_progress', 'Savings progress', 'Milestone alerts at 50% and 100% of your goals.']
    ];
    mount(isSettings ? 'Settings' : 'My Profile', 'Make LastTill work for your life.', `<section class="content-grid-2">` +
      card('Your account', form('profile-form', profileFields(profile) + field('currency', 'Currency', 'ZAR — South African Rand', 'text', 'readonly'), 'Save account details', 'Category budgets remain calendar-month based. Changing cash-flow settings updates the current summary, not past TillCheck snapshots.')) +
      (isSettings ? card('Money alerts', form('settings-form', preferences.map(([name, label, description]) => `<label class="preference-row" for="${name}"><span><strong>${label}</strong><small>${description}</small></span><input id="${name}" name="${name}" type="checkbox" ${settings[name] ? 'checked' : ''}></label>`).join(''), 'Save preferences'), 'card-green') :
        card('Your financial profile', field('auth-email', 'Email address', context.user.email, 'email', 'readonly') + `<div class="stats-grid section-gap">${stat('Member since', dateLabel(profile.created_at))}${stat('Cycle income', money(summary.income))}${stat('Emergency money', money(fund?.current_balance || 0))}${stat('Safe daily spending', money(summary.safe_daily))}</div>`, 'card-green')) +
      '</section><section class="section-gap">' + card('Account access', '<p class="form-hint">Sign out of LastTill on this device.</p>' + button('Log Out', 'account-signout'), 'card-warning') + '</section>');
    wireSalaryDay();
    bindForm('profile-form', async data => { await api.rpc('save_profile', data); await load(); }, 'Account details saved.', false);
    bindForm('settings-form', async data => {
      await api.saveSettings(context.user.id, Object.fromEntries(preferences.map(([name]) => [name, data[name] === 'on'])));
      await load();
    }, 'Preferences saved.', false);
    click('account-signout', signOut);
  }
  await load();
}
