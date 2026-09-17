import { getClient } from './supabase-client.js';
import * as api from './api.js';
import { ACCOUNT_TYPES, CYCLES } from './finance.js';
import { field, select, form, bindForm, click, message, errorText, escapeHTML as e, refreshIcons } from './ui.js';

const protectedPages = ['dashboard.html', 'budget.html', 'expense.html', 'savings.html', 'emergency.html', 'tillcheck.html', 'profile.html', 'settings.html'];
export function safeDestination(value) { return protectedPages.includes(value) ? value : 'dashboard.html'; }
export function callbackURL(recovery = false) {
  const url = new URL('auth-callback.html', location.href);
  if (recovery) url.searchParams.set('flow', 'recovery');
  return url.href;
}
function stored(key, value) {
  try {
    if (value === null) sessionStorage.removeItem(key);
    else if (value !== undefined) sessionStorage.setItem(key, value);
    else return sessionStorage.getItem(key);
  } catch { /* Session-only preferences are optional; Auth handles token storage. */ }
  return null;
}
export function recoveryPending() { return stored('lasttill.recovery') === 'true'; }
export async function currentUser() {
  const { data: { session }, error } = await getClient().auth.getSession();
  if (error) throw error;
  if (!session) return null;
  const { data, error: userError } = await getClient().auth.getUser();
  if (userError) {
    if (userError.status === 401 || userError.status === 403 || userError.code === 'refresh_token_not_found') {
      await getClient().auth.signOut({ scope: 'local' });
      return null;
    }
    throw userError;
  }
  return data.user;
}
export function goAfterAuth(user) {
  if (recoveryPending()) return location.replace('reset-password.html');
  if (!user.user_metadata?.lasttill_onboarding_complete) return location.replace('onboarding.html');
  const next = safeDestination(stored('lasttill.next'));
  stored('lasttill.next', null);
  location.replace(next);
}
export async function signOut() {
  await api.result(getClient().auth.signOut({ scope: 'local' }));
  stored('lasttill.recovery', null);
  stored('lasttill.next', null);
  location.replace('login.html');
}
export function watchSession() {
  getClient().auth.onAuthStateChange((event) => {
    if (event === 'PASSWORD_RECOVERY') {
      stored('lasttill.recovery', 'true');
      if (!location.pathname.endsWith('auth-callback.html') && !location.pathname.endsWith('reset-password.html')) location.replace('reset-password.html');
    }
    if (event === 'SIGNED_OUT') {
      stored('lasttill.recovery', null);
      if (document.body.dataset.protected === 'true') {
        const main = document.querySelector('.app-main');
        if (main) { main.dataset.signedOut = 'true'; main.replaceChildren(); }
        document.querySelectorAll('.profile-details, .profile-avatar').forEach(element => element.replaceChildren());
        location.replace('login.html');
      }
    }
  });
}
export async function requireUser() {
  const user = await currentUser();
  if (!user) {
    const page = location.pathname.split('/').pop();
    location.replace(`login.html?next=${encodeURIComponent(safeDestination(page))}`);
    return null;
  }
  if (recoveryPending()) { location.replace('reset-password.html'); return null; }
  if (!user.user_metadata?.lasttill_onboarding_complete) { location.replace('onboarding.html'); return null; }
  const profile = await api.profile(user.id);
  if (!profile.is_active) { await signOut(); return null; }
  return { user, profile };
}
export function profileFields(profile = {}) {
  return field('full_name', 'Full name', profile.full_name, 'text', 'required maxlength="120" autocomplete="name"') +
    select('account_type', 'Account type', ACCOUNT_TYPES, profile.account_type, 'required') +
    select('monthly_cycle', 'Cash-flow cycle', CYCLES, profile.monthly_cycle || CYCLES[0], 'required') +
    field('salary_day', 'Salary day (1–31)', profile.salary_day ?? '', 'number', 'min="1" max="31" step="1"');
}
export function wireSalaryDay() {
  const cycle = document.getElementById('monthly_cycle');
  const day = document.getElementById('salary_day');
  if (!cycle || !day) return;
  function update() {
    day.disabled = cycle.value === CYCLES[0];
    day.required = !day.disabled;
  }
  cycle.addEventListener('change', update);
  update();
}
function accountCards() {
  return `<fieldset class="account-type-picker"><legend>What best describes you?</legend><div class="user-type-grid">${ACCOUNT_TYPES.map((type, index) => `<label class="user-type-card"><input type="radio" name="account_type" value="${type}" ${index === 0 ? 'checked' : ''} required><span class="user-type-icon"><i data-lucide="${['graduation-cap', 'briefcase-business', 'chart-no-axes-combined'][index]}" aria-hidden="true"></i></span><strong>${type}</strong><span>${['Make your allowance last.', 'Plan around your salary.', 'Make room for business goals.'][index]}</span></label>`).join('')}</div></fieldset>`;
}
function passwordFields(confirm = false) {
  return field('password', confirm ? 'Create a password' : 'Password', '', 'password', `required minlength="8" maxlength="128" autocomplete="${confirm ? 'new-password' : 'current-password'}"`) +
    (confirm ? field('confirm_password', 'Confirm password', '', 'password', 'required minlength="8" maxlength="128" autocomplete="new-password"') : '');
}
function assertPasswords(data) {
  if (data.password !== data.confirm_password) throw new Error('Passwords do not match.');
}
async function finishCallback() {
  const params = new URLSearchParams(location.search);
  const hash = new URLSearchParams(location.hash.slice(1));
  const recovery = params.get('flow') === 'recovery' || params.get('type') === 'recovery';
  // Remove credentials before any async request, rendering, or navigation.
  history.replaceState({}, '', location.pathname);
  if (params.has('error') || hash.has('error')) throw new Error('Sign-in was canceled or the link expired. Return to Log In and try again.');
  watchSession();
  let response;
  if (params.has('token_hash')) {
    const type = params.get('type');
    if (!['signup', 'recovery'].includes(type)) throw new Error('Unsupported email link. Request a new link from Log In.');
    response = await getClient().auth.verifyOtp({ token_hash: params.get('token_hash'), type });
  } else if (params.has('code')) {
    response = await getClient().auth.exchangeCodeForSession(params.get('code'));
  } else {
    throw new Error('This authentication link is incomplete. Request a new link from Log In.');
  }
  if (response.error) throw new Error('This link has expired, was already used, or was opened without its original browser session. Log in or request a new email link.');
  const user = response.data.user || response.data.session?.user;
  if (!user) throw new Error('No session was created. Please log in again.');
  if (recovery) stored('lasttill.recovery', 'true');
  goAfterAuth(user);
}
export async function initAuth(page) {
  const content = document.getElementById('auth-content');
  const setContent = (title, description, body) => {
    content.innerHTML = `<p class="eyebrow">Make your money last longer</p><h1>${e(title)}</h1><p>${e(description)}</p><div id="feedback" tabindex="-1" hidden aria-live="polite"></div>${body}`;
    refreshIcons();
  };
  if (page === 'auth-callback') {
    setContent('Signing you in', 'Please keep this page open while we verify your link.', '<a class="back-link" href="login.html">Return to Log In</a>');
    try { await finishCallback(); } catch (error) { message(errorText(error), true); }
    return;
  }
  let user; let sessionError;
  try {
    watchSession();
    user = await currentUser();
  } catch (error) {
    if (!['login', 'register'].includes(page)) throw error;
    sessionError = error;
  }
  if (page === 'onboarding') {
    if (!user) { location.replace('login.html'); return; }
    if (recoveryPending()) { location.replace('reset-password.html'); return; }
    const profile = await api.profile(user.id);
    if (user.user_metadata?.lasttill_onboarding_complete) { goAfterAuth(user); return; }
    const picked = stored('lasttill.accountType');
    if (ACCOUNT_TYPES.includes(picked)) profile.account_type = picked;
    setContent('Make it yours', 'Confirm your account type and cash-flow cycle. Category budgets always use calendar months.', form('onboarding-form', profileFields(profile), 'Start planning'));
    wireSalaryDay();
    bindForm('onboarding-form', async data => {
      await api.rpc('save_profile', data);
      const { data: updated, error } = await getClient().auth.updateUser({ data: { lasttill_onboarding_complete: true } });
      if (error) throw error;
      stored('lasttill.accountType', null);
      goAfterAuth(updated.user);
    }, 'Profile saved.', false);
    return;
  }
  if (page === 'reset-password') {
    if (!user || !recoveryPending()) {
      setContent('Request a reset link', 'Open the recovery link from your email to set a new password.', '<a class="btn btn-primary" href="login.html">Back to Log In</a>');
      return;
    }
    setContent('Choose a new password', 'Use at least eight characters.', form('reset-form', passwordFields(true), 'Update password'));
    bindForm('reset-form', async data => {
      assertPasswords(data);
      await api.result(getClient().auth.updateUser({ password: data.password }));
      await signOut();
    }, 'Password updated. Please log in.', false);
    return;
  }
  if (user) { goAfterAuth(user); return; }
  const next = new URLSearchParams(location.search).get('next');
  if (next) stored('lasttill.next', safeDestination(next));
  const signup = page === 'register';
  setContent(signup ? 'Start your next chapter' : 'Welcome back', signup ? 'A little planning. A lot more peace of mind.' : 'Your money, your goals, your plan.',
    `<form id="auth-form"><fieldset>${signup ? accountCards() : ''}<div class="form-grid">${signup ? field('full_name', 'Full name', '', 'text', 'required maxlength="120" autocomplete="name"') : ''}${field('email', 'Email address', '', 'email', 'required maxlength="254" autocomplete="email"')}${passwordFields(signup)}</div><div class="form-actions"><button class="btn btn-primary btn-full" type="submit">${signup ? 'Create account' : 'Log In'}</button></div></fieldset></form>
    <div class="auth-divider"><span>or</span></div><button id="google-login" class="btn btn-google btn-full" type="button"><span class="google-mark" aria-hidden="true">G</span>Continue with Google</button>
    <p class="auth-switch">${signup ? 'Already have an account? <a href="login.html">Log In</a>' : 'New to LastTill? <a href="register.html">Sign Up</a>'}</p>
    <details class="auth-help"><summary>${signup ? 'Need another confirmation email?' : 'Forgot password or need to confirm your email?'}</summary><p>Enter your email address above, then choose an option.</p><div class="inline-actions"><button class="btn btn-secondary" id="resend-email" type="button">Resend confirmation</button>${signup ? '' : '<button class="btn btn-secondary" id="forgot-password" type="button">Send reset link</button>'}</div></details>`);
  bindForm('auth-form', async data => {
    if (signup) {
      assertPasswords(data);
      const { data: response, error } = await getClient().auth.signUp({ email: data.email.trim(), password: data.password,
        options: { emailRedirectTo: callbackURL(), data: { full_name: data.full_name.trim(), account_type: data.account_type } } });
      if (error) throw error;
      if (response.session) goAfterAuth(response.user);
      document.querySelectorAll('input[type="password"]').forEach(input => { input.value = ''; });
    } else {
      const { data: response, error } = await getClient().auth.signInWithPassword({ email: data.email.trim(), password: data.password });
      if (error) throw error;
      goAfterAuth(response.user);
    }
  }, signup ? 'Check your inbox to confirm your email. If you already have an account, use Log In.' : 'Signed in. Opening your plan…', false);
  click('google-login', async () => {
    const selected = document.querySelector('input[name="account_type"]:checked')?.value;
    if (signup && selected) stored('lasttill.accountType', selected);
    await api.result(getClient().auth.signInWithOAuth({ provider: 'google', options: { redirectTo: callbackURL() } }));
  });
  function email() {
    const input = document.getElementById('email');
    if (!input.reportValidity()) throw new Error('Enter a valid email address first.');
    return input.value.trim();
  }
  click('resend-email', async () => {
    await api.result(getClient().auth.resend({ type: 'signup', email: email(), options: { emailRedirectTo: callbackURL() } }));
    message('If confirmation is needed for this address, a new email is on its way.');
  });
  click('forgot-password', async () => {
    await api.result(getClient().auth.resetPasswordForEmail(email(), { redirectTo: callbackURL(true) }));
    message('If an account exists for this address, a password-reset link is on its way.');
  });
  if (sessionError) message(errorText(sessionError), true);
}
