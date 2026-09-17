import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cents, cashFlow, cycleRange, receiptTotal, classifyCheck, CYCLES } from '../frontend/js/finance.js';

test('money parsing rejects unsafe values and retains cents', () => {
  assert.equal(cents('0.29'), 29);
  assert.equal(cents('-12.05'), -1205);
  for (const value of ['NaN', 'Infinity', '1.001', '1e3', '', '9999999999999999']) assert.throws(() => cents(value));
});
test('calendar cycles include today and reset correctly across year boundaries', () => {
  assert.deepEqual(cycleRange('2026-12-31'), { start: '2026-12-01', end: '2027-01-01', days: 1 });
  assert.deepEqual(cycleRange('2024-02-01'), { start: '2024-02-01', end: '2024-03-01', days: 29 });
  assert.throws(() => cycleRange('2026-02-30'));
});
test('salary cycles clamp 29–31 to short months without rolling into March', () => {
  assert.deepEqual(cycleRange('2024-02-28', CYCLES[1], 31), { start: '2024-01-31', end: '2024-02-29', days: 1 });
  assert.deepEqual(cycleRange('2024-02-29', CYCLES[1], 31), { start: '2024-02-29', end: '2024-03-31', days: 31 });
  assert.deepEqual(cycleRange('2025-02-28', CYCLES[1], 30), { start: '2025-02-28', end: '2025-03-30', days: 30 });
  assert.throws(() => cycleRange('2026-01-01', CYCLES[1], null));
  assert.throws(() => cycleRange('2026-01-01', CYCLES[1], 32));
});
test('savings and deposits reserve cash, without subtracting emergency withdrawals', () => {
  assert.deepEqual(cashFlow({ income: '1000', expenses: '200', savings: '100', deposits: '50', withdrawals: '20' }, 3), { remaining: 650, safe_daily: 216.66 });
  assert.deepEqual(cashFlow({ income: '0.30', expenses: '0.10' }, 3), { remaining: 0.2, safe_daily: 0.06 });
  assert.deepEqual(cashFlow({ income: 100, expenses: 150 }, 1), { remaining: -50, safe_daily: 0 });
  assert.throws(() => cashFlow({}, 0));
});
test('income receipt totals do not invent recurring or future income', () => {
  const rows = [{ amount: '0.10', frequency: 'Weekly', received_date: '2026-09-01' }, { amount: '0.20', frequency: 'Monthly', received_date: '2026-09-10' }, { amount: '100', received_date: '2026-10-01' }];
  assert.equal(receiptTotal(rows, '2026-09-01', '2026-09-17'), 0.3);
});
test('TillCheck classifies shortfalls, category limits, and daily allowance drops', () => {
  assert.equal(classifyCheck({ remaining_after: -1 }), 'UNSAFE');
  assert.equal(classifyCheck({ remaining_after: 100, category_exceeded: true }), 'CAUTION');
  assert.equal(classifyCheck({ remaining_after: 100, safe_daily_before: 100, safe_daily_after: 80 }), 'CAUTION');
  assert.equal(classifyCheck({ remaining_after: 100, safe_daily_before: 100, safe_daily_after: 90 }), 'WITHIN PLAN');
  assert.equal(classifyCheck({ remaining_after: 1, safe_daily_before: '0.35', safe_daily_after: '0.28' }), 'CAUTION');
  assert.equal(classifyCheck({ remaining_after: 1, safe_daily_before: '0.35', safe_daily_after: '0.29' }), 'WITHIN PLAN');
});
