# R-Data frontend

React 19 + Vite + Tailwind CSS 4 single-page app for the R-Data Data Intelligence Platform.

## Run locally

```bash
npm ci
npm run dev        # http://localhost:3000, proxies /api to the backend on http://127.0.0.1:8000
npm run build      # production bundle in dist/
npm run lint       # oxlint
```

Start the backend first (see the root `README.md`).

## Configuration

| Variable | Default | Purpose |
|---|---|---|
| `VITE_API_BASE_URL` | `/api` | Backend base URL. Leave unset to use the Vite dev-server proxy. |

Copy `.env.example` to `.env.local` to override values locally.

## Layout

```
src/
  main.jsx, App.jsx, index.css
  api/                      # all backend calls; import from '@/api'
    client.js               # API_BASE + shared response helpers
    source.js skills.js prompts.js migration.js project.js settings.js ide.js
    cfo.js governance.js costing.js cloudModernization.js
  components/               # shared UI: Sidebar, SettingsModal, PromptOptimizerButton, SnowflakeConnectionModal
  features/
    code-conversion/        # 6-step wizard (Stepper, Step1…Step6, defaultPrompts)
    cloud-modernization/    # PromptMigrationWorkspace
    cfo-analytics/          # AnalyticsDashboard + components/
    governance/             # AI governance & pipeline monitoring
    costing/                # Snowflake / dbt / Airflow FinOps dashboards
    enterprise/             # Enterprise dashboard pages (not wired into the app yet)
```

`@/` is an alias for `src/` (see `vite.config.js`). Use it for imports across folders; use `./` within a folder.

## Not currently used

These files are kept but are not imported anywhere, so they never render:

- `features/enterprise/*` (EnterpriseDashboard and Page1–Page5)
- `features/governance/DbtMonitoringView.jsx`, `AirflowMonitoringView.jsx`, `AirflowChatbotModal.jsx`,
  `DbtCloudConnectionBar.jsx` — superseded by `MonitoringView.jsx`. The two monitoring views import
  API functions that were removed in commit `c23c3fa`, so they need updating before they can be used.
- `features/cfo-analytics/components/CFOExecutiveReport.jsx`, `CFOKpiGrid.jsx`, `CFOVisualizations.jsx`
- `features/code-conversion/Step2SourceOverview.jsx`
- `features/costing/SnowflakeCostConnectionBar.jsx`
- `src/App.css` (Vite template styles)

## Known issues

- `runDbtBuild` (`api/project.js`) calls `POST /api/project/build` and `cloudModDeleteFile`
  (`api/cloudModernization.js`) calls `POST /api/migration/delete-file`; neither endpoint exists in the backend.
- `npm run lint` still reports React hook warnings (`exhaustive-deps`, `set-state-in-effect`) that need case-by-case fixes.
