/* mhb dashboard 前端：總覽 / 時間軸 / 用藥 / 趨勢 ＋ 全文搜尋。
   Preact + htm（vendored），零執行期網路請求；外部連結僅使用者點擊才離開。 */
(function () {
  "use strict";
  const DATA = JSON.parse(document.getElementById("mhb-data").textContent);

  /* ---------- CPAP（睡眠呼吸） ---------- */
  // payload 可能來自尚無 CPAP 區塊的舊版本，一律防禦性取值
  const CPAP = DATA.cpap || {};
  const CPAP_DAILY = CPAP.daily || [];
  const HAS_CPAP = CPAP_DAILY.length > 0;
  // 沒有 CPAP 資料的使用者不該看到空分頁與空卡片（proposal 相容性要求），
  // 因此分頁、總覽卡與趨勢圖都以 HAS_CPAP 為條件顯示
  const cpapSeries = (field) => CPAP_DAILY
    .filter((r) => r[field] != null).map((r) => [r.date, r[field]]);

  // 視窗/分頁標題帶成員名（2026-08-10 走查回饋：多成員一目瞭然）
  if (DATA.meta.profile) document.title = DATA.meta.profile + " 的個人健康資料工作台（私人）";
  const { h, render } = preact;
  const { useState, useMemo, useEffect } = preactHooks;
  const html = htm.bind(h);

  const TYPE_META = {
    western_outpatient: ["西醫門診", "var(--s1)"],
    tcm: ["中醫門診", "var(--s2)"],
    dental: ["牙醫門診", "var(--s3)"],
    pharmacy_dispensing: ["藥局調劑", "var(--s4)"],
  };
  const fmtType = (t) => (TYPE_META[t] || [t, "var(--ink2)"])[0];
  const typeColor = (t) => (TYPE_META[t] || [t, "var(--ink2)"])[1];
  const medKey = (m) => m.order_code || m.order_name;

  /* 醫令分類：西醫藥品（品項檔命中）/ 中醫用藥 / 診療項目與其他 */
  function medCategory(m) {
    if (m.drug_zh) return "drug";
    if ((m.section_hint || "").startsWith("r9")) return "tcm";
    return "order";
  }

  /* ---------- 共用元件 ---------- */
  function latestAndDelta(series, daysBack) {
    // series: [[date, val]...] 日序列；回傳 [最新值, 與 daysBack 天前的差]
    if (!series || !series.length) return [null, null];
    const last = series[series.length - 1];
    const target = new Date(new Date(last[0]) - daysBack * 864e5)
      .toISOString().slice(0, 10);
    let ref = null;
    for (const p of series) if (p[0] <= target) ref = p;
    return [last[1], ref ? +(last[1] - ref[1]).toFixed(1) : null];
  }

  function avgWindow(series, days, endOffset) {
    if (!series || !series.length) return null;
    const end = new Date(new Date(series[series.length - 1][0]) - (endOffset || 0) * 864e5);
    const start = new Date(end - days * 864e5);
    const vals = series.filter((p) => new Date(p[0]) > start && new Date(p[0]) <= end)
      .map((p) => p[1]);
    return vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : null;
  }

  function Delta({ d, unit, invert }) {
    if (d == null || d === 0) return html`<div class="delta flat">— 持平</div>`;
    const worse = invert ? d < 0 : d > 0;
    return html`<div class="delta ${worse ? "up" : "down"}">
      ${d > 0 ? "▲" : "▼"} ${Math.abs(d)}${unit || ""}</div>`;
  }

  function Card({ icon, color, title, wide, children }) {
    return html`<div class="card ${wide ? "wide" : ""}">
      <div class="cat"><span class="cdot" style="background:${color}">${icon}</span>${title}</div>
      ${children}</div>`;
  }

  function Chip({ type }) {
    return html`<span class="chip" style="background:${typeColor(type)}"></span>${fmtType(type)}`;
  }

  /* ---------- 趨勢圖的時間軸工具（純函式，供 LineChart 與趨勢頁共用） ---------- */
  const DAY = 864e5;
  /* 日期字串 → 毫秒。"YYYY-MM" 視為該月一日（normDate 與 monthlyAvg 都會
     產生這種形式）；null 與無法解析者回 NaN 由呼叫端剔除。 */
  function tsOf(d) {
    // 先擋非字串與空字串：new Date(null) 是 1970（epoch 0）而不是
    // Invalid Date，光靠 isNaN 抓不到，一筆 null 就會把時間域下界
    // 拉到 1970 且不拋錯
    if (typeof d !== "string" || !d.trim()) return NaN;
    const t = new Date(d).getTime();
    return Number.isNaN(t) ? NaN : t;
  }
  const fmtDate = (t) => new Date(t).toISOString().slice(0, 10);

  /* 剔除日期無法解析的點。一筆 null 會讓 new Date(null) 得 1970 而把時間域
     下界整個拉走，且不拋錯（無聲失敗），故必須在算域之前處理。 */
  function sanitize(points) {
    const kept = [], dropped = [];
    for (const p of points || []) (Number.isNaN(tsOf(p[0])) ? dropped : kept).push(p);
    return { kept, dropped: dropped.length };
  }

  /* 依時間域過濾（含邊界）。不保留域外相鄰點：手寫 SVG 無裁切區域，
     跨界點會畫到繪圖區外（design D5 明示選擇）。
     月粒度（"YYYY-MM"）以「該月與區間有交集」判定，否則區間下界所在
     月份的整桶會被丟掉。 */
  function inRange(points, tMin, tMax) {
    return (points || []).filter(([d]) => {
      const t = tsOf(d);
      if (Number.isNaN(t)) return false;
      if (/^\d{4}-\d{2}$/.test(d)) {
        const end = new Date(t); end.setUTCMonth(end.getUTCMonth() + 1);
        return end.getTime() - 1 >= tMin && t <= tMax;   // 月份與區間有交集
      }
      return t >= tMin && t <= tMax;
    });
  }

  /* 依時間挑刻度：粒度隨跨度，超過上限逐級降到不超過為止。
     每個粒度都有下一級，近三月（週粒度 13 個）才有解。 */
  /* 由細到粗的單一階梯：起始粒度依跨度挑，之後只會往「更粗」走。
     用平坦陣列且順序不單調會出事——舊版年粒度用盡後掉進 month/1（更細），
     一路更細直到耗盡而回傳空陣列，跨度超過約 40 年時 x 軸一個標籤都沒有，
     且不拋錯（民國年被誤解析成 19xx 就會踩到）。 */
  const TICK_LADDER = [
    ["week", 1], ["week", 2],
    ["month", 1], ["month", 3], ["month", 6],
    ["year", 1], ["year", 2], ["year", 5], ["year", 10], ["year", 20], ["year", 50],
  ];
  function timeTicks(tMin, tMax, maxTicks = 8) {
    const span = Math.max(tMax - tMin, 1);
    const start = span > 730 * DAY ? 5 : span > 91 * DAY ? 2 : 0;
    for (let i = start; i < TICK_LADDER.length; i++) {
      const [unit, n] = TICK_LADDER[i];
      const ticks = [];
      const d = new Date(tMin);
      if (unit === "year") {
        d.setUTCMonth(0, 1); d.setUTCHours(0, 0, 0, 0);
        // 對齊到 n 的倍數年，否則刻度會錨在資料起點的年份（如 2007/2012/2017）
        if (n > 1) d.setUTCFullYear(Math.ceil(d.getUTCFullYear() / n) * n);
        while (d.getTime() < tMin) d.setUTCFullYear(d.getUTCFullYear() + n);
        for (; d.getTime() <= tMax; d.setUTCFullYear(d.getUTCFullYear() + n)) {
          ticks.push({ t: d.getTime(), label: String(d.getUTCFullYear()) });
        }
      } else if (unit === "month") {
        d.setUTCDate(1); d.setUTCHours(0, 0, 0, 0);
        while (d.getTime() < tMin) d.setUTCMonth(d.getUTCMonth() + 1);
        for (; d.getTime() <= tMax; d.setUTCMonth(d.getUTCMonth() + n)) {
          ticks.push({ t: d.getTime(), label: fmtDate(d.getTime()).slice(2, 7) });
        }
      } else {
        d.setUTCHours(0, 0, 0, 0);
        for (; d.getTime() <= tMax; d.setUTCDate(d.getUTCDate() + 7 * n)) {
          ticks.push({ t: d.getTime(), label: fmtDate(d.getTime()).slice(5) });
        }
      }
      if (ticks.length <= maxTicks) return ticks;
    }
    // 保底：跨度大到連最粗粒度都超過上限時，仍給首末兩刻度（絕不回空）
    return [{ t: tMin, label: fmtDate(tMin).slice(0, 4) },
            { t: tMax, label: fmtDate(tMax).slice(0, 4) }];
  }

  /* SVG 折線圖：series = [{label, color, points:[[date,val],…]}]，
     domain={tMin,tMax} 為呼叫端傳入的共用時間域（趨勢頁四張圖同一組；
     未傳則以本圖資料自身首末日為域，供總覽卡使用）。
     空序列不畫（單一來源時常見），全空才顯示無資料。 */
  /* 折線圖尺寸提到模組層，讓標記門檻由繪圖區寬度推導而非硬編碼
     （改 W／PL／PR 時門檻自動跟著走） */
  const CH = { W: 860, H: 240, PL: 48, PB: 28, PT: 10, PR: 100 };
  const CH_PW = CH.W - CH.PL - CH.PR;              // 繪圖區寬 712px
  const MARK_FULL = Math.floor(CH_PW / 6);         // r=3 直徑 6px → 118 點
  const MARK_SMALL = Math.floor(CH_PW / 3);        // r=1.5 直徑 3px → 237 點
  // 無區間控制項的圖（總覽卡）不得套用「不畫標記」那一段：使用者在那裡
  // 沒有切區間的手段可以把逐點數值提示要回來，故上限放寬到不歸零
  const MARK_NO_RANGE = Math.ceil(CH_PW / 1.8);    // 396 點
  function LineChart({ series, unit, refRange, domain, note, onShowAll,
    markerLimit = MARK_SMALL, rangeLabel }) {
    const { W, H, PL, PB, PT, PR } = CH;
    const PW = CH_PW;
    let dropped = 0;
    const cleaned = series.map((s) => {
      const r = sanitize(s.points);
      dropped += r.dropped;
      return { ...s, points: r.kept };
    });
    const dom = domain || (() => {
      const ts = cleaned.flatMap((s) => s.points.map((p) => tsOf(p[0])));
      return ts.length ? { tMin: Math.min(...ts), tMax: Math.max(...ts) } : null;
    })();
    const scoped = dom
      ? cleaned.map((s) => ({ ...s, points: inRange(s.points, dom.tMin, dom.tMax) }))
      : cleaned;
    const drawn = scoped.filter((s) => s.points.length);
    const all = drawn.flatMap((s) => s.points);
    const foot = [note, dropped ? `已略過 ${dropped} 筆日期無法識別的紀錄` : null]
      .filter(Boolean).join("；");
    if (!all.length || !dom) {
      return html`<p class="note">${rangeLabel || "此區間"}無資料${foot ? `（${foot}）` : ""}
        ${onShowAll && html` <button class="catbtn" onClick=${onShowAll}>看全部</button>`}</p>`;
    }
    const vals = all.map((p) => p[1]);
    let lo = Math.min(...vals), hi = Math.max(...vals);
    if (refRange) { lo = Math.min(lo, refRange[0]); hi = Math.max(hi, refRange[1]); }
    const pad = (hi - lo) * 0.08 || 1; lo -= pad; hi += pad;
    const span = Math.max(dom.tMax - dom.tMin, 1);
    // 座標夾在時間域內：月粒度序列以「月份與區間有交集」納入（見 inRange），
    // 其代表日期是該月 1 日，可能早於 tMin；不夾的話會畫到繪圖區左外側，
    // 極端情況（區間下界在月底）甚至畫出 viewBox 而完全看不見
    const x = (d) => PL
      + ((Math.min(Math.max(tsOf(d), dom.tMin), dom.tMax) - dom.tMin) / span) * PW;
    const y = (v) => PT + (H - PB - PT) - ((v - lo) / (hi - lo)) * (H - PB - PT);
    const gridN = 4, grid = [];
    for (let i = 0; i <= gridN; i++) {
      const v = lo + ((hi - lo) * i) / gridN;
      grid.push(html`<line x1=${PL} y1=${y(v)} x2=${W - PR} y2=${y(v)} class="grid" />
        <text x=${PL - 6} y=${y(v) + 4} class="ax" text-anchor="end">${v.toFixed(v > 99 ? 0 : 1)}</text>`);
    }
    const xlab = timeTicks(dom.tMin, dom.tMax).map((tk) =>
      html`<text x=${PL + ((tk.t - dom.tMin) / span) * PW} y=${H - 8}
        class="ax" text-anchor="middle">${tk.label}</text>`);
    const band = refRange ? html`<rect x=${PL} y=${y(refRange[1])} width=${PW}
        height=${Math.max(y(refRange[0]) - y(refRange[1]), 1)} class="refband" />` : null;
    return html`<div class="chartwrap"><svg viewBox="0 0 ${W} ${H}" width=${W} role="img">
      ${band}${grid}${xlab}
      ${drawn.map((s, si) => {
        const pts = s.points.map((p) => `${x(p[0])},${y(p[1])}`).join(" ");
        const last = s.points[s.points.length - 1];
        // 標記半徑：序列顯式指定（如健保成健的獨立標記）優先，否則依
        // 區間內點數兩段降級；超過 MARK_SMALL 不畫標記只畫折線
        const r = s.marker || (s.points.length > markerLimit ? 0
          : s.points.length > MARK_FULL ? 1.5 : 3);
        const name = s.label.length > 7 ? s.label.slice(0, 6) + "…" : s.label;
        return html`<g>
          ${s.points.length > 1 && html`<polyline points=${pts} fill="none" stroke=${s.color} stroke-width="2" />`}
          ${r > 0 && s.points.map((p) => html`<circle cx=${x(p[0])} cy=${y(p[1])} r=${r}
              fill=${s.color} stroke=${s.stroke || "none"} stroke-width="2">
            <title>${s.label} ${p[0]}：${p[1]} ${unit || ""}</title></circle>`)}
          <text x=${W - PR + 6} y=${PT + 14 + si * 30} class="ax" fill=${s.color}>${name}</text>
          <text x=${W - PR + 6} y=${PT + 27 + si * 30} class="ax" fill=${s.color}>${last[1]}</text>
        </g>`;
      })}</svg></div>
      ${foot && html`<p class="note">${foot}</p>`}`;
  }

  /* 處方時間軸：全資料期間為 x 軸，每次處方一根長條（高度＝給藥日數） */
  function DispenseTimeline({ items }) {
    const dated = items.filter((m) => m.date).sort((a, b) => (a.date < b.date ? -1 : 1));
    if (!dated.length) return html`<p class="note">無日期資料</p>`;
    const t0 = new Date(DATA.meta.date_min).getTime();
    const t1 = new Date(DATA.meta.date_max).getTime();
    const W = 820, H = 90, PL = 8, PB = 20, PT = 8;
    const x = (d) => PL + ((new Date(d).getTime() - t0) / Math.max(t1 - t0, 1)) * (W - PL - 12);
    const maxDays = Math.max(...dated.map((m) => m.days_supply || 1), 1);
    const bh = (d) => Math.max(((d || 1) / maxDays) * (H - PB - PT), 3);
    const years = [];
    for (let yy = new Date(DATA.meta.date_min).getFullYear();
         yy <= new Date(DATA.meta.date_max).getFullYear(); yy++) years.push(yy);
    return html`<div class="chartwrap"><svg viewBox="0 0 ${W} ${H}" width=${W} role="img">
      <line x1=${PL} y1=${H - PB} x2=${W - 8} y2=${H - PB} class="grid" />
      ${years.map((yy) => html`<text x=${Math.max(x(yy + "-01-01"), PL)} y=${H - 5}
          class="ax">${yy}</text>`)}
      ${dated.map((m) => html`<rect x=${x(m.date) - 2} y=${H - PB - bh(m.days_supply)}
          width="4" rx="1.5" height=${bh(m.days_supply)} fill="var(--s1)">
        <title>${m.date}：${m.days_supply || "?"} 日份（${m.facility_name}）</title></rect>`)}
    </svg></div><p class="note">每根長條＝一次處方，高度＝給藥日數（滑過看明細）</p>`;
  }

  const STAT_ZH = { encounters: "就醫", medications: "用藥", lab_results: "檢驗",
    reports: "報告", immunizations: "疫苗", body_measurements: "身體數值",
    cancer_screenings: "癌篩", apple_records: "量測", apple_workouts: "運動",
    cpap_daily: "睡眠每日摘要", cpap_events: "呼吸事件", cpap_oximetry: "睡眠血氧",
    cpap_daily_unused: "無使用紀錄的日子" };

  // 單筆 import_stats（JSON 字串）→ { inserted, dupTotal }；不可解析回 null
  function parseStats(statsJson) {
    if (!statsJson) return null;
    try {
      const st = JSON.parse(statsJson);
      return {
        inserted: st.inserted || {},
        dupTotal: Object.values(st.skipped_dup || {}).reduce((a, b) => a + b, 0),
      };
    } catch (e) { return null; }
  }

  // 接受 groupSources 合計後的物件（單檔來源即該檔自身的統計）
  function importSummary(stats) {
    if (!stats || stats.missing) return "（早期匯入，無統計）";
    const parts = Object.entries(stats.inserted || {})
      .filter(([, n]) => n > 0)
      .map(([k, n]) => `${STAT_ZH[k] || k} +${n.toLocaleString()}`);
    if (stats.dupTotal) parts.push(`重複略過 ${stats.dupTotal.toLocaleString()}`);
    return parts.join("、") || "無新增（內容均已存在）";
  }

  /* ---------- 總覽（洞察式摘要卡） ---------- */
  const ADAPTER_ZH = {
    nhi_json: "健保存摺（JSON）", nhi_xml: "健保存摺（XML）",
    apple_health: "Apple 健康", resmed_edf: "CPAP（ResMed）",
  };

  // 同一 adapter 且同一匯入時刻的多個檔併為一組（design D2：payload 保留
  // 逐檔追溯，摺疊做在檢視層）。stats 取組內各檔的合計。
  function groupSources(sources) {
    const out = [];
    const idx = new Map();
    for (const s of sources || []) {
      const key = `${s.adapter}|${s.imported_at}`;
      if (!idx.has(key)) {
        idx.set(key, out.length);
        out.push({ adapter: s.adapter, imported_at: s.imported_at, files: [], stats: {} });
      }
      const g = out[idx.get(key)];
      g.files.push(s);
      const st = parseStats(s.import_stats);
      if (!st) { g.stats.missing = true; continue; }
      g.stats.inserted = g.stats.inserted || {};
      for (const [k, v] of Object.entries(st.inserted)) {
        g.stats.inserted[k] = (g.stats.inserted[k] || 0) + v;
      }
      g.stats.dupTotal = (g.stats.dupTotal || 0) + st.dupTotal;
    }
    return out;
  }

  function Overview({ go }) {
    const c = DATA.meta.counts;
    const encs = DATA.encounters.slice(0, 8);
    const [w, wd] = latestAndDelta(DATA.measures["體重"], 7);
    const [sys] = latestAndDelta(DATA.measures["收縮壓"], 7);
    const [dia] = latestAndDelta(DATA.measures["舒張壓"], 7);
    const steps30 = avgWindow(DATA.activity["步數"], 30, 0);
    const stepsPrev = avgWindow(DATA.activity["步數"], 30, 30);
    const latest = DATA.encounters[0];
    const weightYear = (DATA.measures["體重"] || []).slice(-365);
    const recentLabs = DATA.labs.filter((l) => l.value_numeric != null).slice(-4).reverse();
    const lastNight = HAS_CPAP ? CPAP_DAILY.at(-1) : null;
    return html`<section>
      <div class="cards">
        <${Card} icon="⚖︎" color="var(--s1)" title="體重">
          ${w != null ? html`<div class="big">${w}<small> kg</small></div>
            <${Delta} d=${wd} unit=" kg（7日）" invert=${false} />`
            : html`<p class="note">尚無量測資料</p>`}
        </${Card}>
        <${Card} icon="♥" color="var(--s2)" title="血壓（最近量測日）">
          ${sys != null ? html`<div class="big">${sys}<small>/${dia}</small></div>
            <div class="delta flat">mmHg｜${(DATA.measures["收縮壓"] || []).at(-1)?.[0] || ""}</div>`
            : html`<p class="note">尚無量測資料</p>`}
        </${Card}>
        ${lastNight && html`<${Card} icon="😴" color="var(--s3)" title="睡眠呼吸（最近一晚）">
          <div class="big">${lastNight.ahi ?? "—"}<small> AHI</small></div>
          <div class="delta flat">
            ${lastNight.usage_min != null
              ? `使用 ${Math.round((lastNight.usage_min / 60) * 10) / 10} 小時` : "使用時數不明"}
            ｜${lastNight.date}</div>
        </${Card}>`}
        <${Card} icon="🏃" color="var(--s4)" title="日均步數（30日）">
          ${steps30 != null ? html`<div class="big">${steps30.toLocaleString()}</div>
            <${Delta} d=${stepsPrev != null ? steps30 - stepsPrev : null} unit=" 較前期" invert=${true} />`
            : html`<p class="note">尚無資料</p>`}
        </${Card}>
        <${Card} icon="📅" color="var(--accent)" title="最近就診">
          ${latest ? html`<div class="big" style="font-size:20px">
              ${latest.date?.slice(5).replace("-", "/")} ${fmtType(latest.type)}</div>
            <div class="delta flat">${latest.facility_name}｜${latest.dx_name || ""}</div>`
            : html`<p class="note">尚無資料</p>`}
        </${Card}>
        <${Card} wide icon="⚖︎" color="var(--s1)" title="體重趨勢（一年）">
          <${LineChart} unit="kg" markerLimit=${MARK_NO_RANGE}
            series=${[{ label: "體重", color: "var(--s1)", points: weightYear }]} />
        </${Card}>
        <${Card} wide icon="🧪" color="var(--s3)" title="最新檢驗（點入看趨勢）">
          <table>${recentLabs.map((l) => html`<tr class="rowlink"
              onClick=${() => go("trends", { lab: l.name })}>
            <td>${l.name}</td><td class="num">${l.value_text}</td>
            <td class="dt">${l.ref_range || ""}</td><td class="dt">${l.test_date}</td></tr>`)}
          </table>
        </${Card}>
        <${Card} wide icon="📅" color="var(--accent)" title="最近就醫">
          <table>${encs.map((e) => html`<tr class="rowlink" onClick=${() => go("timeline", { enc: e.id })}>
            <td class="dt">${e.date}</td><td><${Chip} type=${e.type} /></td>
            <td>${e.facility_name}</td><td class="dt">${e.dx_name || ""}</td></tr>`)}</table>
        </${Card}>
        <${Card} wide icon="🗂" color="var(--ink2)" title="資料庫與匯入紀錄">
          <p class="note">就醫 ${c.encounters}｜用藥 ${c.medications}｜檢驗 ${c.lab_results}｜
            報告 ${c.reports}｜疫苗 ${c.immunizations}｜Apple 量測 ${c.apple_records.toLocaleString()}
            ${HAS_CPAP ? `｜睡眠呼吸 ${c.cpap_daily} 晚` : ""}</p>
          <table><tr><th>匯入時間</th><th>檔案</th><th>來源</th><th>新增內容</th></tr>
            ${groupSources(DATA.meta.sources).map((g) => html`<tr>
              <td class="dt">${g.imported_at}</td>
              <td>${g.files.length === 1 ? g.files[0].filename
                : html`<details><summary>${g.files.length} 個檔案</summary>
                    ${g.files.map((f) => html`<div class="dt">${f.filename}</div>`)}</details>`}</td>
              <td class="dt">${ADAPTER_ZH[g.adapter] || g.adapter}</td>
              <td class="dt">${importSummary(g.stats)}</td></tr>`)}</table>
        </${Card}>
      </div>
    </section>`;
  }

  /* ---------- 時間軸 ---------- */
  function Timeline({ focus }) {
    const [type, setType] = useState("");
    const [fac, setFac] = useState("");
    const [open, setOpen] = useState((focus && focus.enc) || null);
    // 院所選單跟著已選類型連動
    const facilities = useMemo(
      () => [...new Set(DATA.encounters.filter((e) => !type || e.type === type)
        .map((e) => e.facility_name).filter(Boolean))].sort(), [type]);
    const effFac = facilities.includes(fac) ? fac : "";
    const list = DATA.encounters.filter(
      (e) => (!type || e.type === type) && (!effFac || e.facility_name === effFac));
    const medById = useMemo(() => {
      const m = {}; DATA.medications.forEach((x) => (m[x.id] = x)); return m;
    }, []);
    useEffect(() => {
      if (focus && focus.enc) {
        const el = document.querySelector(".event.open");
        if (el) el.scrollIntoView({ block: "start" });
      }
    }, []);
    return html`<section>
      <div class="filters">
        <select value=${type} onChange=${(e) => { setType(e.target.value); setFac(""); }}>
          <option value="">全部類型</option>
          ${Object.keys(TYPE_META).map((t) => html`<option value=${t}>${fmtType(t)}</option>`)}
        </select>
        <select value=${effFac} onChange=${(e) => setFac(e.target.value)}>
          <option value="">全部院所（${facilities.length}）</option>
          ${facilities.map((f) => html`<option value=${f}>${f}</option>`)}
        </select>
        <span class="note">${list.length} 筆</span>
      </div>
      ${list.map((e) => html`<div class="event ${open === e.id ? "open" : ""}">
        <div class="evhead rowlink" onClick=${() => setOpen(open === e.id ? null : e.id)}>
          <span class="dt">${e.date}</span> <${Chip} type=${e.type} />
          <b> ${e.facility_name}</b> <span>${e.dx_name || ""}</span>
        </div>
        ${open === e.id && html`<div class="evbody">
          ${e.dx_code && html`<p>主診斷：${e.dx_name}（${e.dx_code}）</p>`}
          ${(DATA.meds_by_enc[e.id] || []).length > 0 && html`<table>
            <tr><th>醫令/藥品</th><th>成分</th><th>總量</th><th>天數</th><th>仿單</th></tr>
            ${DATA.meds_by_enc[e.id].map((mid) => { const m = medById[mid];
              return html`<tr><td>${m.drug_zh || m.order_name}${m.tooth_name ? `（${m.tooth_name}）` : ""}</td>
                <td class="dt">${m.ingredient || ""}</td>
                <td class="num">${m.total_qty ?? ""}</td><td class="num">${m.days_supply ?? ""}</td>
                <td>${m.leaflet_url ? html`<a href=${m.leaflet_url} target="_blank" rel="noopener">仿單↗</a>` : ""}</td></tr>`; })}
          </table>`}
          <p class="src">來源：${e.source_file}［${e.section}#${e.source_index}］
            ${e.copay != null ? ` ｜ 部分負擔 ${e.copay} 元 ｜ 健保 ${e.nhi_points} 點` : ""}</p>
        </div>`}
      </div>`)}
    </section>`;
  }

  /* ---------- 用藥（分類＋可展開處方時間軸） ---------- */
  const MED_CATS = [["drug", "藥品"], ["tcm", "中醫用藥"], ["order", "診療項目與其他"]];

  function MedGroup({ g, open, onToggle, go }) {
    const m = g.m;
    const days = g.items.reduce((s, x) => s + (x.days_supply || 0), 0);
    const facs = [...new Set(g.items.map((x) => x.facility_name))];
    return html`<div class="event ${open ? "open" : ""}">
      <div class="evhead rowlink" onClick=${onToggle}>
        <b>${m.drug_zh || m.order_name}</b>
        <span class="note">${g.items.length} 次${days ? `｜合計 ${days} 日份` : ""}｜最近 ${g.items[0].date}</span>
        <span class="note" style="margin-left:auto">${open ? "▴" : "▾"}</span>
      </div>
      ${open && html`<div class="evbody">
        ${!m.drug_zh && html`<p class="note"><span class="flag">品項檔未對照</span>
          顯示原始醫囑名稱（診療項目與中藥不在西藥品項檔範圍）</p>`}
        ${m.ingredient && html`<p class="note">成分：${m.ingredient}
          ${m.leaflet_url && html`｜<a href=${m.leaflet_url} target="_blank" rel="noopener">仿單↗</a>`}</p>`}
        <${DispenseTimeline} items=${g.items} />
        <table><tr><th>日期</th><th>院所</th><th>總量</th><th>天數</th><th></th></tr>
          ${g.items.map((x) => html`<tr class="rowlink"
              onClick=${() => go("timeline", { enc: x.encounter_id })}>
            <td class="dt">${x.date}</td>
            <td class="dt">${x.facility_name}</td>
            <td class="num">${x.total_qty ?? ""}</td><td class="num">${x.days_supply ?? ""}</td>
            <td class="dt">看診紀錄 ›</td></tr>`)}
        </table>
        <p class="note">院所：${facs.join("、")}</p>
      </div>`}
    </div>`;
  }

  function Meds({ focus, go }) {
    const groups = useMemo(() => {
      const g = {};
      DATA.medications.forEach((m) => {
        const key = medKey(m);
        (g[key] = g[key] || { key, items: [], m }).items.push(m);
      });
      return Object.values(g).sort((a, b) => b.items.length - a.items.length);
    }, []);
    const focusGroup = focus && focus.med ? groups.find((g) => g.key === focus.med) : null;
    const [openKey, setOpenKey] = useState(focusGroup ? focusGroup.key : null);
    const [cat, setCat] = useState(focusGroup ? medCategory(focusGroup.m) : "drug");
    const byCat = (c) => groups.filter((g) => medCategory(g.m) === c);
    useEffect(() => {
      if (focusGroup) {
        const el = document.querySelector(".event.open");
        if (el) el.scrollIntoView({ block: "start" });
      }
    }, []);
    return html`<section>
      <div class="filters">
        ${MED_CATS.map(([c, label]) => html`<button
          class="catbtn ${cat === c ? "on" : ""}"
          onClick=${() => { setCat(c); setOpenKey(null); }}>${label}（${byCat(c).length}）</button>`)}
      </div>
      <p class="note">藥品資訊來自健保用藥品項檔（版本
        ${DATA.meta.drug_cache ? DATA.meta.drug_cache.updated_at : "未建快取"}）；
        點列展開處方時間軸。</p>
      ${byCat(cat).map((g) => html`<${MedGroup} g=${g} open=${openKey === g.key} go=${go}
        onToggle=${() => setOpenKey(openKey === g.key ? null : g.key)} />`)}
    </section>`;
  }

  /* ---------- 趨勢 ---------- */
  function parseRef(s) {
    const m = /\[?\s*[+]?(-?\d+\.?\d*)\s*[-–~]\s*[+]?(-?\d+\.?\d*)\s*\]?/.exec(s || "");
    return m ? [parseFloat(m[1]), parseFloat(m[2])] : null;
  }

  /* 趨勢序列集合：時間域下界、today 與預設區間判定皆以此為準。
     MUST 含全部檢驗項目而非下拉當前選中者，否則切換檢驗項目會連帶
     位移另外三張圖的 x 軸。 */
  function trendBounds() {
    const groups = [
      DATA.measures["體重"] || [],
      // CPAP 日期要納入共用時間域，否則新圖的 x 軸與同頁其他圖不一致
      cpapSeries("ahi"),
      DATA.nhi_body.filter((b) => b.weight_kg).map((b) => [b.check_date, b.weight_kg]),
      DATA.measures["收縮壓"] || [],
      DATA.measures["舒張壓"] || [],
      DATA.activity["步數"] || [],
      DATA.labs.filter((l) => l.value_numeric != null).map((l) => [l.test_date, l.value_numeric]),
    ];
    const ts = groups.flat().map((p) => tsOf(p[0])).filter((t) => !Number.isNaN(t));
    const gen = tsOf(DATA.meta.generated_at);
    const latest = ts.length ? Math.max(...ts) : NaN;
    // 上界取 generated_at 與資料最新日期的較大者：兩端 generated_at 的
    // 產生方式曾不一致，且最新一筆可能晚於它，取小的會靜默隱藏該筆
    const cands = [gen, latest].filter((t) => !Number.isNaN(t));
    const today = cands.length ? Math.max(...cands) : Date.parse("2000-01-01");
    return { today, latest, earliest: ts.length ? Math.min(...ts) : today };
  }

  const RANGES = [["3m", "近三月", 90], ["1y", "近一年", 365], ["all", "全部", null]];
  function rangeDomain(key, today, earliest) {
    const r = RANGES.find(([k]) => k === key) || RANGES[2];
    return { tMin: r[2] == null ? earliest : today - r[2] * DAY, tMax: today };
  }
  /* 整體資料已停止數年時預設「全部」，否則會全頁皆空 */
  function defaultRange(today, latest) {
    return !Number.isNaN(latest) && today - latest <= 90 * DAY ? "1y" : "all";
  }

  function Trends({ focus }) {
    const labNames = useMemo(() => {
      const names = {};
      DATA.labs.forEach((l) => (names[l.name] = names[l.name] || []).push(l));
      return Object.entries(names).sort((a, b) => b[1].length - a[1].length);
    }, []);
    const init = focus && focus.lab && labNames.some(([n]) => n === focus.lab)
      ? focus.lab : (labNames.length ? labNames[0][0] : "");
    const [sel, setSel] = useState(init);
    const { today, latest, earliest } = useMemo(trendBounds, []);
    const [range, setRange] = useState(() => defaultRange(today, latest));
    const dom = rangeDomain(range, today, earliest);
    const showAll = range === "all" ? null : () => setRange("all");
    const rangeLabel = (RANGES.find(([k]) => k === range) || [])[1];
    const rows = (labNames.find(([n]) => n === sel) || [null, []])[1];
    const numRows = rows.filter((l) => l.value_numeric != null);
    const ref = numRows.length ? parseRef(numRows[numRows.length - 1].ref_range) : null;
    // 檢驗在當前區間內有無數值點（無則不印灰帶說明，避免說明沒有的東西）
    const labInRange = inRange(numRows.map((l) => [l.test_date, l.value_numeric]),
      dom.tMin, dom.tMax).length > 0;
    const know = DATA.knowledge[sel];
    const weightSeries = [
      { label: "體重（自主量測）", color: "var(--s1)", points: DATA.measures["體重"] || [] },
      { label: "成健", color: "var(--s2)", marker: 6, stroke: "var(--card)",
        points: DATA.nhi_body.filter((b) => b.weight_kg).map((b) => [b.check_date, b.weight_kg]) },
    ];
    const bpSeries = [
      { label: "收縮壓", color: "var(--s1)", points: DATA.measures["收縮壓"] || [] },
      { label: "舒張壓", color: "var(--s2)", points: DATA.measures["舒張壓"] || [] },
    ];
    return html`<section>
      <div class="filters">
        ${RANGES.map(([k, label]) => html`<button class="catbtn ${range === k ? "on" : ""}"
          onClick=${() => setRange(k)}>${label}</button>`)}
        <span class="note">四張圖共用同一時間區間，可直接同期對照</span>
      </div>
      <h2>檢驗趨勢</h2>
      <div class="filters"><select value=${sel} onChange=${(e) => setSel(e.target.value)}>
        ${labNames.map(([n, arr]) => html`<option value=${n}>${n}（${arr.length} 筆）</option>`)}
      </select></div>
      ${numRows.length > 0
        ? html`<${LineChart} unit="" refRange=${ref} domain=${dom} onShowAll=${showAll} rangeLabel=${rangeLabel}
            series=${[{ label: sel, color: "var(--s1)",
                        points: numRows.map((l) => [l.test_date, l.value_numeric]) }]} />`
        : html`<p class="note">此項目為文字型結果，僅列表不繪圖。</p>`}
      ${ref && labInRange && html`<p class="note">灰帶為最近一次報告之參考值區間 ${numRows[numRows.length - 1].ref_range}</p>`}
      ${know && html`<p class="know">${know.description}<br />
        <span class="dt">來源：<a href=${know.source_url} target="_blank" rel="noopener">${know.source_name}</a>
        （引用日期 ${know.cited_date}）</span></p>`}
      <table><tr><th>日期</th><th>數值</th><th>參考值</th><th>院所</th></tr>
        ${rows.slice().reverse().map((l) => html`<tr><td class="dt">${l.test_date}</td>
          <td class="num">${l.value_text}${l.unmapped ? html` <span class="flag">unmapped</span>` : ""}</td>
          <td class="dt">${l.ref_range || "—"}</td><td class="dt">${l.facility_name}</td></tr>`)}</table>
      <h2>體重（Apple 每日中位數＋健保成健標記）</h2>
      <${LineChart} unit="kg" series=${weightSeries} domain=${dom} onShowAll=${showAll} rangeLabel=${rangeLabel} />
      <h2>血壓（每日中位數）</h2>
      <${LineChart} unit="mmHg" series=${bpSeries} domain=${dom} onShowAll=${showAll} rangeLabel=${rangeLabel} />
      ${HAS_CPAP && html`<h2>每晚 AHI（睡眠呼吸）</h2>
        <${LineChart} unit="次/小時" domain=${dom} onShowAll=${showAll} rangeLabel=${rangeLabel}
          note="日期為入睡當晚；與上方體重圖共用同一時間區間，可直接同期對照"
          series=${[{ label: "AHI", color: "var(--s3)", points: cpapSeries("ahi") }]} />`}
      <h2>日均步數（每日單一來源最大值）</h2>
      <${LineChart} unit="步" domain=${dom} onShowAll=${showAll} rangeLabel=${rangeLabel}
        note=${range === "3m" ? "逐日" : "月平均"}
        series=${[{ label: "日均步數", color: "var(--s1)",
          points: range === "3m" ? (DATA.activity["步數"] || [])
            : monthlyAvg(DATA.activity["步數"] || []) }]} />
    </section>`;
  }

  /* ---------- 睡眠呼吸分頁 ---------- */
  // 只顯示不解讀：不對 AHI 等指標下任何判定性描述（假設 #66）
  function Sleep() {
    const { today, latest, earliest } = useMemo(trendBounds, []);
    const [range, setRange] = useState(() => defaultRange(today, latest));
    const [breakdown, setBreakdown] = useState(false);
    const dom = rangeDomain(range, today, earliest);
    const showAll = range === "all" ? null : () => setRange("all");
    const rangeLabel = (RANGES.find(([k]) => k === range) || [])[1];

    const ahiSeries = [{ label: "AHI", color: "var(--s3)", points: cpapSeries("ahi") }];
    if (breakdown) {
      ahiSeries.push(
        { label: "阻塞", color: "var(--s1)", points: cpapSeries("oai") },
        { label: "中樞", color: "var(--s2)", points: cpapSeries("cai") },
        { label: "低通氣", color: "var(--s4)", points: cpapSeries("hi") });
    }
    const oxi = CPAP.oximetry || [];
    const events = CPAP.events || [];
    const devices = [...new Set(CPAP_DAILY.map((r) => r.device))].filter(Boolean);
    const nights = CPAP_DAILY.length;
    const usageSeries = [{ label: "使用時數", color: "var(--s1)",
      points: CPAP_DAILY.filter((r) => r.usage_min != null)
        .map((r) => [r.date, Math.round((r.usage_min / 60) * 10) / 10]) }];

    return html`<section>
      <div class="filters">
        ${RANGES.map(([k, label]) => html`<button class="catbtn ${range === k ? "on" : ""}"
          onClick=${() => setRange(k)}>${label}</button>`)}
        <span class="note">有紀錄的夜晚 ${nights} 晚${devices.length ? `｜機型 ${devices.join("、")}` : ""}</span>
      </div>
      <h2>每晚 AHI</h2>
      <div class="filters">
        <button class="catbtn ${breakdown ? "on" : ""}"
          onClick=${() => setBreakdown(!breakdown)}>顯示分項（阻塞／中樞／低通氣）</button>
      </div>
      <${LineChart} unit="次/小時" series=${ahiSeries} domain=${dom}
        onShowAll=${showAll} rangeLabel=${rangeLabel}
        note="日期為入睡當晚（一個治療夜自正午起算）" />
      <h2>使用時數</h2>
      <${LineChart} unit="小時" series=${usageSeries} domain=${dom}
        onShowAll=${showAll} rangeLabel=${rangeLabel}
        note="未使用機器的日子不列入，不畫成 0" />
      <h2>漏氣（95 百分位）</h2>
      <${LineChart} unit="L/s" domain=${dom} onShowAll=${showAll} rangeLabel=${rangeLabel}
        series=${[{ label: "漏氣", color: "var(--s2)", points: cpapSeries("leak_95") }]} />
      <h2>治療壓力（95 百分位）</h2>
      ${/* 與漏氣分成兩張圖而非疊在一起：兩者單位與數量級都不同（漏氣約
           0-1 L/s、壓力約 6-8 cmH2O），LineChart 只有單一 y 軸，疊在一起
           會把漏氣線壓成貼底的平線。同 design D10 否決雙軸圖的理由。 */""}
      <${LineChart} unit="cmH2O" domain=${dom} onShowAll=${showAll} rangeLabel=${rangeLabel}
        series=${[{ label: "壓力", color: "var(--s4)", points: cpapSeries("pressure_95") }]} />
      <h2>睡眠期血氧</h2>
      ${oxi.length
        ? html`<${LineChart} unit="%" domain=${dom} onShowAll=${showAll} rangeLabel=${rangeLabel}
            note="每晚一點：整晚最低與平均"
            series=${[
              { label: "最低", color: "var(--s2)", points: oxi.map((r) => [r.date, r.spo2_min]) },
              { label: "平均", color: "var(--s1)", points: oxi.map((r) => [r.date, r.spo2_mean]) },
            ]} />`
        : html`<p class="note">此來源沒有血氧資料。血氧需要機器外接血氧模組才會記錄。</p>`}
      <h2>呼吸事件${CPAP.events_truncated ? `（共 ${CPAP.events_total} 筆，以下列最近 ${events.length} 筆）` : `（${events.length} 筆）`}</h2>
      ${events.length
        ? html`<table><tr><th>入睡日</th><th>時刻</th><th>類型</th><th>持續</th></tr>
            ${events.slice().reverse().slice(0, 300).map((e) => html`<tr>
              <td class="dt">${e.session_date}</td>
              <td class="dt">${(e.start_ts || "").slice(11, 19)}</td>
              <td>${e.event_type}</td>
              <td class="num">${e.duration_sec != null ? `${e.duration_sec} 秒` : "—"}</td></tr>`)}
          </table>
          ${events.length > 300 && html`<p class="note">表格僅列最近 300 筆，圖表仍涵蓋全部區間。</p>`}`
        : html`<p class="note">此來源沒有逐次事件紀錄（僅有每日摘要）。</p>`}
    </section>`;
  }

  function monthlyAvg(daily) {
    const b = {};
    daily.forEach(([d, v]) => { const m = d.slice(0, 7); (b[m] = b[m] || []).push(v); });
    return Object.entries(b).sort().map(([m, vs]) =>
      [m, Math.round(vs.reduce((s, x) => s + x, 0) / vs.length)]);
  }

  /* ---------- 搜尋（結果全面可點選跳轉） ---------- */
  function Search({ q, go }) {
    const needle = q.trim().toLowerCase();
    const res = useMemo(() => {
      if (!needle) return null;
      const has = (s) => (s || "").toLowerCase().includes(needle);
      return {
        encounters: DATA.encounters.filter((e) => has(e.facility_name) || has(e.dx_name)),
        medications: DATA.medications.filter((m) => has(m.order_name) || has(m.drug_zh) || has(m.ingredient)),
        labs: DATA.labs.filter((l) => has(l.name) || has(l.test_name_raw) || has(l.order_name)),
        reports: DATA.reports.filter((r) => has(r.report_text) || has(r.order_name)),
      };
    }, [needle]);
    if (!res) return html`<p class="note">輸入院所、診斷、藥名、檢驗名或報告文字。</p>`;
    const medGroups = [...new Map(res.medications.map((m) => [medKey(m), m])).values()];
    const labGroups = [...new Map(res.labs.map((l) => [l.name, l])).values()];
    return html`<section>
      <h2>就醫（${res.encounters.length}）</h2>
      <div class="card">${res.encounters.slice(0, 20).map((e) => html`
        <div class="rowlink srow" onClick=${() => go("timeline", { enc: e.id })}>
          <span class="dt">${e.date}</span> <${Chip} type=${e.type} />
          <span> ${e.facility_name}：${e.dx_name || ""}</span><span class="go">›</span></div>`)}
        ${!res.encounters.length && html`<p class="note">無符合</p>`}</div>
      <h2>用藥（${medGroups.length} 項）</h2>
      <div class="card">${medGroups.slice(0, 20).map((m) => html`
        <div class="rowlink srow" onClick=${() => go("meds", { med: medKey(m) })}>
          <span>${m.drug_zh || m.order_name}</span>
          <span class="dt">${m.ingredient || ""}</span><span class="go">›</span></div>`)}
        ${!medGroups.length && html`<p class="note">無符合</p>`}</div>
      <h2>檢驗（${labGroups.length} 項）</h2>
      <div class="card">${labGroups.slice(0, 20).map((l) => html`
        <div class="rowlink srow" onClick=${() => go("trends", { lab: l.name })}>
          <span>${l.name}</span>
          <span class="dt">最近 ${l.test_date}＝${l.value_text}</span><span class="go">›</span></div>`)}
        ${!labGroups.length && html`<p class="note">無符合</p>`}</div>
      <h2>影像病理報告（${res.reports.length}）</h2>
      <div class="card">${res.reports.slice(0, 10).map((r) => html`<details><summary>
        <span class="dt">${r.test_date}</span> ${r.order_name}（${r.facility_name}）</summary>
        <pre class="report">${r.report_text}</pre></details>`)}
        ${!res.reports.length && html`<p class="note">無符合</p>`}</div>
    </section>`;
  }

  /* ---------- App ---------- */
  /* 錯誤邊界：單一分頁渲染拋錯只讓該頁顯示錯誤訊息，不拖垮整個 App
     （key 隨分頁切換重建，換頁即重試）。 */
  class Boundary extends preact.Component {
    componentDidCatch(err) { this.setState({ err }); }
    render() {
      if (this.state.err) return html`<section><p class="note">
        這個分頁載入失敗：${String(this.state.err)}。
        可切換其他分頁繼續使用；若持續發生，請回報此訊息文字。</p></section>`;
      return this.props.children;
    }
  }

  const TABS = [["overview", "總覽"], ["timeline", "就醫時間軸"], ["meds", "用藥"],
    ["trends", "趨勢"], ...(HAS_CPAP ? [["sleep", "睡眠呼吸"]] : [])];
  function App() {
    const [tab, setTab] = useState("overview");
    const [focus, setFocus] = useState(null);
    const [q, setQ] = useState("");
    const go = (t, payload) => { setTab(t); setFocus(payload || null); setQ(""); };
    const view = q.trim() ? html`<${Search} q=${q} go=${go} />`
      : tab === "overview" ? html`<${Overview} go=${go} />`
      : tab === "timeline" ? html`<${Timeline} key=${"t" + JSON.stringify(focus)} focus=${focus} />`
      : tab === "meds" ? html`<${Meds} key=${"m" + JSON.stringify(focus)} focus=${focus} go=${go} />`
      : tab === "sleep" ? html`<${Sleep} />`
      : html`<${Trends} key=${"r" + JSON.stringify(focus)} focus=${focus} />`;
    return html`<div>
      <header>
        <h1>${DATA.meta.profile ? DATA.meta.profile + " 的個人健康資料工作台" : "個人健康資料工作台"}</h1>
        <p class="disclaimer">本頁僅協助整理、搜尋與視覺化您自行提供的健康資料，不提供診斷、
          治療、用藥或其他醫療判斷建議；資料可能不完整或有格式誤差，如有醫療問題請諮詢
          合格醫事人員。<b>本檔含個人醫療資料，請勿外傳。</b>
          資料截至 ${DATA.meta.generated_at}。</p>
        <div class="topbar">
          <nav>${TABS.map(([id, label]) => html`<button
            class=${tab === id && !q.trim() ? "active" : ""}
            onClick=${() => go(id)}>${label}</button>`)}</nav>
          <input type="search" placeholder="搜尋全部資料…" value=${q}
            onInput=${(e) => setQ(e.target.value)} />
        </div>
      </header>
      <${Boundary} key=${"b" + tab + "|" + q.trim() + "|" + JSON.stringify(focus)}>${view}</${Boundary}>
    </div>`;
  }

  const root = document.getElementById("app");
  root.textContent = "";
  render(html`<${App} />`, root);
})();
