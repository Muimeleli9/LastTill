import { createIcons, icons } from 'lucide';
import { money, percent, today, cents } from './finance.js';

export const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const icon = name => `<i data-lucide="${escapeHTML(name)}" aria-hidden="true"></i>`;
export function refreshIcons() { createIcons({ icons }); }
export function message(text, error = false) {
  const region = document.getElementById('feedback');
  if (!region) return;
  region.textContent = text;
  region.className = `feedback ${error ? 'feedback-error' : 'feedback-success'}`;
  region.hidden = !text;
  region.setAttribute('role', error ? 'alert' : 'status');
  if (text) region.focus({ preventScroll: true });
}
export function errorText(error) {
  if (error?.code === 'PGRST202' || error?.code === '42883') return 'Database setup is incomplete. Apply the LastTill application migration in Supabase, then reload.';
  return error?.message || 'Something went wrong. Please try again.';
}
function uncertainOutcome(error) {
  return error?.status === 0 || error?.status >= 500 || /fetch|network|timeout|abort|load failed/i.test(errorText(error));
}
export function field(name, label, value = '', type = 'text', extra = '') {
  const attrs = type === 'number' ? `${extra.includes('min=') ? '' : ' min="0.01"'}${extra.includes('max=') ? '' : ' max="9999999999.99"'}${extra.includes('step=') ? '' : ' step="0.01"'}` : '';
  return `<div class="form-group"><label for="${escapeHTML(name)}">${escapeHTML(label)}</label><input class="form-control" id="${escapeHTML(name)}" name="${escapeHTML(name)}" type="${type}" value="${escapeHTML(value)}"${attrs} ${extra}></div>`;
}
export function select(name, label, options, value = '', extra = '') {
  return `<div class="form-group"><label for="${escapeHTML(name)}">${escapeHTML(label)}</label><select class="form-control" id="${escapeHTML(name)}" name="${escapeHTML(name)}" ${extra}>${options.map(option => {
    const [id, text] = Array.isArray(option) ? option : [option, option];
    return `<option value="${escapeHTML(id)}" ${String(id) === String(value) ? 'selected' : ''}>${escapeHTML(text)}</option>`;
  }).join('')}</select></div>`;
}
export const submit = (label, name = 'save') => `<button type="submit" class="btn btn-primary">${icon(name)}${escapeHTML(label)}</button>`;
export const button = (label, id, secondary = true) => `<button type="button" id="${escapeHTML(id)}" class="btn ${secondary ? 'btn-secondary' : 'btn-primary'}">${escapeHTML(label)}</button>`;
export const stat = (label, value) => `<div class="summary-stat"><span>${escapeHTML(label)}</span><strong>${escapeHTML(value)}</strong></div>`;
export const card = (title, content, style = '') => `<article class="card ${style}"><div class="card-heading"><h2>${escapeHTML(title)}</h2></div>${content}</article>`;
export const empty = text => `<p class="empty-state">${escapeHTML(text)}</p>`;
export function form(id, body, label, note = '') {
  return `<form id="${escapeHTML(id)}"><fieldset><div class="form-grid">${body}</div>${note ? `<p class="form-hint">${escapeHTML(note)}</p>` : ''}<div class="form-actions">${submit(label)}</div></fieldset></form>`;
}
export function progress(value, target) {
  const width = percent(value, target);
  const tone = width >= 100 ? 'danger' : width >= 90 ? 'warning' : '';
  return `<div class="progress-track" role="progressbar" aria-label="Progress" aria-valuenow="${Math.round(width)}" aria-valuemin="0" aria-valuemax="100"><div class="progress-fill ${tone}" style="width:${width}%"></div></div>`;
}
export function categoryCards(categories) {
  return categories.length ? categories.map(row => {
    const spent = cents(row.spent_amount); const limit = cents(row.limit_amount);
    const over = spent > limit;
    return `<div class="budget-item"><div class="budget-row"><span>${escapeHTML(row.name)}</span><strong class="${over ? 'history-negative' : ''}">${escapeHTML(money(row.spent_amount))} / ${escapeHTML(money(row.limit_amount))}</strong></div>${progress(row.spent_amount, row.limit_amount)}<span class="progress-caption${over ? ' over' : ''}">${over ? `${escapeHTML(money((spent - limit) / 100))} over the limit` : `${escapeHTML(money((limit - spent) / 100))} remaining`}</span></div>`;
  }).join('') : empty('No category limits yet. Add them on the Budget page.');
}
export function summaryCards(summary) {
  const shortfall = Number(summary.remaining) < 0;
  return `<section class="balance-hero${shortfall ? ' balance-shortfall' : ''}"><div><p>Income received this cycle</p><h2>${escapeHTML(money(summary.income))}</h2><small>${escapeHTML(summary.start)} to ${escapeHTML(summary.end)} (next reset)</small></div><div class="balance-divider"></div><div><p>Cycle spendable money</p><h2>${escapeHTML(money(summary.remaining))}</h2><div class="balance-meta"><span>${escapeHTML(summary.days)} days including today</span><span>Safe daily: <strong>${escapeHTML(money(summary.safe_daily))}</strong></span></div></div></section>`;
}
export function dateField(name, label, value = today()) {
  return field(name, label, value, 'date', `min="1900-01-01" max="${today()}" required`);
}
export function mount(title, subtitle, body, actions = '') {
  const main = document.querySelector('.app-main');
  if (!main || main.dataset.signedOut) return;
  main.innerHTML = `<header class="page-header"><div class="page-title"><p class="eyebrow">Your LastTill</p><h1 tabindex="-1">${escapeHTML(title)}</h1><p>${escapeHTML(subtitle)}</p></div>${actions ? `<div class="header-actions">${actions}</div>` : ''}</header><div id="feedback" tabindex="-1" hidden aria-live="polite"></div>${body}`;
  refreshIcons();
}
export function bindForm(id, handler, success = 'Saved successfully.', financial = true) {
  const element = document.getElementById(id);
  element?.addEventListener('submit', async event => {
    event.preventDefault();
    if (element.dataset.busy || !element.reportValidity()) return;
    const data = Object.fromEntries(new FormData(element));
    element.dataset.busy = 'true';
    const fieldset = element.querySelector('fieldset');
    if (fieldset) fieldset.disabled = true;
    message('Saving…');
    try {
      const outcome = await handler(data);
      message(outcome === false ? '' : success);
    } catch (error) {
      const uncertain = financial && uncertainOutcome(error);
      message(errorText(error) + (uncertain ? ' The outcome may be uncertain. Reload and check your history before submitting again.' : ''), true);
    } finally {
      delete element.dataset.busy;
      if (fieldset) fieldset.disabled = false;
    }
  });
}
export function click(id, handler) {
  document.getElementById(id)?.addEventListener('click', async event => {
    const target = event.currentTarget;
    target.disabled = true;
    try { await handler(); } catch (error) {
      const detail = errorText(error);
      message(detail + (uncertainOutcome(error) ? ' Reload and check the outcome before repeating a financial action.' : ''), true);
    }
    finally { target.disabled = false; }
  });
}
export function pagination(page, hasMore) {
  return `<div class="pagination"><button class="btn btn-secondary" id="previous-page" ${page ? '' : 'disabled'}>Previous</button><span>Page ${page + 1}</span><button class="btn btn-secondary" id="next-page" ${hasMore ? '' : 'disabled'}>Next</button></div>`;
}
export function wirePagination(page, hasMore, load) {
  click('previous-page', () => page > 0 && load(page - 1));
  click('next-page', () => hasMore && load(page + 1));
}
