import { initAuth, requireUser, watchSession, signOut } from './auth.js';
import { refreshIcons, message, errorText, mount } from './ui.js';
import { initTheme } from './theme.js';
import { dashboard } from './pages/dashboard.js';
import { budgetPage } from './pages/budget.js';
import { expensePage } from './pages/expense.js';
import { savingsPage } from './pages/savings.js';
import { emergencyPage } from './pages/emergency.js';
import { tillcheckPage } from './pages/tillcheck.js';
import { historyPage } from './pages/history.js';
import { accountPage, renderIdentity } from './pages/account.js';

initTheme();

const profileButton = document.getElementById("profileButton");
const profileWrapper = document.querySelector(".profile-menu-wrapper");
const profileDropdown = document.getElementById("profileDropdown");

if (profileButton && profileWrapper) {

    profileButton.addEventListener("click", function (event) {
        event.stopPropagation();

        profileWrapper.classList.toggle("open");
        profileButton.setAttribute('aria-expanded', String(profileWrapper.classList.contains('open')));
    });

    document.addEventListener("click", function () {
        profileWrapper.classList.remove("open");
        profileButton.setAttribute('aria-expanded', 'false');
    });

    if (profileDropdown) {
        profileDropdown.addEventListener("click", function (event) {
            event.stopPropagation();
        });
    }
    profileButton.setAttribute('aria-expanded', 'false');
    profileButton.setAttribute('aria-controls', 'profileDropdown');
}

const menuToggle = document.getElementById('mobile-menu-toggle');
menuToggle?.addEventListener('click', () => {
    const open = document.body.classList.toggle('navigation-open');
    menuToggle.setAttribute('aria-expanded', String(open));
});
document.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
        profileWrapper?.classList.remove('open');
        profileButton?.setAttribute('aria-expanded', 'false');
        document.body.classList.remove('navigation-open');
        menuToggle?.setAttribute('aria-expanded', 'false');
    }
});
document.querySelectorAll('.logout-link').forEach(link => link.addEventListener('click', async event => {
    event.preventDefault();
    try { await signOut(); } catch (error) { message(errorText(error), true); }
}));
refreshIcons();
window.addEventListener('load', refreshIcons);
// Revalidate cached pages on back/forward navigation after signing out.
window.addEventListener('pageshow', event => { if (event.persisted) location.reload(); });

async function start() {
    const page = document.body.dataset.page || location.pathname.split('/').pop()?.replace('.html', '') || 'index';
    if (page === 'index') return;
    try {
        if (['login', 'register', 'auth-callback', 'reset-password', 'onboarding'].includes(page)) {
            await initAuth(page);
            return;
        }
        watchSession();
        const context = await requireUser();
        if (!context) return;
        renderIdentity(context.profile);
        const pages = { dashboard, budget: budgetPage, expense: expensePage, savings: savingsPage,
            emergency: emergencyPage, tillcheck: tillcheckPage, history: historyPage,
            profile: accountPage, settings: ctx => accountPage(ctx, true) };
        if (!pages[page]) throw new Error('Page not found.');
        await pages[page](context);
    } catch (error) {
        if (document.querySelector('.app-main')) {
            mount('Unable to load your account', 'Your data has not been replaced by sample values.', '<div class="inline-actions"><button type="button" class="btn btn-primary" id="retry-page">Retry</button><a class="btn btn-secondary" href="login.html">Back to Log In</a></div>');
            document.getElementById('retry-page')?.addEventListener('click', () => location.reload());
        }
        message(errorText(error), true);
    }
}
start();