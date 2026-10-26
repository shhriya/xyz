# R-Data — AI-Powered Data Intelligence Platform

A FastAPI backend and React frontend for:

- **Code Conversion**: a 6-step wizard that converts legacy ETL (Informatica, PySpark, SQL) into dbt projects.
- **Cloud Modernization**: generates dbt projects from prompts.
- **Analytics Dashboard**: CFO analytics on Snowflake, with semantic models, KPI dashboards and a Cortex AI analyst.
- **Governance**: monitoring for dbt Cloud and Airflow, a chatbot, and bottleneck analysis.
- **FinOps costing**: cost dashboards for Snowflake, dbt Cloud and managed Airflow.

The application database is one **shared, hosted PostgreSQL** database that the whole team connects to. Snowflake, Databricks and similar systems are only the data platforms the app connects to. Docker is not needed.

## Repository layout

```
backend/                 FastAPI app (Python 3.12+)
  app/
    main.py              app factory, router registration, startup
    core/config.py       all settings (env vars / backend/.env)
    db/                  SQLAlchemy engine, models, repository, document stores, migrations runner
    api/                 Code Conversion wizard + platform endpoints (/api/source, /api/migration, ...)
    services/            shared helpers (GitHub export, dbt workspace, settings, ...)
    demo_data/           built-in sample legacy sources
    modules/             feature modules: code_conversion, cloud_modernization,
                         cfo_analytics, ai_governance, costing/{snowflake,dbt,managed_airflow}
  alembic/               database migrations
  scripts/               copy_database.py, migrate_legacy_data.py, manual_checks/
  tests/                 pytest suite (needs PostgreSQL)
frontend/                React + Vite app (see frontend/README.md)
neon.ts, package.json    Neon project config (`neon config plan` / `neon deploy`)
sql/snowflake/           Snowflake setup scripts (sample data, gold views, Cortex agent)
samples/                 sample semantic model
docs/                    product documents
```

`dbt_output/` and `dbt_cloud_modernization/` are created at runtime and are not committed.

## Team database (Neon)

The team shares one [Neon](https://neon.tech) PostgreSQL database: project `calm-rain-17606721`, branch `production`.
The backend reads the connection settings from `.env.local` in the repo root, which the Neon CLI writes.
If `backend/.env` sets the same variables, those values win.

**Option A: Neon CLI** (you need to be a member of the Neon organization; ask the project owner to invite you)

```bash
npm i -g neon@latest
neon login
neon link --project-id calm-rain-17606721 --branch production -y   # writes .env.local
```

**Option B: no Neon account.** Ask a teammate for the two connection strings and put them in `backend/.env`:

```
DATABASE_URL=postgresql://...-pooler.../neondb?sslmode=require&channel_binding=require
DATABASE_URL_UNPOOLED=postgresql://.../neondb?sslmode=require&channel_binding=require
```

In both cases, also put the team's shared `APP_ENCRYPTION_KEY` in `backend/.env`. Get it from a teammate privately.

How the connection works:

- The app uses the pooled URL (`DATABASE_URL`). Migrations use the direct URL (`DATABASE_URL_UNPOOLED`), because the pooler doesn't keep the session that migrations need.
- Everyone works on the same project (`default_project`), so saved connections, dashboards, generated files and settings are shared.
- If your `APP_ENCRYPTION_KEY` differs from the team's, saved credentials fail to load with a clear error.
- Migrations run automatically when the backend starts, and a lock stops two people from running them at the same time. After a teammate adds a migration, pull their code before starting the backend. Older code fails at startup with "Can't locate revision".
- Neon project settings live in `neon.ts`. Preview changes with `neon config plan` and apply them with `neon deploy`.

## Quick start

Prerequisites: Python 3.12+ and Node 22+.

```bash
# Backend
cd backend
python -m venv .venv
.venv/Scripts/activate                 # Windows PowerShell: .\.venv\Scripts\Activate.ps1
pip install -r requirements-dev.txt
copy .env.example .env                 # set APP_ENCRYPTION_KEY, GEMINI_API_KEY (+ DB URLs if not using neon link)
uvicorn app.main:app --reload          # http://localhost:8000/docs

# Frontend (new terminal)
cd frontend
npm ci
npm run dev                            # http://localhost:3000
```

To check the backend is working, open `http://localhost:8000/api/health`. It should show `{"status":"ok","database":"up"}`.

## Configuration

All backend settings are documented in [backend/.env.example](backend/.env.example). The most important ones:

| Variable | Required | Notes |
|---|---|---|
| `DATABASE_URL` | yes | Pooled Neon URL, from `.env.local` or `backend/.env`. The app does not start without it. |
| `DATABASE_URL_UNPOOLED` | recommended | Direct Neon URL, used for migrations. |
| `APP_ENCRYPTION_KEY` | yes (shared) | Encrypts saved credentials. Must be the same for everyone who uses the database. |
| `GEMINI_API_KEY` / `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` | per feature | LLM providers. Keys saved in the Settings dialog are stored in the database and take precedence. |
| `SEED_DEMO_DATA` | no | `true` (default) seeds the sample Informatica/PySpark project into an empty database. |
| `CORS_ORIGINS` | production | Comma-separated list of allowed origins. |

## Moving existing data into the shared database

Point `DATABASE_URL` at the shared database first, then run one of these from `backend/`:

```bash
# From another PostgreSQL database (e.g. a previous local one):
python -m scripts.copy_database --source-url postgresql://user:pass@localhost:5433/rdata

# From the old SQLite file and *_store.json files:
python -m scripts.migrate_legacy_data --dry-run      # shows what will be imported
python -m scripts.migrate_legacy_data                # imports (safe to re-run)
python -m scripts.migrate_legacy_data --delete-json  # optional: remove the JSON files afterwards
```

Both scripts skip rows that already exist, so they are safe to run again.

## Tests and linting

```bash
cd backend && pytest          # creates and drops your own "<db>_test_<username>" database on the same server
cd backend && ruff check app
cd frontend && npm run lint && npm run build
```

The tests need permission to create databases. If your provider doesn't allow that, set `TEST_DATABASE_URL` to a separate, disposable database.

`backend/tests/api_routes.txt` lists every API route that the frontend depends on. The tests fail if a route changes without updating that file.

## Security notes

- Never commit `backend/.env`, private keys (`*.p8`) or the legacy `*_store.json` files. `.gitignore` covers them.
- `POST /api/ide/run` executes shell commands on the server. Disable it or protect it before exposing the app outside a trusted network.
- `GET /api/settings` and `GET /api/cfo/connections` return stored secrets to the browser. There is no authentication yet, so don't expose the backend outside your own machine or a trusted network.
