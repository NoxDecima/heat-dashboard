# Heat outlook dashboard

Experimental heat outlook for Kaolack, Khulna and Lima, built by Meteory for Practical Action's
Living in a Hotter World project. A static site: plain HTML, CSS and JavaScript modules, no build step.
It reads each city's data file, written every morning by the forecast pipeline:
`https://storage.googleapis.com/practical-action-ews-public/dashboard/<city>.json`
(contract: the pipeline repository's `docs/superpowers/specs/2026-11-08-dashboard-mvp-design.md`).

## Run locally

```bash
python3 -m http.server 8000
```

Open `http://localhost:8000/index.html?city=lima&data=fixtures/` (fixtures) or without `&data=` (live data).
`&now=2026-11-08T13:00:00Z` fakes the clock (the out-of-date notice).

## Check

```bash
/path/to/EWS/.venv/bin/python tests/smoke.py
```

## Languages

Every string is in `i18n/en.json`. A new language is a copy of that file (`i18n/es.json`) plus its code in
`LANGS` (and its locale in `LOCALE`) in `js/app.js`.

## Publish

GitHub Pages serves `main` from the root. Pages are unlisted (`noindex`), not secret.
