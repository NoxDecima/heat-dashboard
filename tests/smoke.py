"""Smoke test: every page for every city against the fixtures, plus the error states.
Run from the repository root with a Python that has Playwright, for example the EWS environment:
    /home/nox/Documents/Projects/Nox/EWS/.venv/bin/python tests/smoke.py
Exit 0 when every check passes."""
import http.server
import json
import sys
import threading
from datetime import datetime, timedelta
from pathlib import Path
from urllib.parse import quote

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
CITIES = ("kaolack", "khulna", "lima")


class Quiet(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **k):
        super().__init__(*a, directory=str(ROOT), **k)

    def log_message(self, *a):
        pass


def page(browser):
    pg = browser.new_page(viewport={"width": 1200, "height": 900})
    errors = []
    pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
    return pg, errors


def main() -> int:
    srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Quiet)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    base = f"http://127.0.0.1:{srv.server_port}/"
    failures = []

    def check(cond, what):
        print(("ok   " if cond else "FAIL ") + what)
        if not cond:
            failures.append(what)

    with sync_playwright() as p:
        b = p.chromium.launch()
        for city in CITIES:
            gen = json.loads((ROOT / "fixtures" / f"{city}.json").read_text())["generated"]
            g = datetime.fromisoformat(gen.replace("Z", "+00:00"))
            fresh, old = (quote((g + timedelta(hours=h)).isoformat()) for h in (3, 40))
            pg, errors = page(b)
            pg.goto(f"{base}index.html?city={city}&data=fixtures/&now={fresh}")
            pg.wait_for_selector("#strip .day", timeout=5000)
            check(pg.locator("#strip .day").count() == 7, f"{city}: seven day cards")
            check(pg.inner_text("#headline").strip() != "", f"{city}: headline")
            check(pg.locator(".fresh.stale").count() == 0, f"{city}: fresh file, no out-of-date notice")
            pg.locator("#strip .day").nth(5).click()
            check(pg.locator("#detail .badge.muted").count() == 1, f"{city}: a later day's detail says less certain")
            check(pg.locator("#week svg").count() == 1, f"{city}: week chart")
            pg.goto(f"{base}index.html?city={city}&data=fixtures/&now={old}")
            pg.wait_for_selector("#strip .day", timeout=5000)
            check(pg.locator(".fresh.stale").count() == 1, f"{city}: old file, out-of-date notice")
            pg.goto(f"{base}history.html?city={city}&data=fixtures/")
            pg.wait_for_selector("#stats .stat, #body .note", timeout=5000)
            check(pg.locator("#stats .stat").count() == 3, f"{city}: three track record numbers")
            check(pg.locator("#dbd svg").count() == 1, f"{city}: day by day chart")
            check(not errors, f"{city}: no console errors {errors}")
        pg, _ = page(b)
        pg.goto(f"{base}index.html?data=fixtures/")
        pg.wait_for_selector(".picker a", timeout=5000)
        check(pg.locator(".picker a").count() == 3, "no city: picker with three cities")
        pg.goto(f"{base}index.html?city=kaolack&data=fixtures/bad/")
        pg.wait_for_selector(".error", timeout=5000)
        check("needs an update" in pg.inner_text(".error"), "unknown schema: update message")
        pg.goto(f"{base}index.html?city=kaolack&data=fixtures/none/")
        pg.wait_for_selector(".error", timeout=5000)
        check("could not be loaded" in pg.inner_text(".error"), "missing file: load message")
        pg.goto(f"{base}docs.html")
        pg.wait_for_selector("#datalinks a", timeout=5000)
        check(pg.inner_text("h1").strip() != "", "docs: title")
        check(pg.locator("#datalinks a").count() == 3, "docs: three data links")
        b.close()
    srv.shutdown()
    print(f"\n{len(failures)} failure(s)")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
