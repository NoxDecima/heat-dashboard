// Shared plumbing for every page: language strings, data loading with a schema check, escaping,
// number and date formatting, header and footer. Every string from the data file goes through esc().
import { CITIES, CONTACT, DATA_BASE, MAPS_BASE } from "./config.js";
export { CITIES, CONTACT };

export const SCHEMA = 1;
export const ORDER = ["green", "yellow", "orange", "red", "purple"];
export const rank = l => ORDER.indexOf(l);
export const LANGS = ["en"];                       // add "es" with i18n/es.json (DL-9)
const LOCALE = { en: "en-GB", es: "es-PE" };       // date and number formats per language

const params = new URLSearchParams(location.search);
const LOCAL = ["localhost", "127.0.0.1"].includes(location.hostname);   // ?data=, ?now=, ?webp= and ?at= work on a local server only
export const param = k => (LOCAL || !["data", "now", "webp", "at"].includes(k) ? params.get(k) : null);
const store = {
  get: k => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* storage blocked: the choice lasts one page */ } },
};
const lang = [param("lang"), store.get("lang"), "en"].find(l => LANGS.includes(l));
store.set("lang", lang);
const locale = LOCALE[lang] || lang;
let STR = {};

export const t = (key, vars = {}) => (STR[key] ?? esc(key)).replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? "");
export const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
export const safeUrl = u => (/^https:\/\//.test(u || "") ? esc(u) : "#");
export const tip = (key, vars) => { const s = esc(t(key, vars)); return `<button type="button" class="tip" data-tip="${s}" aria-label="${s}">i</button>`; };

// Numbers and dates in the page language. Dates in the data are calendar dates (YYYY-MM-DD).
export const num = (x, d = 0) => new Intl.NumberFormat(locale, { minimumFractionDigits: d, maximumFractionDigits: d }).format(x);
export const deg = (x, d = 0) => `${num(x, d)}°`;
export const day = (iso, o) => new Intl.DateTimeFormat(locale, { timeZone: "UTC", ...o }).format(new Date(`${iso}T12:00:00Z`));
export const time = (d, timeZone) => new Intl.DateTimeFormat(locale, { timeZone, weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(d);
export const addDays = (iso, n) => new Date(Date.parse(`${iso}T12:00:00Z`) + n * 864e5).toISOString().slice(0, 10);
export const now = () => (param("now") ? new Date(param("now")) : new Date());   // ?now= for the smoke test
export const level = l => esc(t(`level.${l}`));
export const badge = l => `<span class="badge b-${esc(l)}">${level(l)}</span>`;

// Today and Tomorrow from the viewer's clock in the city, not from the file's lead: a file read late in the day is a day behind.
export const dayNamer = timeZone => {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone }).format(now());
  const ahead = d => Math.round((Date.parse(d.date) - Date.parse(today)) / 864e5);
  const dayName = d => (ahead(d) === 0 ? t("day.today") : ahead(d) === 1 ? t("day.tomorrow") : day(d.date, { weekday: "long" }));
  return { today, ahead, dayName, shortName: d => (ahead(d) === 0 || ahead(d) === 1 ? dayName(d) : day(d.date, { weekday: "short", day: "numeric" })) };
};

// What the forecasts say for a day at d.level: the share at that level (No warning: at the first level) and at the next.
export const forecastLead = (d, shares, rule) => {
  const lv = rule.levels, l = d.level === "green" ? lv[0] : d.level, next = lv[lv.indexOf(l) + 1], th = q => d.thresholds[q] || {};
  const pct = x => num((shares[x] ?? 0) * 100);
  const cond = rule.quantities[0] === "hi" ? t("detail.cond.hi", { v: deg(th("hi")[l]) })
    : t("detail.cond.dn", { day: deg(th("tmax")[l], 1), night: deg(th("tmin")[l], 1) });
  const v = { pct: pct(l), level: level(l), cond, share: num(rule.share * 100) };
  return d.level === "green" ? t(v.pct === "0" ? "detail.lead.zero" : "detail.lead.none", v)
    : t("detail.lead.level", v) + (next ? ` ${t("detail.lead.next", { pct: pct(next), level: level(next) })}` : "");
};

// ?data= may point at a local fixtures folder (development, smoke test), nothing else; the heat maps
// then come from its heatmaps/ folder.
const fixtures = /^fixtures\/[\w/]*$/.test(param("data") || "") ? param("data") : null;
export const dataUrl = city => `${fixtures || DATA_BASE}${city}.json`;
export const mapsBase = city => `${fixtures ? `${fixtures}heatmaps/` : MAPS_BASE}${city}/`;
export const query = city => {
  const q = new URLSearchParams();
  if (city) q.set("city", city);
  for (const k of ["lang", "data", "now", "webp"]) if (param(k)) q.set(k, param(k));
  const s = q.toString();
  return s ? `?${s}` : "";
};
const langHref = l => { const q = new URLSearchParams(location.search); q.set("lang", l); return `?${q}`; };

async function loadStrings() {
  const r = await fetch(`i18n/${lang}.json`);
  if (!r.ok) throw new Error(String(r.status));
  STR = await r.json();
  document.documentElement.lang = lang;
  document.querySelectorAll("[data-i18n]").forEach(el => { el.innerHTML = t(el.dataset.i18n); });
  document.querySelectorAll("[data-tip-key]").forEach(el => { el.dataset.tip = t(el.dataset.tipKey); el.setAttribute("aria-label", el.dataset.tip); });
}

// Every level and quantity name ends up in class names and lookups: only known values pass.
const QS = ["hi", "tmax", "tmin"];
// The rule steps of "How the alert is decided": rule names and levels from fixed lists, numbers as numbers, dates as dates.
const RULES = ["forecasts", "persist", "early", "night", "families", "agree", "dip", "override"];
const ISO = s => /^\d{4}-\d{2}-\d{2}$/.test(s);
const validDecision = (dec, days) => {
  if (dec == null) return true;
  const lv = l => ORDER.includes(l), opt = l => l == null || lv(l), n = v => v == null || typeof v === "number";
  return ["machine", "bands"].includes(dec.chain) && opt(dec.start) && (dec.measured || []).every(m => ISO(m.date) && opt(m.level))
    && dec.days.length === days.length && dec.days.every((d, i) => d.steps.length > 0 && d.steps.every(s =>
      RULES.includes(s.rule) && lv(s.level) && typeof s.applies === "boolean"
      && ["moved", "unknown", "night_p50", "days", "needed"].every(k => n(s[k]))
      && Object.values(s.shares || {}).every(x => typeof x === "number")
      && opt(s.prev) && opt(s.yesterday) && opt(s.tomorrow) && opt(s.tier)
      && (!s.night_rule || (["absolute", "percentile"].includes(s.night_rule.kind) && n(s.night_rule.value) && n(s.night_rule.p))))
      && d.date === days[i].date && d.steps.at(-1).level === days[i].level)   // the steps end at the level the day shows
    && (!dec.mail || (lv(dec.mail.top) && opt(dec.mail.prev_top) && [null, "raised", "changed", "ended"].includes(dec.mail.kind)));
};

const valid = doc => {
  const lv = l => ORDER.includes(l), sub = (a, b) => a.every(x => b.includes(x));
  try {
    const { rule: r, days, yesterday: y, history } = doc;
    return r.levels.every(lv) && lv(r.alert_min_level) && sub(r.quantities, QS) && days.every(d => lv(d.level))
      && (!y || (lv(y.level) && lv(y.observed.level) && sub(Object.keys(y.forecast), QS)))
      && history.every(h => lv(h.obs.level) && Object.values(h.f).every(f => lv(f[0])))
      && validDecision(doc.decision, days);
  } catch { return false; }                        // a missing block is a schema problem too
};

async function loadCity(city) {
  let doc;
  try {
    const r = await fetch(dataUrl(city), { cache: "no-cache" });
    if (!r.ok) throw new Error(String(r.status));
    doc = await r.json();
  } catch {
    throw new Error(t("error.load"));
  }
  if (doc?.schema !== SCHEMA || !valid(doc)) throw new Error(t("error.schema"));
  return doc;
}

function header(city) {
  const page = location.pathname.split("/").pop().replace(".html", "") || "index";
  const nav = [["index", "nav.forecast"], ["history", "nav.history"], ["alert", "nav.alert"], ["maps", "nav.maps"], ["docs", "nav.docs"]]
    .map(([p, k]) => `<a href="${p}.html${query(city)}" class="${p === page ? "on" : ""}">${t(k)}</a>`).join("");
  const opts = (city ? "" : `<option value="">${t("nav.choose")}</option>`) + Object.keys(CITIES)
    .map(c => `<option value="${c}"${c === city ? " selected" : ""}>${t(`city.${c}.name`)}</option>`).join("");
  const langs = LANGS.map(l => (l === lang ? `<b>${l.toUpperCase()}</b>` : `<a href="${langHref(l)}">${l.toUpperCase()}</a>`)).join(" · ");
  document.querySelector("header.top").innerHTML = `<div class="in">
    <img class="logo" src="assets/meteory-logo.svg" alt="Meteory"><nav class="nav">${nav}</nav>
    <div class="tools"><select id="city" aria-label="${t("nav.city")}">${opts}</select><span class="lang">${langs}</span></div></div>`;
  document.getElementById("city").addEventListener("change", e => { location.search = query(e.target.value); });
  // On a phone the tab row scrolls sideways (style.css): bring the current tab to the middle.
  const row = document.querySelector(".nav"), on = row.querySelector(".on");
  if (on) row.scrollLeft += on.getBoundingClientRect().left - row.getBoundingClientRect().left - (row.clientWidth - on.offsetWidth) / 2;
}

export function footer(city) {
  const agency = city ? CITIES[city].agency : t("footer.agency.any");
  const data = city ? `<a href="${dataUrl(city)}">${t("footer.data", { file: `${city}.json` })}</a>` : "";
  document.querySelector("footer").innerHTML = `<div class="in"><p>${t("footer.text", { agency })}</p>
    <div class="links"><a href="docs.html${query(city)}">${t("nav.docs")}</a>${data}</div></div>`;
}

export function picker() {
  document.querySelector("main").innerHTML = `<section class="intro"><h1>${t("picker.title")}</h1><div class="sub">${t("picker.sub")}</div></section>
    <nav class="picker">${Object.keys(CITIES).map(c => `<a class="panel" href="${query(c)}">${t(`city.${c}.place`)}</a>`).join("")}</nav>`;
  footer(null);
}

export function showError(msg) {
  document.querySelector("main").innerHTML = `<p class="panel error">${esc(msg)}</p>`;
}

// Page start: strings, header, then render(city, doc). A page without data passes needsData = false.
export async function start(render, needsData = true) {
  try {
    await loadStrings();
  } catch {
    return showError("The page could not be loaded. Please try again later.");   // no strings file, so no translation
  }
  const city = CITIES[param("city")] ? param("city") : null;
  header(city);
  if (!needsData) return render(city);
  if (!city) return picker();
  let doc;
  try {
    doc = await loadCity(city);
  } catch (e) {
    footer(city);
    return showError(e.message);
  }
  try {
    render(city, doc);
  } catch (e) {
    console.error(e);
    showError(t("error.schema"));
  }
}
