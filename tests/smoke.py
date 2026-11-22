"""Smoke test: every page for every city against the fixtures, plus the error states.
Run from the repository root with a Python that has Playwright, for example the EWS environment:
    /home/nox/Documents/Projects/Nox/EWS/.venv/bin/python tests/smoke.py
    /home/nox/Documents/Projects/Nox/EWS/.venv/bin/python tests/smoke.py --live /path/to/EWS/data/heatmaps
    /home/nox/Documents/Projects/Nox/EWS/.venv/bin/python tests/smoke.py --serve
--serve serves the site with range requests on http://localhost:8000 until Ctrl-C. --live checks the heat maps tab against the public bucket after a publish (by hand): the page is served
as http://localhost:8000, an origin the bucket's CORS rule allows, through Playwright's routing, so the
port need not be free; the folder holds each city's expect.json.
Exit 0 when every check passes."""
import contextlib
import http.server
import io
import json
import re
import sys
import threading
import time
from datetime import datetime, timedelta
from decimal import ROUND_HALF_UP, Decimal
from pathlib import Path
from urllib.parse import quote, urlparse

from playwright.sync_api import TimeoutError as PWTimeout, sync_playwright

ROOT = Path(__file__).resolve().parent.parent
CITIES = ("kaolack", "khulna", "lima")


class Quiet(http.server.SimpleHTTPRequestHandler):
    """The repository, quietly; a single-range request gets 206 and that slice, as the bucket answers it."""
    def __init__(self, *a, **k):
        super().__init__(*a, directory=str(ROOT), **k)

    def log_message(self, *a):
        pass

    def send_head(self):
        m = re.fullmatch(r"bytes=(\d+)-(\d*)", self.headers.get("Range", ""))
        path = Path(self.translate_path(self.path))
        if not m or not path.is_file():
            return super().send_head()
        data = path.read_bytes()
        a, b = int(m[1]), min(int(m[2] or len(data) - 1), len(data) - 1)
        if a >= len(data) or b < a:
            self.send_error(416)
            return None
        self.send_response(206)
        self.send_header("Content-Type", self.guess_type(str(path)))
        self.send_header("Content-Range", f"bytes {a}-{b}/{len(data)}")
        self.send_header("Content-Length", str(b - a + 1))
        self.send_header("Accept-Ranges", "bytes")
        self.end_headers()
        return io.BytesIO(data[a:b + 1])


@contextlib.contextmanager
def guard(check, what, b):
    """A Playwright timeout in the block is one FAIL, not a crash; pages the block opened are closed."""
    n = len(b.contexts)
    try:
        yield
    except PWTimeout as e:
        check(False, f"{what}: timeout {str(e).splitlines()[0]}")
    finally:
        for c in b.contexts[n:]:
            c.close()


def page(browser):
    pg = browser.new_page(viewport={"width": 1200, "height": 900})
    errors = []
    pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
    return pg, errors


# Heat maps: some heat-layer canvas has a drawn pixel.
DRAWN = """() => [...document.querySelectorAll('.leaflet-heat-pane canvas')].some(c => {
  const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  for (let i = 3; i < d.length; i += 4) if (d[i]) return true;
  return false; })"""
# ... and every heat tile of the view is drawn (the live budgets' "drawn").
LOADED = """() => { const t = [...document.querySelectorAll('.leaflet-heat-pane .leaflet-tile')];
  return t.length > 0 && t.every(x => x.classList.contains('leaflet-tile-loaded')); }"""
BLANK_PNG = bytes.fromhex("89504e470d0a1a0a0000000d4948445200000001000000010806000000"
                          "1f15c4890000000d49444154789c6300010000000500010d0a2db40000000049454e44ae426082")
PAGES = ("index", "history", "alert", "maps", "docs")


def fmt(v, d=0):
    """A number as the page prints it: Intl rounds halves away from zero."""
    return f"{Decimal(str(abs(v))).quantize(Decimal(1).scaleb(-d), ROUND_HALF_UP):,}"


def missing_numbers(card, v):
    """The readout's numbers for values `v` (expect.json) that the card text lacks."""
    text = card.replace("\u00a0", " ")
    want = [f"about {fmt(v['day_median'])} °C", f"between {fmt(v['day_p25'])} °C and {fmt(v['day_p75'])} °C"]
    if v["relative"] is not None and abs(v["relative"]) >= 1:
        want.append(f"{fmt(v['relative'], 1)} °C {'warmer' if v['relative'] > 0 else 'cooler'}")
    if v.get("night_median") is not None:
        want.append(f"cools to about {fmt(v['night_median'])} °C")
    return [w for w in want if w not in text]


def heat_maps(b, base, check):
    """The Heat maps tab against fixtures/heatmaps/ (written by the EWS repository's
    surface_heat_maps.py --publish --fixture): each crop is centred on the readout point of expect.json."""
    for city in CITIES:
        with guard(check, city, b):
            folder = ROOT / "fixtures" / "heatmaps" / city
            man, exp = (json.loads((folder / f).read_text()) for f in ("manifest.json", "expect.json"))
            first = man["seasons"][0]["key"]
            pg, errors = page(b)
            tifs = []
            pg.on("response", lambda r: tifs.append((r.url, r.status, r.request.headers.get("range"))) if r.url.endswith(".tif") else None)
            pg.route("https://server.arcgisonline.com/**", lambda r: r.fulfill(body=BLANK_PNG, content_type="image/png"))
            pg.goto(f"{base}maps.html?city={city}&data=fixtures/")
            pg.wait_for_function(DRAWN, timeout=10000)
            layers = [l for l in man["layers"] if l["season"] in (first, None)]
            check(pg.locator("#rail input[name=layer]").count() == len(layers), f"{city}: maps, the rail lists the manifest's layers")
            check(pg.title() == f"Heat maps · {city.capitalize()}", f"{city}: maps title")
            check(pg.locator("meta[name=robots][content=noindex]").count() == 1, f"{city}: maps page has noindex")
            box = pg.locator("#map").bounding_box()
            pg.mouse.click(box["x"] + box["width"] / 2, box["y"] + box["height"] / 2)
            pg.wait_for_selector("#card .rsub", timeout=5000)
            miss = missing_numbers(pg.inner_text("#card"), exp["values"][first])
            check(not miss, f"{city}: maps, a click at the crop's centre reads expect.json {miss}")
            check(tifs and all(s == 206 and r for _, s, r in tifs), f"{city}: maps, every .tif read is a range request answered 206")
            if city == "khulna":
                check(pg.locator("#rail input[value=station]").count() == 0 and pg.locator("#rail input[value=night]").count() == 0,
                      "khulna: maps, no station toggle and no night layer")
            if city == "kaolack":
                pg.check("#rail input[value=day]")
                pg.wait_for_function(DRAWN, timeout=5000)
                ends = pg.locator("#legend .ticks span").all_inner_texts()
                so = next(l["file"] for l in man["layers"] if l["id"] == "day_so")
                pg.click("#rail [data-season=so]")
                pg.wait_for_function(f"() => performance.getEntriesByType('resource').some(e => e.name.endsWith('{so}'))", timeout=5000)
                check(pg.is_checked("#rail input[value=day]") and pg.get_attribute("#rail [data-season=so]", "aria-pressed") == "true",
                      "kaolack: maps, the season switch keeps the day layer and swaps its file")
                check(pg.locator("#legend .ticks span").all_inner_texts() == ends, "kaolack: maps, both day maps on one scale")
            if city == "lima":
                pg.check("#rail input[value=checks]")
                pg.locator(".chk").first.focus()
                pg.keyboard.press("Enter")
                pg.wait_for_selector(".leaflet-popup .sat", timeout=5000)
                check(pg.locator(".leaflet-popup img").count() == 0, "lima: maps, a check popup shows no imagery")
                pg.click(".leaflet-popup .sat")
                pg.wait_for_selector(".leaflet-tile-loaded[src*='/tile/18/']", timeout=5000)
                check(pg.is_checked("#rail input[value=sat]") and pg.locator("#rail input[name=layer]:checked").count() == 0,
                      "lima: maps, Show on satellite: satellite at zoom 18, heat layer off")
            check(not errors, f"{city}: maps, no console errors {errors}")
    with guard(check, "maps error states", b):
        pg, errors = page(b)
        asked = []
        pg.on("request", lambda r: asked.append(r.url.split("/")[-1]) if r.url.endswith(".tif") else None)
        pg.goto(f"{base}maps.html?city=lima&data=fixtures/&webp=0")
        pg.wait_for_function(DRAWN, timeout=10000)
        man = json.loads((ROOT / "fixtures" / "heatmaps" / "lima" / "manifest.json").read_text())
        webp, deflate = {l["file"] for l in man["layers"]}, {l["fallback"] for l in man["layers"]}
        check(not set(asked) & webp and set(asked) & deflate, f"?webp=0 reads only the deflate copies {asked}")
        pg.goto(f"{base}maps.html?city=lima&data=fixtures/edge/maps/")
        pg.wait_for_selector(".error", timeout=5000)
        check("needs an update" in pg.inner_text(".error"), "maps: unknown schema, update message")
        pg.goto(f"{base}maps.html?city=lima&data=fixtures/none/")
        pg.wait_for_selector(".error", timeout=5000)
        check("could not be loaded" in pg.inner_text(".error"), "maps: missing manifest, load message")
    with guard(check, "phone", b):
        m = b.new_page(viewport={"width": 390, "height": 844})
        for name in PAGES:
            m.goto(f"{base}{name}.html?city=lima&data=fixtures/")
            m.wait_for_selector(".nav .on", timeout=5000)
            r = m.evaluate("""() => { const n = document.querySelector('.nav'), a = n.querySelector('.on').getBoundingClientRect(),
                b = n.getBoundingClientRect(); return { w: document.documentElement.scrollWidth, inside: a.left >= b.left && a.right <= b.right }; }""")
            check(r["w"] == 390 and r["inside"], f"phone: {name} fits and its tab is in view {r}")
        m.goto(f"{base}maps.html?city=lima&data=fixtures/")
        m.wait_for_function(DRAWN, timeout=10000)
        m.click("#layersbtn")
        check(m.is_visible("#rail") and m.get_attribute("#layersbtn", "aria-expanded") == "true", "phone: maps, Layers opens the sheet")
        m.keyboard.press("Escape")
        check(not m.is_visible("#rail") and m.evaluate("document.activeElement.id") == "layersbtn",
              "phone: maps, Escape closes the sheet and the focus returns to Layers")


def live(folder: Path) -> int:
    """--live: the tab for every city against the public bucket, within the spec's budgets."""
    base, failures = "http://localhost:8000/", []

    def serve(route):
        """The site's own files as http://localhost:8000/..., the bucket's CORS origin, through Playwright's routing:
        the port itself stays free (another program may listen there). The COGs come from the bucket, so no ranges here."""
        path = ROOT / urlparse(route.request.url).path.lstrip("/")
        route.fulfill(path=path) if path.is_file() else route.fulfill(status=404)

    def check(cond, what):
        print(("ok   " if cond else "FAIL ") + what)
        if not cond:
            failures.append(what)

    def first_view(b, city, viewport, slow=False, warm=None):
        """(seconds until every heat tile of the view is drawn, {kind: bytes}, statuses, console errors) in a fresh context;
        `warm`: open that city first, so the libraries are cached as on a later visit; `slow`: Lighthouse Slow 4G."""
        ctx = b.new_context(viewport=viewport)
        ctx.route(f"{base}**", serve)
        pg = ctx.new_page()
        if warm:
            pg.goto(f"{base}maps.html?city={warm}")
            pg.wait_for_function(LOADED, timeout=60000)
        got, errors = [], []
        pg.on("response", lambda r: got.append(r) if "storage.googleapis.com" in r.url else None)
        pg.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
        if slow:
            cdp = ctx.new_cdp_session(pg)
            cdp.send("Network.enable")
            cdp.send("Network.emulateNetworkConditions", {"offline": False, "latency": 150,
                                                          "downloadThroughput": 1.6e6 / 8, "uploadThroughput": 750e3 / 8})
        t0 = time.monotonic()
        pg.goto(f"{base}maps.html?city={city}")
        pg.wait_for_function(LOADED, timeout=60000)
        seconds = time.monotonic() - t0
        pg.wait_for_load_state("networkidle")
        size = {"heat": 0, "relief": 0, "values": 0, "manifest": 0, "all": 0}
        for r in got:
            name, n = r.url.split("/")[-1], int(r.headers.get("content-length", 0))   # bodies of done responses can be gone
            kind = "relief" if name.startswith("relief.") else "values" if name.startswith("values") else "heat" if name.endswith(".tif") else "manifest"
            size[kind] += n
            size["all"] += n
        statuses = {r.status for r in got}
        if pg.is_visible("#maperr"):
            errors.append("#maperr visible: a layer stayed blank")
        ctx.close()
        return seconds, size, statuses, errors

    with sync_playwright() as p:
        b = p.chromium.launch()
        for i, city in enumerate(CITIES):
            with guard(check, city, b):
                other = CITIES[(i + 1) % len(CITIES)]
                s, size, statuses, errors = first_view(b, city, {"width": 1280, "height": 800})
                check(statuses <= {200, 206} and not errors, f"{city}: live, only 200 and 206, no console or CORS errors {statuses} {errors}")
                check(size["all"] <= 1.5e6 and size["heat"] <= 1.2e6 and size["relief"] <= 300e3 and s <= 1.0,
                      f"{city}: live desktop first view, {size} bytes, drawn in {s:.1f} s (budget 1.5 MB, heat 1.2 MB, relief 300 kB, 1 s)")
                s, size, _, _ = first_view(b, city, {"width": 1280, "height": 800}, slow=True, warm=other)
                check(s <= 11, f"{city}: live desktop on Slow 4G, drawn in {s:.1f} s (budget 11 s)")
                s, size, _, _ = first_view(b, city, {"width": 390, "height": 844}, slow=True, warm=other)
                kb = 150e3 if city == "lima" else float("inf")    # the spec's zoom 10 case; the smaller cities open at zoom 12
                check(size["all"] <= kb and s <= 4, f"{city}: live phone on Slow 4G, {size['all'] / 1e3:.0f} kB, drawn in {s:.1f} s "
                      f"(budget {'150 kB, ' if city == 'lima' else ''}4 s)")
                exp = json.loads((folder / city / "expect.json").read_text())
                pg = b.new_page(viewport={"width": 1280, "height": 800})
                pg.route(f"{base}**", serve)
                pg.goto(f"{base}maps.html?city={city}&at={exp['lat']},{exp['lon']}")
                pg.wait_for_selector("#card .rsub", timeout=30000)
                first = next(iter(exp["values"]))
                miss = missing_numbers(pg.inner_text("#card"), exp["values"][first])
                check(not miss, f"{city}: live, the readout at {exp['lat']}, {exp['lon']} equals --publish's numbers {miss}")
                man = json.loads((folder / city / "manifest.json").read_text())
                common = max((l for l in man["layers"] if l["id"].startswith("type")), key=lambda l: l["share"])["id"]
                pg.locator(f"#rail input[value={common}]").check()   # a rare type may have no cell in this view
                pg.wait_for_function(LOADED, timeout=30000)
                pg.wait_for_function(DRAWN, timeout=30000)
                check(not pg.is_visible("#maperr"), f"{city}: live, a type layer draws and #maperr stays hidden")
        b.close()
    print(f"\n{len(failures)} failure(s)")
    return 1 if failures else 0


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
        for city in CITIES:
            pg, errors = page(b)
            pg.goto(f"{base}alert.html?city={city}&data=fixtures/")
            pg.wait_for_selector("#days button", timeout=5000)
            check(pg.locator("#days button").count() == 7, f"{city}: alert page, seven day buttons")
            check(pg.locator("#track svg").count() == 1, f"{city}: alert page, track")
            check(pg.locator("#ladder .step").count() >= 2, f"{city}: alert page, rule list")
            check(pg.title() == f"How the alert is decided · {city.capitalize()}", f"{city}: alert page title")
            pg.locator("#days button").nth(3).click()
            check(pg.get_attribute("#days button >> nth=3", "aria-pressed") == "true", f"{city}: alert page, a click selects the day")
            check(not errors, f"{city}: alert page, no console errors {errors}")
        pg, _ = page(b)
        pg.goto(f"{base}alert.html?city=kaolack&data=fixtures/")
        pg.wait_for_selector("#ladder .step", timeout=5000)
        check("in test" in pg.inner_text("#ladder"), "kaolack: the newer rules run in test")
        pg.goto(f"{base}alert.html?city=lima&data=fixtures/")
        pg.wait_for_selector("#ladder .step", timeout=5000)
        check("model families agree" in pg.inner_text("#ladder"), "lima: the families rule is listed")
        pg.goto(f"{base}index.html?city=lima&data=fixtures/")
        pg.wait_for_selector("#strip .day", timeout=5000)
        pg.locator("#strip .day").nth(2).click()
        href = pg.get_attribute("#detail .why a", "href") or ""
        check("alert.html" in href and "day=3" in href, f"forecast page links day 3 to the alert page {href}")
        pg.goto(base + href)
        pg.wait_for_selector("#days button", timeout=5000)
        check(pg.get_attribute("#days button >> nth=2", "aria-pressed") == "true", "the link opens day 3")
        pg.goto(f"{base}alert.html?city=lima&data=fixtures/edge/nodecision/")
        pg.wait_for_selector("#body .note", timeout=5000)
        check("not available" in pg.inner_text("#body"), "no rule steps: not available message")
        pg.goto(f"{base}index.html?city=lima&data=fixtures/edge/nodecision/")
        pg.wait_for_selector("#strip .day", timeout=5000)
        check(pg.locator("#detail .why").count() == 0, "no rule steps: no link on the forecast page")
        pg.goto(f"{base}alert.html?city=lima&data=fixtures/edge/baddecision/")
        pg.wait_for_selector(".error", timeout=5000)
        check("needs an update" in pg.inner_text(".error"), "bad rule steps: update message")
        pg.goto(f"{base}alert.html?city=lima&data=fixtures/edge/mismatch/")
        pg.wait_for_selector(".error", timeout=5000)
        check("needs an update" in pg.inner_text(".error"), "steps that end off the day's level: update message")
        pg, errors = page(b)
        pg.goto(f"{base}alert.html?city=lima&data=fixtures/edge/gap/")
        pg.wait_for_selector("#days button", timeout=5000)
        chip = pg.inner_text("#days .measured >> nth=0")
        squares = pg.locator('#track rect[width="14"]').count()
        check("no measurement" in chip and squares == 1 and not errors, f"a measurement gap: no level, no square, no errors {chip!r} {squares} {errors}")
        # Keyboard: the picked day keeps the focus, also after Previous and Next; the ends disable them.
        pg.goto(f"{base}alert.html?city=lima&data=fixtures/")
        pg.wait_for_selector("#days button", timeout=5000)
        focused = "document.activeElement.dataset.i"
        pg.locator("#days button").nth(3).focus()
        pg.keyboard.press("Enter")
        check(pg.evaluate(focused) == "3" and pg.get_attribute("#days button >> nth=3", "aria-pressed") == "true", "Enter on a day keeps the focus on it")
        pg.click("#next")
        check(pg.evaluate(focused) == "4", "Next moves the focus to the next day")
        pg.click("#prev")
        check(pg.evaluate(focused) == "3", "Previous moves the focus to the day before")
        check(pg.get_attribute("#sentence", "aria-live") == "polite", "the sentence is read out when it changes")
        pg.goto(f"{base}alert.html?city=lima&data=fixtures/&day=1")
        pg.wait_for_selector("#days button", timeout=5000)
        check(pg.is_disabled("#prev") and not pg.is_disabled("#next"), "day 1: Previous disabled")
        pg.goto(f"{base}alert.html?city=lima&data=fixtures/&day=7")
        pg.wait_for_selector("#days button", timeout=5000)
        check(pg.is_disabled("#next") and not pg.is_disabled("#prev"), "day 7: Next disabled")
        # Rule texts: no value printed as null, No warning names the first level, an unknown day before, the plain copy.
        pg, errors = page(b)
        pg.goto(f"{base}alert.html?city=lima&data=fixtures/edge/rules/&day=1")
        pg.wait_for_selector("#ladder .step", timeout=5000)
        lad, sen = pg.inner_text("#ladder"), pg.inner_text("#sentence")
        check("20% now reach Caution" in lad, "persistence at No warning: the share at Caution")
        check("needs a warm following night." in lad and "null" not in lad and "NaN" not in lad, "night rule without a value: no value printed")
        check("The forecasts say No warning. ▲7 The country team sets it to Caution" in sen, f"unknown day before: the sentence opens with the forecasts {sen!r}")
        check(pg.is_hidden("#mail"), "no mail block: the mail box is hidden")
        pg.goto(f"{base}alert.html?city=lima&data=fixtures/edge/rules/&day=2")
        pg.wait_for_selector("#ladder .step", timeout=5000)
        lad, sen = pg.inner_text("#ladder"), pg.inner_text("#sentence")
        check("at 30% on their own" in lad and "comes down to Caution" in lad and "comes down to Caution" in sen, "families rule: the share and comes down to")
        pg.goto(f"{base}alert.html?city=lima&data=fixtures/edge/rules/&day=5")
        pg.wait_for_selector("#ladder .step", timeout=5000)
        check("also had this day at Danger or higher" in pg.inner_text("#ladder"), "two runs agree: Danger or higher")
        check(not errors, f"rule texts: no console errors {errors}")
        heat_maps(b, base, check)
        m = b.new_page(viewport={"width": 390, "height": 844})
        m.goto(f"{base}alert.html?city=khulna&data=fixtures/")
        m.wait_for_selector("#days button", timeout=5000)
        check(m.evaluate("document.documentElement.scrollWidth") == 390, "alert page fits a phone")
        # A phone opening day 7: the chip and the track column scroll into view sideways, the page stays put.
        m.goto(f"{base}alert.html?city=lima&data=fixtures/&day=7")
        m.wait_for_selector("#days button", timeout=5000)
        r = m.evaluate("""() => { const q = s => document.querySelector(s), box = s => q(s).getBoundingClientRect(), inside = (a, o) => a.left >= o.left - 1 && a.right <= o.right + 1;
            return { w: document.documentElement.scrollWidth, y: scrollY, ds: q('#days').scrollLeft, ts: q('#track').scrollLeft,
                     day: inside(box('#days button[data-i="6"]'), box('#days')), col: inside(box('#track .hit[data-i="6"]'), box('#track')) }; }""")
        check(r["w"] == 390 and r["y"] == 0, f"lima day 7 fits a phone, no vertical scroll {r}")
        check(r["ds"] > 0 and r["day"] and r["ts"] > 0 and r["col"], f"lima day 7 on a phone: chip and track column in view {r}")
        b.close()
    srv.shutdown()
    print(f"\n{len(failures)} failure(s)")
    return 1 if failures else 0


if __name__ == "__main__":
    if sys.argv[1:2] == ["--serve"]:         # the site with range requests on http://localhost:8000 (the heat maps need them)
        http.server.ThreadingHTTPServer(("127.0.0.1", 8000), Quiet).serve_forever()
    sys.exit(live(Path(sys.argv[2])) if sys.argv[1:2] == ["--live"] else main())
