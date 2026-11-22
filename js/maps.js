// Heat maps (EWS D-46): the PR-1 surface heat maps of a city over a light relief or satellite imagery.
// Every layer is a Cloud Optimized GeoTIFF on the public bucket, read with range requests by geotiff.js
// (the global GeoTIFF) and drawn by CogLayer below; a tap reads one pixel of the season's values file.
// The city's words come from its manifest and go through esc(). Spec: EWS
// docs/superpowers/specs/2026-11-21-heat-maps-tab-design.md; look: its Direction 4 mock-up.
import { t, esc, num, param, start, footer, showError, picker, mapsBase } from "./app.js";

const $ = s => document.querySelector(s);
const HALF = 20037508.342789244;                 // half the Web Mercator world, in metres
const OPACITY = 0.85;                            // the heat layer over either base map
const INK = "#142943", RIVER = "#7d9bb5", PIN = "#ffd400";
const TYPE = ["rgb(230,0,126)", "rgb(247,160,206)"];   // flat ground, slopes: EWS surface_heat_maps.TYPE_FLAT, TYPE_SLOPE
const ESRI = "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";
const WEBP = "UklGRhwAAABXRUJQVlA4TA8AAAAvAAAAEAcQ/Y8CBiKi/wEA";   // 1 x 1, lossless, with alpha
const phone = matchMedia("(max-width: 820px)");
let M, X, city, season, current = null, map, heat = null, outline, pinned = null;
const layers = {}, values = {};

// --- the manifest: checked like the city files, before anything is drawn ---
const KINDS = ["day", "relative", "night", "type"];
const BANDS = ["day_median", "day_count", "day_p25", "day_p75", "relative", "night_median", "night_count", "code", "dem", "inside"];
const FILE = /^[\w.-]+\.tif$/, HEX = /^#[0-9a-f]{6}$/i, KEY = /^\w+$/;
const isNum = v => typeof v === "number" && Number.isFinite(v);
const box = b => b.length === 2 && b.every(p => p.length === 2 && p.every(isNum));
const words = x => typeof x.title === "string" && [x.read, x.sure, x.details].every(Array.isArray) && x.details.every(d => d.length === 2);
const valid = (m, c) => {
  try {
    const keys = m.seasons.map(s => s.key);
    return m.schema === 1 && m.city === c && box(m.bounds) && box(m.home) && box(m.relief.bounds)
      && FILE.test(m.relief.file) && HEX.test(m.relief.flat) && typeof m.has_bands === "boolean"
      && (m.steep_deg === null || isNum(m.steep_deg)) && (m.steep_code === null || isNum(m.steep_code))
      && keys.length > 0 && m.seasons.every(s => KEY.test(s.key) && FILE.test(s.values) && isNum(s.min_scenes)
        && s.bands.length === s.scale.length && s.bands.every(b => BANDS.includes(b)) && s.scale.every(isNum)
        && ["day_median", "code", "inside"].every(b => s.bands.includes(b))
        && (s.anchor === null || ["n", "median", "p10", "p90"].every(k => isNum(s.anchor[k]))))
      && m.layers.length > 0 && m.layers.every(l => KEY.test(l.id) && KINDS.includes(l.kind) && FILE.test(l.file) && FILE.test(l.fallback)
        && (l.kind === "type"
          ? isNum(l.code) && isNum(l.share) && (l.check === null || (l.check.length === 2 && l.check.every(isNum)))
          : keys.includes(l.season) && isNum(l.legend.lo) && isNum(l.legend.hi) && l.legend.hi > l.legend.lo
            && l.legend.colours.length === 11 && l.legend.colours.every(x => HEX.test(x))
            && ["diverging", "under", "over"].every(k => typeof l.legend[k] === "boolean")))
      && ["Polygon", "MultiPolygon"].includes(m.outline.type) && m.river.type === "MultiLineString"
      && (m.station === null || (typeof m.station.name === "string" && isNum(m.station.lat) && isNum(m.station.lon)))
      && m.checks.every(k => isNum(k.id) && isNum(k.lat) && isNum(k.lon) && isNum(k.type) && typeof k.agrees === "boolean")
      && m.layers.every(l => words(m.texts.en.layers[l.id]));
  } catch { return false; }                      // a missing block is a schema problem too
};

async function load() {
  let m;
  try {
    const r = await fetch(`${mapsBase(city)}manifest.json`, { cache: "no-cache" });
    if (!r.ok) throw new Error(String(r.status));
    m = await r.json();
  } catch {
    throw new Error(t("maps.error.load"));
  }
  if (!valid(m, city)) throw new Error(t("maps.error.schema"));
  return m;
}

// Display layers come as WebP; a browser that cannot decode a lossless WebP with alpha the way
// geotiff.js does (createImageBitmap) reads the deflate copies. ?webp=0 forces them on a local server.
const webpOk = () => (param("webp") === "0" || typeof createImageBitmap !== "function" ? Promise.resolve(false)
  : createImageBitmap(new Blob([Uint8Array.from(atob(WEBP), ch => ch.charCodeAt(0))], { type: "image/webp" })).then(() => true, () => false));

// --- CogLayer: one geotiff.js reader per file (one header read, one block cache for all its tiles);
// each tile reads the source pixels it covers from the coarsest image still as fine as the screen and
// draws them at their exact place. `smooth`: the relief, one grey band, drawn smoothed with one source
// pixel beyond each edge so tiles meet without seams; it may come from an image up to twice as coarse
// as the screen and is read in 16 kB blocks, which keeps a phone's first view within its budget.
// Else RGBA, pixelated. ---
const CogLayer = L.GridLayer.extend({
  initialize(url, options) {
    L.setOptions(this, options);
    this._images = GeoTIFF.fromUrl(url, { blockSize: this.options.smooth ? 16384 : 65536 }).then(async tiff => {
      const first = await tiff.getImage(0), [ox, oy] = first.getOrigin(), out = [];
      for (let i = 0; i < await tiff.getImageCount(); i++) {
        const image = await tiff.getImage(i);
        out.push({ image, res: image.getResolution(first)[0], ox, oy, w: image.getWidth(), h: image.getHeight() });
      }
      return out.sort((a, b) => a.res - b.res);
    });
    this._images.catch(() => {});                // each tile reports the failure (tileerror)
  },
  createTile(c, done) {
    const tile = document.createElement("canvas");
    tile.width = tile.height = 256;
    this._images.then(imgs => this._draw(tile, c, imgs)).then(() => done(null, tile), e => done(e, tile));
    return tile;
  },
  async _draw(tile, c, imgs) {
    const size = 2 * HALF / 2 ** c.z, x0 = -HALF + c.x * size, y1 = HALF - c.y * size;
    const img = imgs.filter(i => i.res <= (this.options.smooth ? 2 : 1) * size / 256).pop() || imgs[0];
    const f = size / img.res, fx = (x0 - img.ox) / img.res, fy = (img.oy - y1) / img.res;   // the tile in image pixels
    const pad = this.options.smooth ? 1 : 0;
    const c0 = Math.max(0, Math.floor(fx) - pad), r0 = Math.max(0, Math.floor(fy) - pad);
    const c1 = Math.min(img.w, Math.ceil(fx + f) + pad), r1 = Math.min(img.h, Math.ceil(fy + f) + pad);
    if (c1 <= c0 || r1 <= r0) return;
    const px = await img.image.readRasters({ window: [c0, r0, c1, r1], interleave: true });
    const w = c1 - c0, h = r1 - r0, rgba = new Uint8ClampedArray(w * h * 4);
    if (this.options.smooth) for (let i = 0; i < w * h; i++) rgba.set([px[i], px[i], px[i], 255], 4 * i);
    else rgba.set(px);
    const src = document.createElement("canvas");
    src.width = w; src.height = h;
    src.getContext("2d").putImageData(new ImageData(rgba, w, h), 0, 0);
    const ctx = tile.getContext("2d"), k = 256 / f;
    ctx.imageSmoothingEnabled = !!this.options.smooth;
    ctx.drawImage(src, (c0 - fx) * k, (r0 - fy) * k, w * k, h * k);
  },
});
const cog = (file, options) => new CogLayer(mapsBase(city) + file, options).on("tileerror", () => { $("#maperr").hidden = false; });

// --- page start ---
start(async c => {
  city = c;
  if (!city) return picker();
  document.title = t("title.maps", { city: t(`city.${city}.name`) });
  $("#eyebrow").textContent = t("maps.eyebrow", { place: t(`city.${city}.place`) });
  footer(city);
  try {
    M = await load();
  } catch (e) {
    return showError(e.message);
  }
  try {
    X = M.texts[document.documentElement.lang] || M.texts.en;
    season = M.seasons[0].key;
    const webp = await webpOk();
    $("#body").hidden = false;
    setup(webp);
  } catch (e) {
    console.error(e);
    showError(t("maps.error.schema"));
  }
}, false);

function setup(webp) {
  map = L.map("map", { zoomControl: false, maxZoom: 18, maxBounds: M.relief.bounds, maxBoundsViscosity: 1 });
  map.attributionControl.setPrefix(false);
  map.getContainer().style.background = M.relief.flat;       // where the relief ends, level ground reads the same
  map.createPane("heat").style.zIndex = 350;                 // over the base map, under the outlines (400)
  const home = L.latLngBounds(M.home);
  map.fitBounds(home);
  map.setMinZoom(map.getBoundsZoom(home) - 1);
  layers.relief = cog(M.relief.file, { smooth: true, attribution: t("maps.attr.relief") });
  layers.sat = L.tileLayer(ESRI, { maxNativeZoom: 18, maxZoom: 18, attribution: t("maps.attr.sat") });
  outline = L.geoJSON(M.outline, { style: { color: INK, weight: 2, fill: false }, interactive: false, attribution: esc(X.credit) });
  layers.lines = L.layerGroup([outline, L.geoJSON(M.river, { style: { color: RIVER, weight: 1.5 }, interactive: false })]).addTo(map);
  layers.station = M.station && L.circleMarker([M.station.lat, M.station.lon], { radius: 6, weight: 3, color: INK, fillColor: "#fff", fillOpacity: 1, interactive: false })
    .bindTooltip(esc(M.station.name), { permanent: true, direction: "auto", offset: [8, 0], className: "stn" }).addTo(map);
  layers.checks = L.layerGroup(M.checks.map(k => {
    const mark = t(k.agrees ? "maps.check.agrees" : "maps.check.differs");
    return L.marker([k.lat, k.lon], { title: t("maps.check.label", { id: k.id, mark }),
      icon: L.divIcon({ className: `chk ${k.agrees ? "ok" : "no"}`, html: k.agrees ? "✓" : "✗", iconSize: [18, 18] }) })
      .bindPopup(() => checkPopup(k, mark));
  }));
  for (const l of M.layers) l.file = webp ? l.file : l.fallback;
  $("#maperr").textContent = t("maps.error.layer");
  rail();
  setBase("relief");
  setLayer(byKind("relative"));
  controls(home);
  const at = (param("at") || "").split(",").map(Number);     // a local server only: open and read a point (live check)
  if (at.length === 2 && at.every(Number.isFinite)) { map.setView(at, 16); readout(L.latLng(at)); }
}

const byKind = k => M.layers.find(l => l.kind === k && l.season === season);
const typeName = code => X.types[code] ?? t("maps.read.other");
const share = x => (x > 0 && x < 0.005 ? t("maps.share.under") : `${num(x * 100)}%`);
const degC = (v, d = 0) => `${num(v, d)} °C`;

// --- the rail: fieldsets with native radios and checkboxes; day, relative, night and the types are one group ---
function rail() {
  const opt = (type, name, value, label, mt = "", checked = false) => `<label class="opt"><input type="${type}" name="${name}" value="${value}"${checked ? " checked" : ""}><span>${label}</span>${mt ? `<span class="mt">${mt}</span>` : ""}</label>`;
  const sel = current && (current.kind === "type" ? current.id : current.kind);
  const seg = M.seasons.length > 1 ? `<div class="seg season" role="group" aria-label="${t("maps.season")}">${M.seasons.map(s =>
    `<button type="button" data-season="${esc(s.key)}" aria-pressed="${s.key === season}">${esc(X.seasons[s.key].name)}</button>`).join("")}</div>` : "";
  const heatOpts = ["day", "relative", "night"].filter(byKind).map(k => opt("radio", "layer", k, t(`maps.layer.${k}`), k === "night" ? t("maps.layer.night.mt") : "", sel === k)).join("");
  const types = M.layers.filter(l => l.kind === "type").map(l => opt("radio", "layer", l.id, esc(typeName(l.code)),
    l.check ? t("maps.share.check", { share: share(l.share), a: num(l.check[0]), n: num(l.check[1]) }) : share(l.share), sel === l.id)).join("");
  const shown = what => what === "checks" ? map.hasLayer(layers.checks) : !!layers[what] && map.hasLayer(layers[what]);
  $("#railbody").innerHTML = `<fieldset><legend>${t("maps.group.heat")}</legend>${seg}${heatOpts}</fieldset>
    <fieldset><legend>${t("maps.group.types")}</legend><div class="hint">${t("maps.group.types.hint")}</div>${types}</fieldset>
    <fieldset><legend>${t("maps.group.show")}</legend>${opt("checkbox", "show", "checks", t("maps.show.checks"), "✓ ✗", shown("checks"))}
      ${M.station ? opt("checkbox", "show", "station", t("maps.show.station", { station: esc(M.station.name) }), "", shown("station")) : ""}
      ${opt("checkbox", "show", "lines", t("maps.show.lines"), "", shown("lines"))}</fieldset>
    <fieldset><legend>${t("maps.group.base")}</legend>${opt("radio", "base", "relief", t("maps.base.relief"), t("maps.base.relief.mt"), true)}
      ${opt("radio", "base", "sat", t("maps.base.sat"), t("maps.base.sat.mt"))}</fieldset>`;
  $("#railbody").onchange = e => {
    const i = e.target;
    if (i.name === "layer") setLayer(i.value.startsWith("type") ? M.layers.find(l => l.id === i.value) : byKind(i.value));
    else if (i.name === "base") setBase(i.value);
    else if (i.checked) layers[i.value].addTo(map);
    else map.removeLayer(layers[i.value]);
  };
  $("#railbody").onclick = e => { const b = e.target.closest("[data-season]"); if (b) setSeason(b.dataset.season); };
}

function setSeason(key) {
  const base = $("input[name=base]:checked").value;
  season = key;
  const kind = current && current.kind !== "type" ? current.kind : null;
  rail();
  $(`input[name=base][value=${base}]`).checked = true;
  if (kind) setLayer(byKind(kind) || byKind("day"));
  else setLayer(current);
  $(`[data-season="${key}"]`).focus();
  if (pinned) readout(pinned);
}

function setBase(b) {
  for (const k of ["relief", "sat"]) if (k === b) layers[k].addTo(map); else map.removeLayer(layers[k]);
  outline.setStyle({ color: b === "sat" ? "#fff" : INK });
  document.querySelectorAll("input[name=base]").forEach(r => { r.checked = r.value === b; });
}

// `l` null: the colours off (Show on satellite); picking any layer brings them back.
function setLayer(l) {
  current = l;
  if (heat) map.removeLayer(heat);
  heat = l && (layers[l.id] ||= cog(l.file, { pane: "heat", opacity: OPACITY }));
  if (heat) heat.addTo(map);
  $("#maperr").hidden = true;
  document.querySelectorAll("input[name=layer]").forEach(r => { r.checked = !!l && r.value === (l.kind === "type" ? l.id : l.kind); });
  $("#legend").hidden = !l;
  $("#layername").textContent = l ? (l.kind === "type" ? typeName(l.code) : t(`maps.btn.${l.kind}`)) : "";
  map.getContainer().setAttribute("aria-label", t("maps.map.label", { layer: l ? X.layers[l.id].title : t("maps.map.none") }));
  if (!l) return;
  $("#legend").innerHTML = legend(l);
  panels(l);
}

// --- legend and panels ---
const ticks = (lo, hi) => {       // round values, three to six of them
  const raw = (hi - lo) / 5, mag = 10 ** Math.floor(Math.log10(raw)), step = [1, 2, 5, 10].map(s => s * mag).find(s => s >= raw);
  const out = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) out.push(+v.toFixed(6));
  return out;
};

function legend(l) {
  const x = X.layers[l.id];
  if (l.kind === "type") {
    const key = M.steep_deg !== null
      ? `<span><i style="background:${TYPE[0]}"></i>${t("maps.legend.flat")}</span><span><i style="background:${TYPE[1]}"></i>${t("maps.legend.slope", { deg: num(M.steep_deg) })}</span>`
      : `<span><i style="background:${TYPE[0]}"></i>${t("maps.legend.type")}</span>`;
    return `<div class="lt">${esc(x.title)}</div><div class="tkey">${key}</div><div class="lm">${esc(x.note)}</div>`;
  }
  const g = l.legend, at = v => ((v - g.lo) / (g.hi - g.lo)) * 100;
  return `<div class="lt"><span class="desk">${t("maps.legend.unit", { title: esc(x.title) })}</span><span class="ph">${t(`maps.short.${l.kind}`)}</span></div>
    <div class="cbarrow">${g.under ? `<span class="arr lo" role="img" aria-label="${t("maps.legend.under")}">◀</span>` : ""}<div class="cbar" aria-hidden="true" style="background:linear-gradient(to right,${g.colours.join(",")})"></div>${g.over ? `<span class="arr hi" role="img" aria-label="${t("maps.legend.over")}">▶</span>` : ""}</div>
    <div class="ticks">${ticks(g.lo, g.hi).map(v => `<span style="left:${at(v)}%">${num(g.diverging ? Math.abs(v) : v)}</span>`).join("")}</div>
    ${g.diverging ? `<div class="ends"><span>${t("maps.legend.cooler")}</span><span>${t("maps.legend.warmer")}</span></div>` : ""}
    <div class="lm">${esc(x.note)}</div>`;
}

function panels(l) {
  const x = X.layers[l.id], many = M.seasons.length > 1 && l.kind !== "type";
  const title = x.title[0].toLowerCase() + x.title.slice(1) + (many ? `, ${X.seasons[l.season].long}` : "");
  const paras = ps => ps.map(p => `<p>${esc(p)}</p>`).join("");
  $("#explain").innerHTML = `<div class="xh"><h2 id="xh">${t("maps.about", { title: esc(title) })}</h2><span>${t("maps.about.note")}</span></div>
    <div class="panel"><h3>${t("maps.panel.read")}</h3>${paras(x.read)}</div>
    <div class="panel"><h3>${t("maps.panel.sure")}</h3>${paras(x.sure)}${x.box ? `<div class="caveat"><b>${t("maps.box.lead")}</b> ${esc(x.box)}</div>` : ""}</div>
    <div class="panel"><h3>${t("maps.panel.details")}</h3><dl class="about">${x.details.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join("")}</dl></div>
    <p class="credits">${X === M.texts.en && document.documentElement.lang !== "en" ? `${t("maps.english")} ` : ""}${esc(X.sources)} ${t("maps.dem")}</p>`;
}

// --- check points (choice 12: no imagery online, a button to the live satellite tiles instead) ---
function checkPopup(k, mark) {
  const seen = k.agrees ? typeName(k.type) : (X.seen[k.id] ?? "");
  return `<b>${t("maps.check.title", { id: k.id, mark })}</b><br>${t("maps.check.map", { type: esc(typeName(k.type)) })}<br>`
    + `${t("maps.check.seen", { seen: esc(seen) })}<br><button type="button" class="sat">${t("maps.check.sat")}</button>`;
}

function satellite(ll) {
  map.closePopup();
  setBase("sat");
  setLayer(null);
  map.setView(ll, 18);
}

// --- readout: one pixel of the season's values file ---
const pin = L.circleMarker([0, 0], { radius: 7, weight: 3, color: INK, fillColor: PIN, fillOpacity: 1, interactive: false });

async function pixel(s, ll) {
  values[s.key] ||= GeoTIFF.fromUrl(mapsBase(city) + s.values, { blockSize: 65536 }).then(f => f.getImage())
    .catch(e => { delete values[s.key]; throw e; });
  const img = await values[s.key], [ox, oy] = img.getOrigin(), [rx, ry] = img.getResolution();
  const p = L.CRS.EPSG3857.project(ll), col = Math.floor((p.x - ox) / rx), row = Math.floor((p.y - oy) / ry);
  if (col < 0 || row < 0 || col >= img.getWidth() || row >= img.getHeight()) return null;
  const px = await img.readRasters({ window: [col, row, col + 1, row + 1], interleave: true });
  return Object.fromEntries(s.bands.map((b, i) => [b, px[i] === -32768 ? null : px[i] / s.scale[i]]));
}

async function readout(ll) {
  pinned = ll;
  pin.setLatLng(ll).addTo(map);
  const s = M.seasons.find(x => x.key === season);
  let v;
  try {
    v = await pixel(s, ll);
  } catch {
    if (pinned === ll) card(`<p>${t("maps.read.fail")}</p>`);
    return;
  }
  if (pinned === ll) card(v ? describe(s, v) : `<p>${t("maps.read.beyond")}</p>`);   // a later tap wins
}

function describe(s, v) {
  const steep = M.steep_code !== null && v.code >= M.steep_code, out = [];
  let sub = steep ? t("maps.read.slope", { type: esc(typeName(v.code - M.steep_code)), deg: num(M.steep_deg) }) : esc(typeName(v.code));
  if (M.has_bands && v.dem !== null) sub = t("maps.read.height", { what: sub, height: num(v.dem) });
  if (v.inside !== 1) out.push(`<p class="note">${t("maps.read.outside", { area: esc(X.area) })}</p>`);
  const ref = t(M.has_bands ? "maps.read.ref.bands" : "maps.read.ref.flat");
  if (v.day_median === null) out.push(`<p>${t("maps.read.noday")}</p>`);
  else {
    if (v.relative === null) out.push(`<p>${t("maps.read.noref")}</p>`);
    else if (Math.abs(v.relative) < 1) out.push(`<p>${t("maps.read.same", { ref })}</p>`);
    else out.push(`<p>${t(v.relative > 0 ? "maps.read.warmer" : "maps.read.cooler", { v: degC(Math.abs(v.relative), 1), ref })}</p>`);
    const night = v.night_median != null ? ` ${t("maps.read.night", { night: degC(v.night_median) })}` : "";
    out.push(`<p>${t("maps.read.day", { morning: esc(X.seasons[s.key].morning), median: degC(v.day_median), p25: degC(v.day_p25), p75: degC(v.day_p75) })}${night}</p>`);
  }
  out.push(`<div class="caveat">${s.anchor && M.station
    ? `${t("maps.read.box", { station: esc(M.station.name), median: degC(s.anchor.median) })}${X.station_note ? ` ${esc(X.station_note)}` : ""}`
    : t("maps.read.box.none")}</div>`);
  const n = v.day_count ?? 0, few = n < s.min_scenes ? ` ${t("maps.read.few", { min: num(s.min_scenes) })}` : "";
  out.push(`<p class="note">${v.night_count != null ? t("maps.read.foot", { n: num(n), m: num(v.night_count) }) : t("maps.read.foot.day", { n: num(n) })}${few}</p>`);
  return `<div class="rsub">${sub}</div>${out.join("")}`;
}

function card(html) {
  $("#readout").innerHTML = `<div class="float readout4" id="card" role="region" aria-labelledby="rdh"><div class="rh"><h3 id="rdh">${t("maps.read.title")}</h3>`
    + `<button type="button" class="x" id="rdx" aria-label="${t("maps.read.close")}">×</button></div>${html}</div>`;
  $("#rdx").onclick = closeCard;
  place();
}

function closeCard() {
  pinned = null;
  map.removeLayer(pin);
  $("#readout").innerHTML = "";
}

function place() {                 // desktop: beside the pin; a phone: under the map (style.css)
  const c = $("#card");
  if (!c || !pinned || phone.matches) return;
  const p = map.latLngToContainerPoint(pinned), size = map.getSize(), w = c.offsetWidth, h = c.offsetHeight;
  c.style.left = `${Math.max(8, p.x + 20 + w < size.x ? p.x + 20 : p.x - 20 - w)}px`;
  c.style.top = `${Math.max(8, Math.min(p.y - h / 2, size.y - h - 8))}px`;
}

// --- controls, the rail on a phone, keyboard ---
function sheet(open) {
  document.body.classList.toggle("sheet", open);
  $("#layersbtn").setAttribute("aria-expanded", String(open));
  (open ? $("#rail input:checked") || $("#done") : $("#layersbtn")).focus();
}

function railShown(show) {         // desktop: « Hide gives the map the full width
  document.body.classList.toggle("railoff", !show);
  $("#hide").setAttribute("aria-expanded", String(show));
  $("#layersbtn").setAttribute("aria-expanded", String(show));
  map.invalidateSize();
  (show ? $("#hide") : $("#layersbtn")).focus();
}

function controls(home) {
  for (const [id, key, go] of [["zin", "maps.zoomin", () => map.zoomIn()], ["zout", "maps.zoomout", () => map.zoomOut()],
    ["zhome", "maps.home", () => map.fitBounds(home)]]) {
    $(`#${id}`).setAttribute("aria-label", t(key));
    $(`#${id}`).onclick = go;
  }
  $("#hide").setAttribute("aria-label", t("maps.hide.label"));
  $("#hide").onclick = () => railShown(false);
  $("#layersbtn").onclick = () => (phone.matches ? sheet(true) : railShown(true));
  $("#done").onclick = () => sheet(false);
  $("#backdrop").onclick = () => sheet(false);
  map.on("click", e => readout(e.latlng));
  map.on("move", place);
  map.on("popupopen", e => {
    const b = e.popup.getElement().querySelector(".sat");
    if (b) b.onclick = () => satellite(e.popup.getLatLng());
  });
  map.getContainer().addEventListener("keydown", e => {        // Enter reads the point under the crosshair
    if (e.key === "Enter" && e.target === map.getContainer()) readout(map.getCenter());
  });
  document.addEventListener("keydown", e => {
    if (e.key !== "Escape") return;
    if (document.body.classList.contains("sheet")) sheet(false);
    else if (pinned) closeCard();
  });
}
