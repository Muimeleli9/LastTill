export const ACCOUNT_TYPES = ['Student', 'Employed', 'Entrepreneur'];
export const PAYMENTS = ['Bank Card', 'Cash', 'Transfer', 'Mobile Payment'];
export const FREQUENCIES = ['Once-off', 'Weekly', 'Monthly'];
export const REASONS = ['Medication', 'Transport Emergency', 'Urgent Food', 'Family Emergency', 'Other'];
export const CYCLES = ['1st to month-end', 'Salary date to next salary date'];

export function today() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Johannesburg', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}
export function cents(value) {
  const match = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(String(value));
  if (!match) throw new Error('Enter a valid amount with at most two decimal places.');
  const amount = Number(match[2]) * 100 + Number((match[3] || '').padEnd(2, '0'));
  if (!Number.isSafeInteger(amount)) throw new Error('Amount is too large.');
  return match[1] ? -amount : amount;
}
export function money(value = 0) {
  return new Intl.NumberFormat('en-ZA', { style: 'currency', currency: 'ZAR' }).format(Number(value));
}
export function dateLabel(value) {
  if (!value) return '—';
  const date = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T12:00:00Z`) : new Date(value);
  return new Intl.DateTimeFormat('en-ZA', { dateStyle: 'medium', timeZone: 'Africa/Johannesburg' }).format(date);
}
export function percent(value, target) {
  return Number(target) > 0 ? Math.min(100, Math.max(0, Number(value) / Number(target) * 100)) : 0;
}
function monthDay(year, month, day) {
  return new Date(Date.UTC(year, month, Math.min(day, new Date(Date.UTC(year, month + 1, 0)).getUTCDate())));
}
export function cycleRange(on, cycle = CYCLES[0], salaryDay = null) {
  const date = new Date(`${on}T00:00:00Z`);
  if (Number.isNaN(date.valueOf()) || date.toISOString().slice(0, 10) !== on) throw new Error('Invalid date.');
  const salary = cycle === CYCLES[1];
  if (salary && (!Number.isInteger(salaryDay) || salaryDay < 1 || salaryDay > 31)) throw new Error('Choose a salary day from 1 to 31.');
  const day = salary ? salaryDay : 1;
  const year = date.getUTCFullYear();
  let month = date.getUTCMonth();
  if (date < monthDay(year, month, day)) month--;
  const start = monthDay(year, month, day);
  const end = monthDay(year, month + 1, day);
  return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10), days: Math.round((end - date) / 86400000) };
}
export function cashFlow({ income = 0, expenses = 0, savings = 0, deposits = 0 }, days) {
  if (!Number.isInteger(days) || days < 1) throw new Error('Invalid days remaining.');
  const remaining = cents(income) - cents(expenses) - cents(savings) - cents(deposits);
  return { remaining: remaining / 100, safe_daily: Math.floor(Math.max(0, remaining) / days) / 100 };
}
export function receiptTotal(rows, start, through) {
  return rows.filter(row => row.received_date >= start && row.received_date <= through)
    .reduce((total, row) => total + cents(row.amount), 0) / 100;
}
export function classifyCheck(check) {
  if (Number(check.remaining_after) < 0) return 'UNSAFE';
  if (check.category_exceeded) return 'CAUTION';
  const before = cents(check.safe_daily_before);
  const reduced = before > 0 && cents(check.safe_daily_after) * 5 <= before * 4;
  return reduced ? 'CAUTION' : 'WITHIN PLAN';
}
