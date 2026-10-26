# Manual check scripts

Print-based scripts for exercising individual services by hand. They are not automated
tests (see `backend/tests/` for those). Run them from `backend/` so the `app` package resolves:

```bash
cd backend
python -m scripts.manual_checks.check_preprocessors
```

`check_api_preview.py` calls a running backend on http://localhost:8000.
