# LastTill

A personal money-planning web app: calendar-month category budgets, a salary/calendar cash-flow cycle, savings goals, an emergency fund, and TillCheck purchase decisions before you spend.

Multi-page HTML/CSS/vanilla JavaScript frontend built with Vite, backed by Supabase (Auth + Postgres).

## Requirements

- Node.js `^20.19.0` or `>=22.12.0` (tested with Node 24) and npm
- Windows/PowerShell note: if `npm.ps1` is blocked by execution policy, use `npm.cmd` — all commands below use it.

## 1. Clone the repository

```powershell
git clone https://github.com/Muimeleli9/LastTill.git
cd LastTill
```

## 2. Install dependencies

```powershell
npm.cmd install
```

## 3. Add your connection values

Copy the template and fill in your Supabase project's two public values (Supabase Dashboard → Project Settings → API):

```powershell
Copy-Item .env.example .env
```

```
VITE_SUPABASE_URL=https://YOUR-PROJECT.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=YOUR-PUBLISHABLE-KEY
```

Use only the publishable key (or legacy anon key) — never a service-role key or database password. `.env` is gitignored, and values are read at startup, so restart the dev server after editing.

## 4. Run the app

```powershell
npm.cmd run dev
```

Open http://127.0.0.1:5173/ in your browser and sign in.

## Build for production

```powershell
npm.cmd run build
npm.cmd run preview
```

`build` writes the static site to `dist/` (14 pages plus assets), ready to host anywhere; `preview` serves that build locally.

## Optional: run the tests

```powershell
npm.cmd test              # finance math + in-memory PostgreSQL integration tests
npm.cmd run test:browser  # Playwright UI tests against a mocked backend
```

If Playwright's Chromium isn't installed, either run `npx playwright install chromium` or reuse installed Edge:

```powershell
$env:PLAYWRIGHT_CHANNEL='msedge'; npm.cmd run test:browser
```

## Project layout

```
frontend/     Pages and assets (js/ modules, js/pages/ controllers, css/style.css)
supabase/     Database migration
tests/        Test suites
vite.config.js
```
