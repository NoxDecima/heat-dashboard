// Shared plumbing for every page: language strings, data loading with a schema check, escaping,
// number and date formatting, header and footer. Every string from the data file goes through esc().
import { CITIES, CONTACT, DATA_BASE } from "./config.js";
export { CITIES, CONTACT };

export const SCHEMA = 1;
export const ORDER = ["green", "yellow", "orange", "red", "purple"];
export const rank = l => ORDER.indexOf(l);
export const LANGS = ["en"];                       // add "es" with i18n/es.json (DL-9)
const LOCALE = { en: "en-GB", es: "es-PE" };       // date and number formats per language

const params = new URLSearchParams(location.search);
const LOCAL = ["localhost", "127.0.0.1"].includes(location.hostname);   // ?data= and ?now= work on a local server only
export const param = k => (LOCAL || !["data", "now"].includes(k) ? params.get(k) : null);
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

// ?data= may point at a local fixtures folder (development, smoke test), nothing else.
const base = /^fixtures\/[\w/]*$/.test(param("data") || "") ? param("data") : DATA_BASE;
export const dataUrl = city => `${base}${city}.json`;
export const query = city => {
  const q = new URLSearchParams();
  if (city) q.set("city", city);
  for (const k of ["lang", "data", "now"]) if (param(k)) q.set(k, param(k));
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
const valid = doc => {
  const lv = l => ORDER.includes(l), sub = (a, b) => a.every(x => b.includes(x));
  try {
    const { rule: r, days, yesterday: y, history } = doc;
    return r.levels.every(lv) && lv(r.alert_min_level) && sub(r.quantities, QS) && days.every(d => lv(d.level))
      && (!y || (lv(y.level) && lv(y.observed.level) && sub(Object.keys(y.forecast), QS)))
      && history.every(h => lv(h.obs.level) && Object.values(h.f).every(f => lv(f[0])));
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
  const nav = [["index", "nav.forecast"], ["history", "nav.history"], ["docs", "nav.docs"]]
    .map(([p, k]) => `<a href="${p}.html${query(city)}" class="${p === page ? "on" : ""}">${t(k)}</a>`).join("");
  const opts = (city ? "" : `<option value="">${t("nav.choose")}</option>`) + Object.keys(CITIES)
    .map(c => `<option value="${c}"${c === city ? " selected" : ""}>${t(`city.${c}.name`)}</option>`).join("");
  const langs = LANGS.map(l => (l === lang ? `<b>${l.toUpperCase()}</b>` : `<a href="${langHref(l)}">${l.toUpperCase()}</a>`)).join(" · ");
  document.querySelector("header.top").innerHTML = `<div class="in">
    <img class="logo" src="assets/meteory-logo.svg" alt="Meteory"><nav class="nav">${nav}</nav>
    <div class="tools"><select id="city" aria-label="${t("nav.city")}">${opts}</select><span class="lang">${langs}</span></div></div>`;
  document.getElementById("city").addEventListener("change", e => { location.search = query(e.target.value); });
}

export function footer(city) {
  const agency = city ? CITIES[city].agency : t("footer.agency.any");
  const data = city ? `<a href="${dataUrl(city)}">${t("footer.data", { file: `${city}.json` })}</a>` : "";
  document.querySelector("footer").innerHTML = `<div class="in"><p>${t("footer.text", { agency })}</p>
    <div class="links"><a href="docs.html${query(city)}">${t("nav.docs")}</a>${data}</div></div>`;
}

function picker() {
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
