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
        b = p.chromium.launch(args=["--host-resolver-rules=MAP dash.test 127.0.0.1"])
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
            check(pg.title() == f"Heat outlook · {city.capitalize()}", f"{city}: forecast title")
            tips = pg.eval_on_selector_all(".tip", "els => els.map(e => [e.getAttribute('aria-label'), e.dataset.tip])")
            check(tips and all(a and a == t for a, t in tips), f"{city}: every tooltip reads its text to screen readers")
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
            check(pg.title() == f"Track record · {city.capitalize()}", f"{city}: track record title")
            check(pg.locator(".seg[role=group][aria-labelledby]").count() == 2, f"{city}: period and lead are labelled groups")
            check(not errors, f"{city}: no console errors {errors}")
        # A file read late in the day: the viewer's today is the file's tomorrow.
        g = datetime.fromisoformat(json.loads((ROOT / "fixtures" / "lima.json").read_text())["generated"].replace("Z", "+00:00"))
        pg, _ = page(b)
        pg.goto(f"{base}index.html?city=lima&data=fixtures/&now={quote((g + timedelta(hours=22)).isoformat())}")
        pg.wait_for_selector("#strip .day", timeout=5000)
        names = pg.locator("#strip .day .dn").all_inner_texts()
        check(names[0] != "Today" and names[1] == "Today", f"lima, 22 h later: card 1 is today {names[:2]}")
        check("past" in pg.get_attribute("#strip .day >> nth=0", "class"), "lima, 22 h later: card 0 is past")
        for c in ("khulna", "lima"):
            pg, errors = page(b)
            pg.goto(f"{base}index.html?city={c}&data=fixtures/edge/nomembers/")
            pg.wait_for_selector("#detail h2", timeout=5000)
            check(pg.locator("#detail svg").count() == 0 and not errors, f"{c}: no forecast members, no spread chart and no errors {errors}")
        pg, _ = page(b)
        pg.goto(f"{base}index.html?city=kaolack&data=fixtures/edge/xss/")
        pg.wait_for_selector(".error", timeout=5000)
        check("needs an update" in pg.inner_text(".error"), "unknown level in the data: update message")
        pg.goto(f"{base}index.html?city=kaolack&data=fixtures/edge/broken/")
        pg.wait_for_selector(".error", timeout=5000)
        check("needs an update" in pg.inner_text(".error"), "data that breaks the page: update message")
        # Any host but localhost: ?data= and ?now= are ignored, the public file is asked for.
        pg = b.new_page()
        asked = []
        pg.route("**/*", lambda r: (asked.append(r.request.url), r.abort() if "googleapis" in r.request.url else r.continue_()))
        pg.goto(f"http://dash.test:{srv.server_port}/index.html?city=kaolack&data=fixtures/")
        pg.wait_for_selector(".error", timeout=5000)
        check(any("googleapis" in u for u in asked) and not any("fixtures/kaolack" in u for u in asked), "other host: ?data= ignored")
        check("data=" not in pg.get_attribute("footer a", "href"), "other host: links drop ?data=")
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
        check(pg.title() == "How it works", "docs: title from the strings")
        b.close()
    srv.shutdown()
    print(f"\n{len(failures)} failure(s)")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
