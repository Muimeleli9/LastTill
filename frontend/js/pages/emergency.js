import * as api from '../api.js';
import { money, dateLabel, REASONS } from '../finance.js';
import { mount, card, stat, empty, progress, field, select, dateField, form, bindForm, escapeHTML as e, pagination, wirePagination } from '../ui.js';

export async function emergencyPage({ user }) {
  let page = 0;
  async function load(next = page) {
    page = next;
    const fund = await api.fund(user.id);
    const history = fund ? await api.history('emergency_fund_transactions', 'transaction_id', page, { fund_id: fund.fund_id }) : { rows: [], hasMore: false };
    mount('Emergency Fund', 'Keep protected money separate. Record emergency spending here, not again as an ordinary expense.',
      `<section class="content-grid-2">` + card('Your protected fund', `<div class="stats-grid">${stat('Available balance', money(fund?.current_balance || 0))}${stat('Fund target', money(fund?.target_amount || 0))}</div>${progress(fund?.current_balance || 0, fund?.target_amount || 0)}<p class="form-hint">Deposits reserve ordinary spending money. Withdrawals spend from this balance.</p>`, 'card-warning') +
      card('Set your safety target', form('fund-form', field('target_amount', 'Target amount (ZAR)', fund?.target_amount || 0, 'number', 'min="0" required'), 'Save fund target')) + '</section>' +
      `<section class="content-grid-2 section-gap">` + card('Add or use emergency money', form('transaction-form', select('type', 'Transaction type', [['deposit', 'Deposit — reserve money'], ['withdrawal', 'Withdrawal — emergency spending']], 'deposit', 'required') + field('amount', 'Amount (ZAR)', '', 'number', 'required') + dateField('transaction_date', 'Transaction date') + select('reason', 'Withdrawal reason', REASONS), 'Record transaction', 'Only record actual money moved or spent. A withdrawal cannot exceed the available fund.')) +
      card('Fund activity', (history.rows.length ? history.rows.map(row => `<div class="record-row"><div><strong>${row.type === 'deposit' ? 'Deposit' : 'Emergency spending'}</strong><small>${e(dateLabel(row.transaction_date))}${row.reason ? ` · ${e(row.reason)}` : ''}</small></div><strong>${row.type === 'deposit' ? '+' : '−'}${e(money(row.amount))}</strong></div>`).join('') : empty('No emergency-fund transactions yet.')) + pagination(page, history.hasMore)) + '</section>');
    bindForm('fund-form', async data => { await api.rpc('save_fund', data); await load(); });
    bindForm('transaction-form', async data => {
      if (data.type === 'withdrawal' && !confirm(`Record ${money(data.amount)} of emergency spending?`)) return false;
      await api.rpc('fund_transaction', data); await load(0);
    });
    const type = document.getElementById('type'); const reason = document.getElementById('reason');
    function updateReason() { reason.disabled = type.value === 'deposit'; reason.required = !reason.disabled; }
    type.addEventListener('change', updateReason); updateReason();
    wirePagination(page, history.hasMore, load);
  }
  await load();
}
