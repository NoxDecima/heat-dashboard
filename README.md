# Heat outlook dashboard

Experimental heat outlook for Kaolack, Khulna and Lima, built by Meteory for Practical Action's
Living in a Hotter World project. A static site: plain HTML, CSS and JavaScript modules, no build step.
It reads each city's data file, written every morning by the forecast pipeline:
`https://storage.googleapis.com/practical-action-ews-public/dashboard/<city>.json`
(contract: the pipeline repository's `docs/superpowers/specs/2026-11-08-dashboard-mvp-design.md`).

## Run locally

```bash
/path/to/EWS/.venv/bin/python tests/smoke.py --serve
```

Open `http://localhost:8000/index.html?city=lima&data=fixtures/` (fixtures) or without `&data=` (live data).
`&now=2026-11-08T13:00:00Z` fakes the clock (the out-of-date notice). The heat maps need a server that answers
range requests, which `python3 -m http.server` does not; `--serve` does, on port 8000, an origin the public bucket
allows. On `maps.html`, `&webp=0` reads the deflate copies and `&at=lat,lon` opens and reads a point.

## Check

```bash
/path/to/EWS/.venv/bin/python tests/smoke.py
/path/to/EWS/.venv/bin/python tests/smoke.py --live /path/to/EWS/data/heatmaps   # after a heat maps publish
```

## Heat maps

`maps.html` and `js/maps.js` show the PR-1 surface heat maps (pipeline repository,
`docs/superpowers/specs/2026-11-21-heat-maps-tab-design.md`). They read
`https://storage.googleapis.com/practical-action-ews-public/heatmaps/<city>/manifest.json` and the Cloud Optimized
GeoTIFFs it names with range requests, through Leaflet 1.9.4 and geotiff.js 3.0.5 (CDNs, pinned with SRI hashes,
on this page only). The pipeline's `surface_heat_maps.py --region <city> --publish` writes and uploads them;
`--fixture <this repository>/fixtures` writes the cropped copies in `fixtures/heatmaps/` with `expect.json`, the
readout the smoke test checks.

## Languages

Every string is in `i18n/en.json`. A new language is a copy of that file (`i18n/es.json`) plus its code in
`LANGS` (and its locale in `LOCALE`) in `js/app.js`.

## Publish

GitHub Pages serves `main` from the root. Pages are unlisted (`noindex`), not secret.
