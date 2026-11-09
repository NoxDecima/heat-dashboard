// Track record page (spec § Pages, Track record): three plain numbers, day by day on one time axis
// (levels, the main quantity, the daily error), technical scores collapsed.
import { t, esc, num, deg, day, addDays, level, badge, start, footer, rank } from "./app.js";

let D, city, Q, MIN, period = "90", lead = 1;
const $ = s => document.querySelector(s);
const COL = { green: "#62c39d", yellow: "#eab308", orange: "#f97316", red: "#ef4444", purple: "#a855f7" };
const FC = "#62c39d", BAND = "#8dd6b9", OBS = "#142943", INK = "#324c6b", GRID = "#eff0f0", MUTED = "#808890";
const LEADS = [0, 1, 3];
const mean = a => a.reduce((s, x) => s + x, 0) / a.length;
const high = l => rank(l) >= rank(MIN);
const when = () => t(`history.when.${lead}`);
const value = v => t(`history.q.${Q}`, { v: deg(v, 1) });
const rows = () => {
  const last = D.history[D.history.length - 1].date;
  return D.history.filter(h => period === "all" || h.date > addDays(last, -90));
};

start((c, doc) => {
  city = c; D = doc; Q = D.rule.quantities[0]; MIN = D.rule.alert_min_level;
  document.title = t("title.history", { city: t(`city.${city}.name`) });
  $("#eyebrow").textContent = t("eyebrow.history", { place: t(`city.${city}.place`) });
  $("#sub").textContent = t("history.sub", { station: D.station });
  footer(city);
  if (!D.history.length) { $("#body").innerHTML = `<p class="panel note">${t("history.empty")}</p>`; return; }
  controls(); all();
});

function controls() {
  $("#period").innerHTML = [["90", "history.period.90"], ["all", "history.period.all"]]
    .map(([v, k]) => `<button data-v="${v}" aria-pressed="${v === period}">${t(k)}</button>`).join("");
  $("#lead").innerHTML = LEADS.map(v => `<button data-v="${v}" aria-pressed="${v === lead}">${t(`history.lead.${v}`)}</button>`).join("");
  for (const [id, set] of [["period", v => { period = v; }], ["lead", v => { lead = +v; }]]) {
    $(`#${id}`).onclick = e => { const b = e.target.closest("button"); if (!b) return; set(b.dataset.v); controls(); all(); };
  }
}

function all() { dayByDay(stats()); scores(); }

function stats() {
  const xs = rows().filter(h => h.f[lead]);
  if (!xs.length) { $("#stats").innerHTML = ""; $("#basis").textContent = t("history.none.lead", { when: when() }); return 0; }
  const fc = xs.filter(h => high(h.f[lead][0])), hits = fc.filter(h => high(h.obs.level));
  const miss = xs.filter(h => !high(h.f[lead][0]) && high(h.obs.level));
  const err = xs.map(h => h.f[lead][2] - h.obs[Q]), mae = mean(err.map(Math.abs)), bias = mean(err), L = level(MIN);
  $("#stats").innerHTML = `
    <div class="panel stat"><div class="n">${num(hits.length)} <small>${t("history.of", { n: num(fc.length) })}</small></div><div class="t">${t("history.stat.hits", { level: L, when: when() })}</div></div>
    <div class="panel stat"><div class="n">${num(miss.length)}</div><div class="t">${t("history.stat.miss", { level: L })}</div></div>
    <div class="panel stat"><div class="n">±${deg(mae, 1)}</div><div class="t">${t(bias < 0 ? "history.stat.err.cool" : "history.stat.err.warm", { bias: deg(Math.abs(bias), 1) })}</div></div>`;
  $("#basis").textContent = t("history.basis", { n: num(xs.length), when: when(), station: D.station,
    from: day(xs[0].date, { day: "numeric", month: "short" }), to: day(xs[xs.length - 1].date, { day: "numeric", month: "short", year: "numeric" }) });
  return mae;
}

function dayByDay(mae) {
  const past = rows(), last = past[past.length - 1].date;
  const cols = past.map(h => ({ date: h.date, f: h.f[lead], obs: h.obs }))
    .concat(D.days.filter(d => d.date > last && d[Q]).map(d => ({ date: d.date, f: [d.level, d[Q].p10, d[Q].p50, d[Q].p90], future: true })));
  const Wd = 1000, L = 104, R = 78, n = cols.length, cw = (Wd - L - R) / n, X = i => L + i * cw, C = i => X(i) + cw / 2;
  const yF = 22, yO = 44, rh = 18, yR = 66, t0 = 104, t1 = 304, e0 = 344, e1 = 444, H = 474;
  const txt = (x, y, s, o = {}) => `<text x="${x}" y="${y}" font-size="${o.size || 11}" fill="${o.fill || MUTED}" text-anchor="${o.anchor || "end"}" font-weight="${o.weight || 400}">${s}</text>`;
  const cell = (i, y, l, op = 1) => `<rect x="${X(i) + .5}" y="${y}" width="${Math.max(cw - 1, 1)}" height="${rh}" rx="1.5" fill="${COL[l] || "#dedede"}" opacity="${op}"/>`;
  let s = `<rect id="hl" x="0" y="${yF - 4}" width="${cw}" height="${e1 - yF + 6}" fill="${OBS}" opacity="0"/>`;

  // 1 · levels: our forecast over the measurement, ▲ false alarm, ▼ missed
  s += txt(L - 8, yF + 13, t("history.row.forecast"), { fill: INK, weight: 500 }) + txt(L - 8, yO + 13, t("history.row.measured"), { fill: INK, weight: 500 }) + txt(L - 8, yR + 10, t("history.row.result"));
  cols.forEach((c, i) => {
    if (c.f) s += cell(i, yF, c.f[0], c.future ? 0.4 : 1);
    s += c.obs ? cell(i, yO, c.obs.level) : `<rect x="${X(i) + .5}" y="${yO}" width="${Math.max(cw - 1, 1)}" height="${rh}" rx="1.5" fill="none" stroke="#dedede" stroke-dasharray="2 2"/>`;
    if (c.f && c.obs && high(c.f[0]) !== high(c.obs.level)) s += txt(C(i), yR + 10, high(c.f[0]) ? "▲" : "▼", { anchor: "middle", fill: OBS, size: 9 });
  });

  // 2 · the main quantity: forecast band and middle line (green), measured line (navy)
  const T = D.days[0].thresholds[Q] || {};      // today's levels; Lima's move with the date, close enough for guide lines
  const vals = cols.flatMap(c => [c.obs?.[Q], c.f?.[1], c.f?.[3]]).filter(v => v != null);
  const a = Math.floor(Math.min(...vals) - 1), b = Math.ceil(Math.max(...vals) + 1), Y = v => t0 + (b - v) / (b - a) * (t1 - t0);
  s += txt(L, t0 - 12, t(`history.panel.${Q}`), { anchor: "start", fill: INK, weight: 500 });
  for (let v = Math.ceil(a / 2) * 2; v <= b; v += 2) s += `<line x1="${L}" x2="${Wd - R}" y1="${Y(v)}" y2="${Y(v)}" stroke="${GRID}"/>${txt(L - 8, Y(v) + 4, deg(v))}`;
  for (const l of D.rule.levels) if (T[l] > a && T[l] < b) s += `<line x1="${L}" x2="${Wd - R}" y1="${Y(T[l])}" y2="${Y(T[l])}" stroke="${COL[l]}" stroke-width="1.2" stroke-dasharray="5 4"/>${txt(Wd - R + 6, Y(T[l]) + 4, `${level(l)} ${deg(T[l])}`, { anchor: "start" })}`;
  const runs = ok => { const out = []; let cur = []; cols.forEach((c, i) => { if (ok(c)) cur.push(i); else { if (cur.length) out.push(cur); cur = []; } }); if (cur.length) out.push(cur); return out; };
  for (const fut of [false, true]) {
    for (const seg of runs(c => c.f && !!c.future === fut)) {
      if (seg.length > 1) s += `<polygon points="${seg.map(i => `${C(i)},${Y(cols[i].f[3])}`).concat(seg.slice().reverse().map(i => `${C(i)},${Y(cols[i].f[1])}`)).join(" ")}" fill="${BAND}" opacity="${fut ? 0.25 : 0.45}"/>`;
      s += `<polyline points="${seg.map(i => `${C(i)},${Y(cols[i].f[2])}`).join(" ")}" fill="none" stroke="${FC}" stroke-width="2.2"${fut ? ' stroke-dasharray="5 4"' : ""}/>`;
    }
  }
  for (const seg of runs(c => c.obs)) s += `<polyline points="${seg.map(i => `${C(i)},${Y(cols[i].obs[Q])}`).join(" ")}" fill="none" stroke="${OBS}" stroke-width="2.2" stroke-linejoin="round"/>`;

  // 3 · forecast minus measured, per day, with the typical error dashed
  const errs = cols.map(c => (c.f && c.obs ? c.f[2] - c.obs[Q] : null)), big = Math.max(0, ...errs.filter(e => e != null).map(Math.abs));
  const m = Math.max(4, Math.ceil(big / 2) * 2), E = v => (e0 + e1) / 2 - v / m * (e1 - e0) / 2;
  s += txt(L, e0 - 12, t("history.panel.err"), { anchor: "start", fill: INK, weight: 500 });
  for (const v of [-m, -m / 2, 0, m / 2, m]) s += `<line x1="${L}" x2="${Wd - R}" y1="${E(v)}" y2="${E(v)}" stroke="${v === 0 ? "#b4b4b4" : GRID}"/>${txt(L - 8, E(v) + 4, (v > 0 ? "+" : "") + deg(v))}`;
  if (mae) for (const v of [mae, -mae]) s += `<line x1="${L}" x2="${Wd - R}" y1="${E(v)}" y2="${E(v)}" stroke="${INK}" stroke-dasharray="3 3" opacity=".6"/>`;
  s += (mae ? txt(Wd - R + 6, E(mae) + 4, t("history.typical", { v: deg(mae, 1) }), { anchor: "start" }) : "")
    + txt(Wd - R + 6, e0 + 10, t("history.warm"), { anchor: "start" }) + txt(Wd - R + 6, e1, t("history.cool"), { anchor: "start" });
  errs.forEach((e, i) => { if (e != null) s += `<rect x="${X(i) + cw * 0.15}" y="${Math.min(E(e), E(0))}" width="${cw * 0.7}" height="${Math.abs(E(e) - E(0))}" fill="${INK}" opacity=".7"/>`; });

  // today line, dates, hover columns
  s += `<line x1="${X(past.length)}" x2="${X(past.length)}" y1="${yF - 10}" y2="${e1}" stroke="${INK}"/>${txt(X(past.length) + 4, yF - 10, t("history.today"), { anchor: "start", size: 10 })}`;
  cols.forEach((c, i) => {
    const dd = +c.date.slice(8);
    if (dd === 1 || i === 0) s += txt(X(i), H - 8, day(c.date, { day: "numeric", month: "short" }), { anchor: "start", fill: INK });
    else if (dd % 7 === 1 && dd < 29) s += txt(X(i), H - 8, num(dd), { anchor: "start" });
  });
  cols.forEach((c, i) => { s += `<rect class="hov" data-i="${i}" x="${X(i)}" y="0" width="${cw}" height="${H}" fill="transparent"/>`; });
  const el = $("#dbd");
  el.innerHTML = `<svg viewBox="0 0 ${Wd} ${H}" width="100%" role="img" aria-label="${esc(t("history.daybyday"))}">${s}</svg>`;
  const hl = el.querySelector("#hl"), svg = el.querySelector("svg");
  const pick = e => { const r = e.target.closest(".hov"); if (!r) return; const i = +r.dataset.i; hl.setAttribute("x", X(i)); hl.setAttribute("opacity", ".08"); info(cols[i]); };
  svg.addEventListener("mousemove", pick);
  svg.addEventListener("click", pick);
  $("#legend").innerHTML = [`<span><i style="background:${FC}"></i>${t("history.legend.fc")}</span>`, `<span><i class="band"></i>${t("history.legend.band")}</span>`,
    `<span><i style="background:${OBS}"></i>${esc(t("history.legend.obs", { station: D.station }))}</span>`,
    `<span><b>▲</b> ${t("history.legend.fa", { level: level(MIN) })}</span>`, `<span><b>▼</b> ${t("history.legend.miss", { level: level(MIN) })}</span>`].join("");
}

function info(c) {
  const f = c.f, head = `<b class="ink">${day(c.date, { weekday: "long", day: "numeric", month: "long" })}</b><br>`;
  const fc = f && { badge: badge(f[0]), value: value(f[2]), lo: deg(f[1], 1), hi: deg(f[3], 1) };
  if (c.future) { $("#info").innerHTML = head + t("history.info.future", fc); return; }
  $("#info").innerHTML = head + (f ? t("history.info.fc", { ...fc, when: when() }) : t("history.info.nofc", { when: when() })) + "<br>"
    + t("history.info.obs", { badge: badge(c.obs.level), value: value(c.obs[Q]) })
    + (f ? ` · ${t(f[2] >= c.obs[Q] ? "history.info.warm" : "history.info.cool", { v: deg(Math.abs(f[2] - c.obs[Q]), 1) })}` : "");
}

function scores() {
  const xs = rows(), pct = (a, b) => (b ? `${num(100 * a / b)}%` : t("history.na"));
  const name = L => (L <= 1 ? t(`history.lead.${L}`) : t("history.leadname", { n: L }));
  let body = "";
  for (let L = 0; L < 7; L++) {
    const ys = xs.filter(h => h.f[L]);
    if (!ys.length) continue;
    const c = lv => {
      const f = h => rank(h.f[L][0]) >= rank(lv), o = h => rank(h.obs.level) >= rank(lv);
      return { hit: ys.filter(h => f(h) && o(h)).length, miss: ys.filter(h => !f(h) && o(h)).length, fa: ys.filter(h => f(h) && !o(h)).length };
    };
    const d = c(MIN), y = c(D.rule.levels[0]), err = ys.map(h => h.f[L][2] - h.obs[Q]);
    body += `<tr class="${L < D.rule.alert_window_days ? "win" : ""}"><td>${name(L)}</td><td>${num(ys.length)}</td><td>${mean(err) >= 0 ? "+" : ""}${deg(mean(err), 1)}</td><td>${deg(mean(err.map(Math.abs)), 1)}</td>
      <td>${pct(d.hit, d.hit + d.miss)}</td><td>${pct(d.fa, d.hit + d.fa)}</td><td>${num(d.hit)} / ${num(d.miss)} / ${num(d.fa)}</td><td>${pct(y.hit, y.hit + y.miss)}</td><td>${pct(y.fa, y.hit + y.fa)}</td></tr>`;
  }
  const or = l => t("history.col.orhigher", { level: level(l) });
  $("#sc").innerHTML = `<thead><tr><th></th><th></th><th colspan="2" class="c">${t(`history.col.q.${Q}`)}</th><th colspan="3" class="c">${or(MIN)}</th><th colspan="2" class="c">${or(D.rule.levels[0])}</th></tr>
    <tr><th>${t("history.col.lead")}</th><th>${t("history.col.days")}</th><th>${t("history.col.mean")}</th><th>${t("history.col.typical")}</th><th>${t("history.col.hit")}</th><th>${t("history.col.fa")}</th><th>${t("history.col.hmf")}</th><th>${t("history.col.hit")}</th><th>${t("history.col.fa")}</th></tr></thead><tbody>${body}</tbody>`;
  $("#technote").textContent = t("history.tech.note", { level: t(`level.${MIN}`) });
}
