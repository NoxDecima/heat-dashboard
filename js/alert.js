// How the alert is decided (D-43): today's run day by day, every rule that raised or lowered a
// day's level, and whether the run sends an alert mail. Spec: EWS
// docs/superpowers/specs/2026-11-20-alert-decision-page-design.md; look: its mock-up.
import { ORDER, rank, t, esc, num, deg, day, now, level, badge, start, footer, param } from "./app.js";

let D, DEC, city, TODAY, sel = 0, timer = null;
const $ = s => document.querySelector(s);
const COLOR = l => `var(--alert-${l})`;
const pct = x => num((x || 0) * 100);
const ahead = d => Math.round((Date.parse(d.date) - Date.parse(TODAY)) / 864e5);
const dayName = d => (ahead(d) === 0 ? t("day.today") : ahead(d) === 1 ? t("day.tomorrow") : day(d.date, { weekday: "long" }));
const shortName = d => (ahead(d) === 0 || ahead(d) === 1 ? dayName(d) : day(d.date, { weekday: "short", day: "numeric" }));
const up = s => rank(s.level) > rank(s.from);

start((c, doc) => {
  city = c; D = doc; DEC = doc.decision;
  TODAY = new Intl.DateTimeFormat("en-CA", { timeZone: D.timezone }).format(now());
  document.title = t("title.alert", { city: t(`city.${city}.name`) });
  $("#eyebrow").textContent = t("alert.eyebrow", { place: t(`city.${city}.place`) });
  footer(city);
  if (!DEC) { $("#body").innerHTML = `<p class="panel note">${t("alert.none")}</p>`; return; }
  $("#introtext").textContent = t(DEC.chain === "machine" ? "alert.intro.machine" : "alert.intro.bands");
  const n = Number(param("day"));
  sel = Number.isInteger(n) && n >= 1 && n <= D.days.length ? n - 1 : 0;
  $("#prev").onclick = () => { stop(); select(sel - 1); };
  $("#next").onclick = () => { stop(); select(sel + 1); };
  $("#play").onclick = play;
  render();
});

// A day's steps with what each changed: a step changes the level when it applies and differs from
// the step before it; step 1 compares with where the day before ended.
function steps(i) {
  const from0 = i === 0 ? DEC.start : D.days[i - 1].level;
  const st = DEC.days[i].steps.map((s, k) => ({ ...s, n: k + 1 }));
  st.forEach((s, k) => {
    s.from = k === 0 ? from0 : st[k - 1].level;
    s.changed = s.applies && s.from != null && s.level !== s.from;
  });
  return st;
}
const moves = i => steps(i).filter(s => s.changed);

function text(s, i) {
  const d = D.days[i], HI = D.rule.quantities[0] === "hi", thr = q => d.thresholds[q] || {};
  const danger = level("orange"), top = level("red");
  switch (s.rule) {
    case "forecasts": {
      const lv = D.rule.levels, l = s.level === "green" ? lv[0] : s.level, next = lv[lv.indexOf(l) + 1];
      const cond = x => (HI ? t("detail.cond.hi", { v: deg(thr("hi")[x]) })
        : t("detail.cond.dn", { day: deg(thr("tmax")[x], 1), night: deg(thr("tmin")[x], 1) }));
      const share = num(D.rule.share * 100), sh = s.shares || {};
      return s.level === "green" ? t(pct(sh[lv[0]]) === "0" ? "detail.lead.zero" : "detail.lead.none", { pct: pct(sh[lv[0]]), level: level(lv[0]), cond: cond(lv[0]), share })
        : t("detail.lead.level", { pct: pct(sh[l]), level: level(l), cond: cond(l), share })
          + (next ? ` ${t("detail.lead.next", { pct: pct(sh[next]), level: level(next) })}` : "");
    }
    case "persist":
      return s.moved ? t("rule.persist.moved", { n: num(s.moved), min: danger, days: num(s.days), pct: pct((s.shares || {})[s.level]), level: level(s.level) })
        : t("rule.persist.none", { min: danger, days: num(s.days) });
    case "early":
      return s.moved ? t("rule.early.moved", { n: num(s.moved) }) : t("rule.early.none");
    case "night": {
      const r = s.night_rule || {};
      let out = s.moved ? t(r.kind === "percentile" ? "rule.night.moved.pct" : "rule.night.moved.abs",
        { n: num(s.moved), to: danger, top, v: deg(r.value ?? 0, 1), p: num(100 - (r.p || 90)) }) : t("rule.night.none");
      if (s.moved && r.kind === "percentile" && r.value != null) out += ` ${t("rule.night.value", { v: deg(r.value, 1) })}`;
      if (s.moved && s.night_p50 != null) out += ` ${t("rule.night.near", { near: deg(s.night_p50) })}`;
      if (s.unknown) out += ` ${t("rule.night.unknown", { n: num(s.unknown) })}`;
      return out;
    }
    case "families":
      return s.changed ? t("rule.families.held", { level: level(s.from), n: num(s.needed), to: level(s.level) })
        : rank(s.level) >= rank(s.tier) ? t("rule.families.ok") : t("rule.families.below", { tier: level(s.tier) });
    case "agree":
      if (!s.applies) return t("rule.agree.off");
      if (s.changed) return t(s.prev ? "rule.agree.held" : "rule.agree.new", { min: danger, prev: s.prev ? level(s.prev) : "", to: level(s.level) });
      return rank(s.level) >= rank("orange") ? t("rule.agree.ok", { prev: level(s.prev) }) : t("rule.agree.below", { min: danger });
    case "dip":
      if (!s.applies) return t("rule.dip.off");
      return s.changed ? t("rule.dip.held", { yday: level(s.yesterday), from: level(s.from), tomorrow: level(s.tomorrow), to: level(s.level) })
        : t("rule.dip.none");
    case "override":
      return s.by ? t("rule.override.set", { by: esc(s.by), level: level(s.level), reason: esc(s.reason || "") }) : t("rule.override.none");
    default:
      return "";
  }
}

function sentence(i) {
  const d = D.days[i], mv = moves(i), first = steps(i)[0];
  const head = `<b>${dayName(d)}, ${day(d.date, { day: "numeric", month: "long" })}.</b> `;
  const start = first.from ? `${t("alert.s.start", { level: level(first.from) })} ` : "";
  if (!mv.length) return head + start + t("alert.s.nochange", { level: level(first.level) });
  const say = m => t(m.rule === "forecasts" ? (up(m) ? "alert.s.forecasts.up" : "alert.s.forecasts.down") : `alert.s.${m.rule}`, { level: level(m.level) });
  return head + start + mv.map(m => `<span class="mv">${up(m) ? "▲" : "▼"}${m.n}</span> ${say(m)}`).join(" ")
    + ` ${t("alert.s.end", { level: level(d.level) })}`;
}

function ladder(i) {
  const d = D.days[i];
  const rows = steps(i).map(s => `
    <div class="step${s.changed ? ` changed ${up(s) ? "up" : "down"}` : ""}${s.applies ? "" : " off"}">
      <span class="n">${s.n}</span>
      <div><h3>${t(`rule.${s.rule}`)}${s.changed ? `<span class="dir">${t(up(s) ? "alert.raises" : "alert.lowers")}</span>` : ""}</h3><p>${text(s, i)}</p></div>
      <span class="res">${s.changed ? `${badge(s.from)} →` : ""} ${badge(s.level)}</span>
    </div>`).join("");
  const test = DEC.rules_in_test ? `<div class="step off"><span class="n"></span><div><h3>${t("rule.test")}</h3><p>${t("rule.test.text")}</p></div><span class="res"></span></div>` : "";
  return `<div class="ladder">${rows}${test}
    <div class="step final"><span class="n">=</span><div><h3>${dayName(d)}, ${day(d.date, { day: "numeric", month: "long" })}</h3><p>${t("alert.final")}</p></div><span class="res">${badge(d.level)}</span></div></div>`;
}

// The week as one stepped path: a flat stretch keeps the level, every change is a vertical arrow
// with the rule's number. Columns widen with their changes; lanes cover only the levels in use.
function track() {
  const meas = DEC.measured || [], mvAll = D.days.map((d, i) => moves(i));
  const used = [DEC.start, ...meas.map(m => m.level), ...D.days.map(d => d.level), ...mvAll.flat().flatMap(m => [m.from, m.level])].filter(Boolean);
  const lo = Math.max(0, Math.min(...used.map(rank)) - 1), hi = Math.max(...used.map(rank));
  const lanes = ORDER.slice(lo, hi + 1), GAP = DEC.chain === "bands" ? 34 : 64, STEP = 40;
  const widths = meas.map(() => 64).concat(mvAll.map(mv => Math.max(88, 34 + STEP * mv.length)));
  const L = 96, Rm = 20, T = 34, B = 40, H = T + B + GAP * (lanes.length - 1), xs = [];
  let acc = L;
  widths.forEach(w => { xs.push(acc); acc += w; });
  const W = acc + Rm, X = c => xs[c], CW = c => widths[c], Y = l => T + (hi - rank(l)) * GAP;
  let s = `<defs><marker id="tip" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto"><path d="M0,0 L10,5 L0,10 z" fill="var(--blue-100)"/></marker></defs>`;
  lanes.forEach(l => {
    s += `<rect x="${L}" y="${Y(l) - 13}" width="${W - L - Rm}" height="26" fill="${COLOR(l)}" opacity=".1"/>`;
    s += `<text x="${L - 10}" y="${Y(l) + 4}" font-size="12" text-anchor="end" fill="var(--blue-60)">${level(l)}</text>`;
  });
  const sc = meas.length + sel;
  s += `<rect x="${X(sc) + 2}" y="${T - 26}" width="${CW(sc) - 4}" height="${H - T - B + 48}" rx="6" fill="var(--cream-100)" stroke="var(--cream-120)"/>`;
  meas.forEach((m, c) => {
    s += `<rect x="${X(c) + CW(c) / 2 - 7}" y="${Y(m.level) - 7}" width="14" height="14" rx="2" fill="${COLOR(m.level)}" stroke="var(--white)" stroke-width="2"/>`;
    s += `<text x="${X(c) + CW(c) / 2}" y="${H - B + 22}" font-size="11" text-anchor="middle" fill="var(--grey-100)">${day(m.date, { day: "numeric", month: "short" })}</text>`;
    s += `<text x="${X(c) + CW(c) / 2}" y="${H - B + 36}" font-size="10" text-anchor="middle" fill="var(--grey-100)">${t("alert.measured")}</text>`;
  });
  if (meas.length) s += `<line x1="${X(meas.length)}" x2="${X(meas.length)}" y1="${T - 22}" y2="${H - B + 6}" stroke="var(--grey-100)" stroke-dasharray="3 3"/><text x="${X(meas.length) + 5}" y="${T - 12}" font-size="10" fill="var(--grey-100)">${t("alert.forecast")}</text>`;
  let flat = "", arrows = "", marks = "", labels = "", hits = "";
  let px = X(meas.length) + 6, py = Y(DEC.start || steps(0)[0].level);
  D.days.forEach((d, i) => {
    const c = meas.length + i, mv = mvAll[i], on = i === sel;
    mv.forEach((m, k) => {
      const x = X(c) + 18 + STEP * k, y1 = Y(m.from), y2 = Y(m.level), by = (y1 + y2) / 2;
      flat += `M${px},${py} L${x},${py} `;
      arrows += `<line x1="${x}" y1="${y1}" x2="${x}" y2="${y2 + (up(m) ? 6 : -6)}" stroke="var(--blue-100)" stroke-width="${on ? 3 : 2.2}" marker-end="url(#tip)"/>`;
      marks += `<g><rect x="${x + 5}" y="${by - 9}" width="28" height="18" rx="9" fill="${on ? "var(--blue-100)" : "var(--white)"}" stroke="var(--blue-100)"/>`
        + `<text x="${x + 19}" y="${by + 4}" font-size="11" font-weight="600" text-anchor="middle" fill="${on ? "var(--white)" : "var(--blue-100)"}">${up(m) ? "▲" : "▼"}${m.n}</text>`
        + `<title>${m.n}. ${esc(t(`rule.${m.rule}`))}</title></g>`;
      px = x; py = y2;
    });
    const xe = X(c) + CW(c) - 14;
    flat += `M${px},${py} L${xe},${py} `;
    marks += `<circle cx="${xe}" cy="${py}" r="${on ? 8 : 6}" fill="${COLOR(d.level)}" stroke="var(--white)" stroke-width="2"/>`;
    px = xe;
    labels += `<text x="${X(c) + CW(c) / 2}" y="${H - B + 22}" font-size="11" text-anchor="middle" fill="var(--blue-100)" font-weight="${on ? 600 : 400}">${shortName(d)}</text>`;
    labels += `<text x="${X(c) + CW(c) / 2}" y="${H - B + 36}" font-size="10" text-anchor="middle" fill="var(--grey-100)">${t("alert.dayno", { n: num(d.lead + 1) })}</text>`;
    hits += `<rect class="hit" data-i="${i}" x="${X(c)}" y="0" width="${CW(c)}" height="${H}" fill="transparent"><title>${dayName(d)}</title></rect>`;
  });
  s += `<path d="${flat}" fill="none" stroke="var(--blue-100)" stroke-width="2.2" stroke-linecap="round"/>${arrows}${marks}${labels}${hits}`;
  $("#track").innerHTML = `<svg viewBox="0 0 ${W} ${H}" style="min-width:${Math.round(W * 0.78)}px" role="img" aria-label="${esc(t("alert.track.aria"))}">${s}</svg>`;
  $("#track").querySelectorAll(".hit").forEach(h => { h.onclick = () => { stop(); select(+h.dataset.i); }; });
}

function chips() {
  const meas = (DEC.measured || []).map(m => `<div class="dchip measured lv-${esc(m.level)}"><small>${day(m.date, { weekday: "short", day: "numeric", month: "short" })}</small><b>${level(m.level)}</b><small>${t("alert.measured")}</small></div>`).join("");
  $("#days").innerHTML = meas + D.days.map((d, i) => `<button class="dchip lv-${esc(d.level)}" type="button" data-i="${i}" aria-pressed="${i === sel}"><small>${day(d.date, { weekday: "short", day: "numeric", month: "short" })}</small><b>${level(d.level)}</b><small>${t("alert.dayno", { n: num(d.lead + 1) })}</small></button>`).join("");
  $("#days").onclick = e => { const b = e.target.closest("button[data-i]"); if (b) { stop(); select(+b.dataset.i); } };
  const d = D.days[sel];
  $("#dayhint").textContent = t("alert.dayof", { name: dayName(d), date: day(d.date, { day: "numeric", month: "long" }), n: num(d.lead + 1) });
}

function mail() {
  const m = DEC.mail;
  if (!m) { $("#mail").hidden = true; return; }
  const prev = m.prev_top ? t("mail.prev", { prev: badge(m.prev_top) }) : t("mail.noprev");
  $("#mailbody").innerHTML = `${t("mail.text", { w: num(D.rule.alert_window_days), top: badge(m.top) })} ${prev} `
    + (m.kind ? t(`mail.${m.kind}`) : t("mail.none", { min: level(D.rule.alert_min_level) }));
}

function render() {
  chips(); track();
  $("#sentence").innerHTML = sentence(sel);
  $("#ladder").innerHTML = ladder(sel);
  mail();
}

function select(i) { sel = Math.max(0, Math.min(D.days.length - 1, i)); render(); }
function stop() { clearInterval(timer); timer = null; $("#play").textContent = t("alert.play"); }
function play() {
  if (timer) { stop(); return; }
  $("#play").textContent = t("alert.stop");
  select(0);
  timer = setInterval(() => { if (sel >= D.days.length - 1) { stop(); return; } select(sel + 1); }, 1400);
}
