// Forecast page (spec § Pages, Forecast): headline, official warning, seven-day strip, day detail,
// week chart, yesterday, the alert request and the what-to-do placeholder.
import { CITIES, CONTACT, rank, t, esc, safeUrl, num, deg, day, time, now, level, badge, tip, start, footer, query } from "./app.js";

let D, city, HI, W;
const $ = s => document.querySelector(s);
const main = d => d[D.rule.quantities[0]];
const thr = (d, q) => d.thresholds[q] || {};
const share = () => num(D.rule.share * 100);
const dayName = d => (d.lead === 0 ? t("day.today") : d.lead === 1 ? t("day.tomorrow") : day(d.date, { weekday: "long" }));
const shortName = d => (d.lead < 2 ? dayName(d) : day(d.date, { weekday: "short", day: "numeric" }));
const high = () => D.days.filter(d => rank(d.level) >= rank(D.rule.alert_min_level));

start((c, doc) => {
  city = c; D = doc; HI = D.rule.quantities[0] === "hi"; W = Math.min(D.rule.alert_window_days, D.days.length);
  intro(); official(); strip();
  const first = high()[0];
  show(first ? D.days.indexOf(first) : 0);
  week(); yesterday(); request(); todo(); footer(city);
});

function intro() {
  const first = high()[0], c = t(`city.${city}.name`);
  const when = first && (first.lead === 0 ? t("when.today") : first.lead === 1 ? t("when.tomorrow")
    : day(first.date, { weekday: "long", day: "numeric", month: "short" }));
  const key = (first ? "headline.heat" : "headline.calm") + (D.official ? ".scoped" : "");
  $("#eyebrow").textContent = t("eyebrow.forecast", { place: t(`city.${city}.place`) });
  $("#headline").innerHTML = t(key, { level: first ? `<span class="mark">${level(first.level)}</span>` : "", when, place: t(`city.${city}.short`) });
  $("#subline").innerHTML = (first ? `${t("subline.count", { level: level(D.rule.alert_min_level), n: num(high().length) })} ` : "")
    + t("subline.today", { badge: badge(D.days[0].level) });
  const g = new Date(D.generated), old = (now() - g) / 36e5 > 26, el = $("#fresh");
  el.className = `fresh${old ? " stale" : ""}`;
  el.textContent = old ? t("fresh.stale", { time: time(g, D.timezone), city: c })
    : t("fresh.ok", { time: time(g, D.timezone), next: time(new Date(g.getTime() + 864e5), D.timezone), city: c });
}

// The national warning first when one is in force (spec decision 12).
function official() {
  const o = D.official, box = $("#official"), ag = CITIES[city], place = t(`city.${city}.short`);
  box.className = `official${o ? " active" : ""}`;
  if (o) $(".intro").before(box); else $(".intro").after(box);
  if (!o) {
    box.innerHTML = `<b>${t("official.title")}</b><span>${t(`official.none.${city}`)} <a href="${safeUrl(ag.agencyUrl)}">${esc(ag.agencyUrl.replace("https://www.", ""))}</a></span>`;
    return;
  }
  const valid = o.valid ? `${t("official.valid", { from: day(o.valid[0], { day: "numeric", month: "short" }), to: day(o.valid[1], { day: "numeric", month: "short" }) })} ` : "";
  box.innerHTML = `<b>${t("official.title.active")}</b><span>
    <span class="badge b-${esc(o.level)}">${esc(o.agency)} · ${esc(t(`level.color.${o.level}`))}</span>
    <span class="ttl">${t("official.aviso", { number: esc(o.number), title: esc(o.title) })}</span><br>
    <span class="meta">${valid}${t(`official.scope.${city}`, { place })} <a href="${safeUrl(o.url)}">${t("official.read")}</a></span></span>`;
}

const others = d => (HI ? (d.tmax && d.tmin ? t("card.other.hi", { air: deg(d.tmax.p50), night: deg(d.tmin.p50) }) : "")
  : (d.tmin ? t("card.other.tmax", { night: deg(d.tmin.p50) }) : ""));

function strip() {
  $("#striphead").innerHTML = `<div style="grid-column:span ${W}">${t("strip.next", { n: W })} ${tip("tip.next")}</div>`
    + (W < 7 ? `<div class="later" style="grid-column:span ${7 - W}">${t("strip.later", { from: W + 1 })} ${tip("tip.later")}</div>` : "");
  $("#strip").innerHTML = D.days.map((d, i) => `
    <button class="day lv-${esc(d.level)}${d.lead >= W ? " later" : ""}" data-i="${i}" aria-pressed="false">
      <span class="dn">${dayName(d)}</span><span class="dd">${day(d.date, { day: "numeric", month: "short" })}</span>
      ${badge(d.level)}
      <span class="big">${deg(main(d).p50)}</span>
      <span class="lbl">${t(HI ? "card.main.hi" : "card.main.tmax")}</span>
      <span class="rng">${t("card.range", { lo: deg(main(d).p10), hi: deg(main(d).p90) })}</span>
      <span class="air">${others(d)}</span>
    </button>`).join("");
  $("#strip").onclick = e => { const b = e.target.closest(".day"); if (b) show(+b.dataset.i); };
}

// Heat-index cities: every forecast as a dot against the level zones.
function dots(d) {
  const T = thr(d, "hi"), lv = D.rule.levels, vals = d.hi.members.filter(v => v != null), bins = {};
  const keyed = [...vals].sort((p, q) => p - q).map(v => { const k = Math.round(v * 3) / 3; bins[k] = (bins[k] || 0) + 1; return [v, k, bins[k]]; });
  const Wd = 620, H = Math.max(120, 44 + Math.max(...Object.values(bins)) * 7), x0 = 20, x1 = Wd - 20;
  const a = Math.floor(Math.min(...vals, T[lv[0]]) - 1), b = Math.ceil(Math.max(...vals, T[D.rule.alert_min_level]) + 1);
  const X = v => x0 + (v - a) / (b - a) * (x1 - x0);
  let s = lv.map((l, k) => [l, T[l], T[lv[k + 1]] ?? Infinity]).filter(([, lo]) => lo < b).map(([l, lo, hi]) =>
    `<rect x="${X(Math.max(lo, a))}" y="0" width="${X(Math.min(hi, b)) - X(Math.max(lo, a))}" height="${H - 22}" fill="var(--alert-${l})" opacity=".13"/>
     <text x="${X(Math.max(lo, a)) + 4}" y="12" font-size="10" fill="#808890">${level(l)} ${deg(lo)}</text>`).join("");
  s += keyed.map(([v, k, n]) => `<circle cx="${X(k)}" cy="${H - 28 - (n - 1) * 7}" r="3" fill="#324c6b" opacity=".75"><title>${deg(v, 1)}</title></circle>`).join("");
  for (let v = Math.ceil(a); v <= b; v += 2) s += `<text x="${X(v)}" y="${H - 6}" font-size="10" fill="#808890" text-anchor="middle">${deg(v)}</text>`;
  return `<svg viewBox="0 0 ${Wd} ${H}" width="100%" role="img" aria-label="${esc(t("detail.dots.title", { n: vals.length }))}">${s}<line x1="${x0}" x2="${x1}" y1="${H - 22}" y2="${H - 22}" stroke="#dedede"/></svg>`;
}

// Lima: each forecast's day against its night; a level needs both (D-37).
function scatter(d) {
  const tx = thr(d, "tmax"), tn = thr(d, "tmin"), lv = D.rule.levels, top = lv[lv.length - 1];
  const pairs = d.tmax.members.map((x, i) => [x, d.tmin.members[i]]).filter(([x, y]) => x != null && y != null);
  const xs = pairs.map(p => p[0]), ys = pairs.map(p => p[1]);
  const Wd = 620, H = 300, L = 44, R = 16, Tp = 10, B = 34;
  const ax = Math.floor(Math.min(...xs) - .5), bx = Math.ceil(Math.max(...xs, tx[top]) + .5);
  const ay = Math.floor(Math.min(...ys) - .5), by = Math.ceil(Math.max(...ys, tn[top]) + .5);
  const X = v => L + (v - ax) / (bx - ax) * (Wd - L - R), Y = v => Tp + (by - v) / (by - ay) * (H - Tp - B);
  let s = "";
  for (let v = ax; v <= bx; v++) s += `<line x1="${X(v)}" x2="${X(v)}" y1="${Tp}" y2="${H - B}" stroke="#eff0f0"/><text x="${X(v)}" y="${H - B + 14}" font-size="10" fill="#808890" text-anchor="middle">${deg(v)}</text>`;
  for (let v = ay; v <= by; v++) s += `<line x1="${L}" x2="${Wd - R}" y1="${Y(v)}" y2="${Y(v)}" stroke="#eff0f0"/><text x="${L - 6}" y="${Y(v) + 4}" font-size="10" fill="#808890" text-anchor="end">${deg(v)}</text>`;
  for (const l of lv) s += `<rect x="${X(tx[l])}" y="${Tp}" width="${X(bx) - X(tx[l])}" height="${Y(tn[l]) - Tp}" fill="var(--alert-${l})" opacity=".14" stroke="var(--alert-${l})" stroke-dasharray="3 3"/>`;
  s += `<text x="${X(tx[lv[0]]) + 4}" y="${Tp + 12}" font-size="10" fill="#7c5700">${t("detail.scatter.zone")}</text>`;
  s += pairs.map(([x, y]) => `<circle cx="${X(x)}" cy="${Y(y)}" r="3.2" fill="#324c6b" opacity=".7"><title>${t("detail.scatter.dot", { day: deg(x, 1), night: deg(y, 1) })}</title></circle>`).join("");
  s += `<text x="${(L + Wd - R) / 2}" y="${H - 4}" font-size="11" fill="#324c6b" text-anchor="middle">${t("detail.scatter.x")}</text>`;
  s += `<text x="12" y="${(Tp + H - B) / 2}" font-size="11" fill="#324c6b" text-anchor="middle" transform="rotate(-90 12 ${(Tp + H - B) / 2})">${t("detail.scatter.y")}</text>`;
  return `<svg viewBox="0 0 ${Wd} ${H}" width="100%" role="img" aria-label="${esc(t("detail.scatter.title", { n: pairs.length }))}">${s}</svg>`;
}

function show(i) {
  const d = D.days[i], lv = D.rule.levels;
  document.querySelectorAll("#strip .day").forEach(b => b.setAttribute("aria-pressed", String(+b.dataset.i === i)));
  const lvl = d.level === "green" ? lv[0] : d.level, pct = num((d.chance[lvl] ?? 0) * 100);
  const next = lv[lv.indexOf(lvl) + 1];
  const cond = l => (HI ? t("detail.cond.hi", { v: deg(thr(d, "hi")[l]) })
    : t("detail.cond.dn", { day: deg(thr(d, "tmax")[l], 1), night: deg(thr(d, "tmin")[l], 1) }));
  const lead = d.level === "green" ? t("detail.lead.none", { pct, level: level(lv[0]), cond: cond(lv[0]), share: share() })
    : t("detail.lead.level", { pct, level: level(lvl), cond: cond(lvl), share: share() })
      + (next ? ` ${t("detail.lead.next", { pct: num((d.chance[next] ?? 0) * 100), level: level(next) })}` : "");
  const rows = HI ? [["hi", "row.hi", "tip.hi"], ["tmax", "row.tmax.air", ""], ["tmin", "row.tmin", "tip.night"]]
    : [["tmax", "row.tmax.day", "tip.tmax"], ["tmin", "row.tmin", "tip.night"]];
  $("#detail").innerHTML = `
    <h2>${dayName(d)}, ${day(d.date, { day: "numeric", month: "long" })} ${badge(d.level)}
      ${d.lead >= W ? `<span class="badge muted">${t("detail.later", { n: d.lead + 1 })}</span>` : ""}</h2>
    <p class="lead">${lead}</p>
    <div class="dgrid"><div>
      ${HI ? `<div class="h3">${t("detail.dots.title", { n: d.hi.members.filter(v => v != null).length })} ${tip("tip.dots")}</div>${dots(d)}`
        : `<div class="h3">${t("detail.scatter.title", { n: d.tmax.members.filter(v => v != null).length })} ${tip("tip.scatter")}</div>${scatter(d)}`}
      <div class="h3" style="margin-top:12px">${t("detail.chance")}</div>
      <div class="chance">${lv.map(l => `<span>${level(l)}</span><span class="track lv-${l}"><span class="fill" style="width:${(d.chance[l] ?? 0) * 100}%"></span><span class="cut" style="left:${D.rule.share * 100}%"></span></span><b>${num((d.chance[l] ?? 0) * 100)}%</b>`).join("")}</div>
      <div class="note">${t("detail.chance.note", { share: share() })}</div>
    </div><div>
      <table class="nums"><tr><th></th><th>${t("detail.likely")}</th><th>${t("detail.range")}</th></tr>
        ${rows.filter(([q]) => d[q]).map(([q, k, tp]) => `<tr><td>${t(k)} ${tp ? tip(tp) : ""}</td><td><b>${deg(d[q].p50, 1)}</b></td><td>${t("range", { lo: deg(d[q].p10, 1), hi: deg(d[q].p90, 1) })}</td></tr>`).join("")}
      </table>
      <div class="note">${t("detail.range.note")}</div>
      ${HI ? "" : `<table class="nums" style="margin-top:12px"><tr><th>${t("detail.from")}</th><th>${t("detail.day")}</th><th>${t("detail.night")}</th></tr>
        ${lv.map(l => `<tr><td>${badge(l)}</td><td>${deg(thr(d, "tmax")[l], 1)}</td><td>${deg(thr(d, "tmin")[l], 1)}</td></tr>`).join("")}</table>
        <div class="note">${t("detail.from.note", { station: esc(D.station) })}</div>`}
      <details><summary>${t("detail.tech")}</summary>
        <div class="fam">${Object.entries(d.families).map(([k, v]) => `<span><b>${esc(k.toUpperCase())}</b> ${deg(v, 1)}</span>`).join("")}</div>
        <div class="note">${t(HI ? "detail.tech.note.hi" : "detail.tech.note.dn", { share: share() })}</div>
      </details>
    </div></div>`;
}

function week() {
  const Wd = 1000, H = 240, L = 50, R = 120, Tp = 14, B = 34, n = D.days.length, X = i => L + (i + .5) * (Wd - L - R) / n;
  const d0 = D.days[0], first = D.rule.levels[0];
  const series = (HI ? [["hi", "#142943", ""]] : [["tmax", "#142943", t("week.day")], ["tmin", "#324c6b", t("week.night")]])
    .filter(([q]) => D.days.every(d => d[q]));
  const lines = HI ? D.rule.levels.map(l => [l, thr(d0, "hi")[l], `${level(l)} ${deg(thr(d0, "hi")[l])}`])
    : [[first, thr(d0, "tmax")[first], t("week.hotday", { v: deg(thr(d0, "tmax")[first]) })],
      [first, thr(d0, "tmin")[first], t("week.warmnight", { v: deg(thr(d0, "tmin")[first]) })]];
  const vals = series.flatMap(([q]) => D.days.flatMap(d => [d[q].p10, d[q].p90]));
  const need = HI ? [thr(d0, "hi")[D.rule.alert_min_level]] : lines.map(x => x[1]);
  const a = Math.floor(Math.min(...vals) - 1), b = Math.ceil(Math.max(...vals, ...need) + 1.5);
  const Y = v => Tp + (b - v) / (b - a) * (H - Tp - B);
  const near = [...Array(W).keys()], far = [...Array(n - W + 1).keys()].map(k => k + W - 1);
  let s = "";
  for (let v = Math.ceil(a); v <= b; v++) if (v % 2 === 0) s += `<line x1="${L}" x2="${Wd - R}" y1="${Y(v)}" y2="${Y(v)}" stroke="#eff0f0"/><text x="${L - 8}" y="${Y(v) + 4}" font-size="12" fill="#808890" text-anchor="end">${deg(v)}</text>`;
  for (const [l, v, lab] of lines) if (v > a && v < b) s += `<line x1="${L}" x2="${Wd - R}" y1="${Y(v)}" y2="${Y(v)}" stroke="var(--alert-${l})" stroke-width="1.5" stroke-dasharray="5 4"/><text x="${Wd - R + 6}" y="${Y(v) + 4}" font-size="12" fill="#808890">${lab}</text>`;
  for (const [q, col, lab] of series) {
    const band = idx => idx.map(i => `${X(i)},${Y(D.days[i][q].p90)}`).concat([...idx].reverse().map(i => `${X(i)},${Y(D.days[i][q].p10)}`)).join(" ");
    const line = (idx, dash) => `<polyline points="${idx.map(i => `${X(i)},${Y(D.days[i][q].p50)}`).join(" ")}" fill="none" stroke="${col}" stroke-width="2.5"${dash ? ' stroke-dasharray="6 5"' : ""}/>`;
    s += `<polygon points="${band(near)}" fill="#8dd6b9" opacity=".45"/>${line(near, false)}`;
    if (W < n) s += `<polygon points="${band(far)}" fill="#8dd6b9" opacity=".22"/>${line(far, true)}`;
    if (lab) s += `<text x="${X(n - 1) + 10}" y="${Y(D.days[n - 1][q].p50) + 4}" font-size="12" fill="${col}" font-weight="500">${lab}</text>`;
  }
  const q0 = series[0][0];
  D.days.forEach((d, i) => {
    s += `<circle cx="${X(i)}" cy="${Y(d[q0].p50)}" r="7" fill="var(--alert-${esc(d.level)})" stroke="#fff" stroke-width="2"><title>${dayName(d)}: ${level(d.level)}, ${deg(d[q0].p50, 1)}</title></circle>`;
    s += `<text x="${X(i)}" y="${H - 12}" font-size="12" fill="#324c6b" text-anchor="middle">${shortName(d)}</text>`;
  });
  if (W < n) {
    const x = (X(W - 1) + X(W)) / 2;
    s += `<line x1="${x}" x2="${x}" y1="${Tp}" y2="${H - B}" stroke="#b4b4b4" stroke-dasharray="3 3"/><text x="${x + 6}" y="${Tp + 10}" font-size="11" fill="#808890">${t("week.lesscertain")}</text>`;
  }
  $("#week").innerHTML = `<svg viewBox="0 0 ${Wd} ${H}" width="100%" role="img" aria-label="${esc(t("week.title"))}">${s}</svg>`;
}

function yesterday() {
  const y = D.yesterday, el = $("#yesterday");
  $("#history-link").href = `history.html${query(city)}`;
  if (!y) { el.innerHTML = `<span></span><span class="note">${t("yesterday.none")}</span>`; return; }
  const qs = Object.keys(y.forecast);
  const v = o => qs.map(q => t(`yesterday.q.${q}`, { v: deg(o[q], 1) })).join(", ");
  const off = qs.map(q => t(`yesterday.off.${q}`, { v: deg(Math.abs(y.forecast[q] - y.observed[q]), 1) })).join(", ");
  el.innerHTML = `
    <span class="k">${day(y.date, { weekday: "long", day: "numeric", month: "short" })}</span><span></span>
    <span class="k">${t("yesterday.forecast")}</span><span>${badge(y.level)} ${v(y.forecast)}, ${t("yesterday.ahead")}</span>
    <span class="k">${t("yesterday.measured")}</span><span>${badge(y.observed.level)} ${v(y.observed)} ${t("yesterday.at", { station: esc(y.observed.station) })}</span>
    <span></span><span class="ok">${y.level === y.observed.level ? t("yesterday.match") : t("yesterday.miss")} · ${off}</span>`;
}

// The alert request: a prepared mail to us for now, the sign-up function later (DL-8).
function request() {
  $("#alerttip").dataset.tip = t("tip.alertmail", { level: level(D.rule.alert_min_level), n: W });
  $("#alerttip").setAttribute("aria-label", t("tip.label"));
  $("#sub-cities").innerHTML = Object.keys(CITIES).map(c => `<label><input type="checkbox" name="c" value="${c}"${c === city ? " checked" : ""}> ${t(`city.${c}.name`)}</label>`).join("");
  $("#sub").onsubmit = e => {
    e.preventDefault();
    const f = new FormData(e.target), cities = f.getAll("c").map(c => t(`city.${c}.name`)).join(", ") || t("sub.none");
    const body = t("sub.mail.body", { cities, mode: t(`sub.mode.${f.get("m")}`) });
    location.href = `mailto:${CONTACT}?subject=${encodeURIComponent(t("sub.mail.subject", { cities }))}&body=${encodeURIComponent(body)}`;
  };
}

function todo() {
  $("#todonote").textContent = t("todo.note", { agency: CITIES[city].agency });
  $("#todorows").innerHTML = D.rule.levels.map(l => `<div>${badge(l)}<br>${t("todo.tbd")}</div>`).join("");
}
