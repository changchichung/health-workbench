/* mhb dashboard 前端：總覽 / 時間軸 / 用藥 / 趨勢 ＋ 全文搜尋。
   Preact + htm（vendored），零執行期網路請求；外部連結僅使用者點擊才離開。 */
(function () {
  "use strict";
  const DATA = JSON.parse(document.getElementById("mhb-data").textContent);
  const { h, render } = preact;
  const { useState, useMemo } = preactHooks;
  const html = htm.bind(h);

  const TYPE_META = {
    western_outpatient: ["西醫門診", "var(--s1)"],
    tcm: ["中醫門診", "var(--s2)"],
    dental: ["牙醫門診", "var(--s3)"],
    pharmacy_dispensing: ["藥局調劑", "var(--s4)"],
  };
  const fmtType = (t) => (TYPE_META[t] || [t, "var(--ink2)"])[0];
  const typeColor = (t) => (TYPE_META[t] || [t, "var(--ink2)"])[1];

  /* ---------- 共用元件 ---------- */
  function Tile({ value, label, unit }) {
    return html`<div class="tile"><div class="tv">${value}<small> ${unit || ""}</small></div>
      <div class="tl">${label}</div></div>`;
  }

  function Chip({ type }) {
    return html`<span class="chip" style="background:${typeColor(type)}"></span>${fmtType(type)}`;
  }

  /* SVG 折線圖：series = [{label, color, points:[[date,val],…]}]，可選 refRange=[lo,hi] */
  function LineChart({ series, unit, refRange }) {
    const all = series.flatMap((s) => s.points);
    if (!all.length) return html`<p class="note">無資料</p>`;
    const dates = [...new Set(all.map((p) => p[0]))].sort();
    const vals = all.map((p) => p[1]);
    let lo = Math.min(...vals), hi = Math.max(...vals);
    if (refRange) { lo = Math.min(lo, refRange[0]); hi = Math.max(hi, refRange[1]); }
    const pad = (hi - lo) * 0.08 || 1; lo -= pad; hi += pad;
    const W = 860, H = 240, PL = 48, PB = 28, PT = 10, PR = 100;
    const x = (d) => PL + dates.indexOf(d) * ((W - PL - PR) / Math.max(dates.length - 1, 1));
    const y = (v) => PT + (H - PB - PT) - ((v - lo) / (hi - lo)) * (H - PB - PT);
    const gridN = 4, grid = [];
    for (let i = 0; i <= gridN; i++) {
      const v = lo + ((hi - lo) * i) / gridN;
      grid.push(html`<line x1=${PL} y1=${y(v)} x2=${W - 8} y2=${y(v)} class="grid" />
        <text x=${PL - 6} y=${y(v) + 4} class="ax" text-anchor="end">${v.toFixed(v > 99 ? 0 : 1)}</text>`);
    }
    const step = Math.max(Math.floor(dates.length / 7), 1);
    const xlab = dates.filter((_, i) => i % step === 0).map((d) =>
      html`<text x=${x(d)} y=${H - 8} class="ax" text-anchor="middle">${d.slice(2, 7)}</text>`);
    const band = refRange ? html`<rect x=${PL} y=${y(refRange[1])} width=${W - PL - PR}
        height=${Math.max(y(refRange[0]) - y(refRange[1]), 1)} class="refband" />` : null;
    return html`<div class="chartwrap"><svg viewBox="0 0 ${W} ${H}" width=${W} role="img">
      ${band}${grid}${xlab}
      ${series.map((s) => {
        const pts = s.points.map((p) => `${x(p[0])},${y(p[1])}`).join(" ");
        const last = s.points[s.points.length - 1];
        return html`<g>
          ${s.points.length > 1 && html`<polyline points=${pts} fill="none" stroke=${s.color} stroke-width="2" />`}
          ${s.points.map((p) => html`<circle cx=${x(p[0])} cy=${y(p[1])} r=${s.marker || (s.points.length > 400 ? 1.5 : 3)}
              fill=${s.color} stroke=${s.stroke || "none"} stroke-width="2">
            <title>${s.label} ${p[0]}：${p[1]} ${unit || ""}</title></circle>`)}
          <text x=${x(last[0]) + 8} y=${y(last[1]) + 4} class="ax" fill=${s.color}>
            ${s.label.length > 10 ? s.label.slice(0, 9) + "…" : s.label} ${last[1]}</text></g>`;
      })}</svg></div>`;
  }

  /* ---------- 總覽 ---------- */
  function Overview({ go }) {
    const c = DATA.meta.counts;
    const encs = DATA.encounters.slice(0, 10);
    return html`<section>
      <div class="tiles">
        <${Tile} value=${c.encounters} label="就醫事件" />
        <${Tile} value=${c.medications} label="用藥明細" />
        <${Tile} value=${c.lab_results} label="檢驗結果" />
        <${Tile} value=${c.reports} label="影像病理報告" />
        <${Tile} value=${c.immunizations} label="疫苗接種" />
        <${Tile} value=${c.apple_records.toLocaleString()} label="Apple 量測" />
      </div>
      <h2>資料來源</h2>
      <table><tr><th>檔案</th><th>adapter</th><th>匯入時間</th></tr>
        ${DATA.meta.sources.map((s) => html`<tr><td>${s.filename}</td>
          <td>${s.adapter}</td><td class="dt">${s.imported_at}</td></tr>`)}</table>
      <h2>最近就醫</h2>
      <table><tr><th>日期</th><th>類型</th><th>院所</th><th>主診斷</th></tr>
        ${encs.map((e) => html`<tr class="rowlink" onClick=${() => go("timeline", e.id)}>
          <td class="dt">${e.date}</td><td><${Chip} type=${e.type} /></td>
          <td>${e.facility_name}</td><td>${e.dx_name || ""}</td></tr>`)}</table>
    </section>`;
  }

  /* ---------- 時間軸 ---------- */
  function Timeline({ focusId }) {
    const [type, setType] = useState("");
    const [fac, setFac] = useState("");
    const [open, setOpen] = useState(focusId || null);
    const facilities = useMemo(
      () => [...new Set(DATA.encounters.map((e) => e.facility_name).filter(Boolean))].sort(), []);
    const list = DATA.encounters.filter(
      (e) => (!type || e.type === type) && (!fac || e.facility_name === fac));
    const medById = useMemo(() => {
      const m = {}; DATA.medications.forEach((x) => (m[x.id] = x)); return m;
    }, []);
    return html`<section>
      <div class="filters">
        <select value=${type} onChange=${(e) => setType(e.target.value)}>
          <option value="">全部類型</option>
          ${Object.keys(TYPE_META).map((t) => html`<option value=${t}>${fmtType(t)}</option>`)}
        </select>
        <select value=${fac} onChange=${(e) => setFac(e.target.value)}>
          <option value="">全部院所</option>
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

  /* ---------- 用藥 ---------- */
  function Meds() {
    const groups = useMemo(() => {
      const g = {};
      DATA.medications.forEach((m) => {
        const key = m.order_code || m.order_name;
        (g[key] = g[key] || { items: [], m }).items.push(m);
      });
      return Object.values(g).sort((a, b) => b.items.length - a.items.length);
    }, []);
    return html`<section>
      <p class="note">同代號分組；藥品資訊來自健保用藥品項檔
        （版本 ${DATA.meta.drug_cache ? DATA.meta.drug_cache.updated_at : "未建快取"}），
        非藥品之診療醫令顯示原始名稱。</p>
      <table><tr><th>藥品/醫令</th><th>成分</th><th>次數</th><th>合計天數</th><th>最近</th><th>院所</th><th>仿單</th></tr>
      ${groups.map((g) => { const m = g.m;
        const days = g.items.reduce((s, x) => s + (x.days_supply || 0), 0);
        const facs = [...new Set(g.items.map((x) => x.facility_name))];
        return html`<tr><td>${m.drug_zh || m.order_name}</td>
          <td class="dt">${m.ingredient || ""}</td>
          <td class="num">${g.items.length}</td><td class="num">${days || ""}</td>
          <td class="dt">${g.items[0].date}</td><td class="dt">${facs.join("、")}</td>
          <td>${m.leaflet_url ? html`<a href=${m.leaflet_url} target="_blank" rel="noopener">仿單↗</a>` : ""}</td></tr>`; })}
      </table></section>`;
  }

  /* ---------- 趨勢 ---------- */
  function parseRef(s) {
    const m = /\[?\s*[+]?(-?\d+\.?\d*)\s*[-–~]\s*[+]?(-?\d+\.?\d*)\s*\]?/.exec(s || "");
    return m ? [parseFloat(m[1]), parseFloat(m[2])] : null;
  }

  function Trends() {
    const labNames = useMemo(() => {
      const names = {};
      DATA.labs.forEach((l) => (names[l.name] = names[l.name] || []).push(l));
      return Object.entries(names).sort((a, b) => b[1].length - a[1].length);
    }, []);
    const [sel, setSel] = useState(labNames.length ? labNames[0][0] : "");
    const rows = (labNames.find(([n]) => n === sel) || [null, []])[1];
    const numRows = rows.filter((l) => l.value_numeric != null);
    const ref = numRows.length ? parseRef(numRows[numRows.length - 1].ref_range) : null;
    const know = DATA.knowledge[sel];
    const weightSeries = [
      { label: "體重（自主量測）", color: "var(--s1)", points: DATA.measures["體重"] || [] },
      { label: "成健", color: "var(--s2)", marker: 6, stroke: "var(--sur)",
        points: DATA.nhi_body.filter((b) => b.weight_kg).map((b) => [b.check_date, b.weight_kg]) },
    ];
    const bpSeries = [
      { label: "收縮壓", color: "var(--s1)", points: DATA.measures["收縮壓"] || [] },
      { label: "舒張壓", color: "var(--s2)", points: DATA.measures["舒張壓"] || [] },
    ];
    return html`<section>
      <h2>檢驗趨勢</h2>
      <div class="filters"><select value=${sel} onChange=${(e) => setSel(e.target.value)}>
        ${labNames.map(([n, arr]) => html`<option value=${n}>${n}（${arr.length} 筆）</option>`)}
      </select></div>
      ${numRows.length > 0
        ? html`<${LineChart} unit="" refRange=${ref}
            series=${[{ label: sel, color: "var(--s1)",
                        points: numRows.map((l) => [l.test_date, l.value_numeric]) }]} />`
        : html`<p class="note">此項目為文字型結果，僅列表不繪圖。</p>`}
      ${ref && html`<p class="note">灰帶為最近一次報告之參考值區間 ${numRows[numRows.length - 1].ref_range}</p>`}
      ${know && html`<p class="know">${know.description}<br />
        <span class="dt">來源：<a href=${know.source_url} target="_blank" rel="noopener">${know.source_name}</a>
        （引用日期 ${know.cited_date}）</span></p>`}
      <table><tr><th>日期</th><th>數值</th><th>參考值</th><th>院所</th></tr>
        ${rows.slice().reverse().map((l) => html`<tr><td class="dt">${l.test_date}</td>
          <td class="num">${l.value_text}${l.unmapped ? html` <span class="flag">unmapped</span>` : ""}</td>
          <td class="dt">${l.ref_range || "—"}</td><td class="dt">${l.facility_name}</td></tr>`)}</table>
      <h2>體重（Apple 每日中位數＋健保成健標記）</h2>
      <${LineChart} unit="kg" series=${weightSeries} />
      <h2>血壓（每日中位數）</h2>
      <${LineChart} unit="mmHg" series=${bpSeries} />
      <h2>日均步數（每日單一來源最大值）</h2>
      <${LineChart} unit="步" series=${[{ label: "步數", color: "var(--s1)",
        points: monthlyAvg(DATA.activity["步數"] || []) }]} />
    </section>`;
  }

  function monthlyAvg(daily) {
    const b = {};
    daily.forEach(([d, v]) => { const m = d.slice(0, 7); (b[m] = b[m] || []).push(v); });
    return Object.entries(b).sort().map(([m, vs]) =>
      [m, Math.round(vs.reduce((s, x) => s + x, 0) / vs.length)]);
  }

  /* ---------- 搜尋 ---------- */
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
    return html`<section>
      <h2>就醫（${res.encounters.length}）</h2>
      ${res.encounters.slice(0, 20).map((e) => html`<div class="rowlink" onClick=${() => go("timeline", e.id)}>
        <span class="dt">${e.date}</span> <${Chip} type=${e.type} /> ${e.facility_name}：${e.dx_name || ""}</div>`)}
      <h2>用藥（${res.medications.length}）</h2>
      ${res.medications.slice(0, 20).map((m) => html`<div><span class="dt">${m.date}</span>
        ${m.drug_zh || m.order_name} <span class="dt">${m.facility_name}</span></div>`)}
      <h2>檢驗（${res.labs.length}）</h2>
      ${res.labs.slice(0, 20).map((l) => html`<div><span class="dt">${l.test_date}</span>
        ${l.name}＝${l.value_text} <span class="dt">${l.facility_name}</span></div>`)}
      <h2>影像病理報告（${res.reports.length}）</h2>
      ${res.reports.slice(0, 10).map((r) => html`<details><summary>
        <span class="dt">${r.test_date}</span> ${r.order_name}（${r.facility_name}）</summary>
        <pre class="report">${r.report_text}</pre></details>`)}
    </section>`;
  }

  /* ---------- App ---------- */
  const TABS = [["overview", "總覽"], ["timeline", "就醫時間軸"], ["meds", "用藥"], ["trends", "趨勢"]];
  function App() {
    const [tab, setTab] = useState("overview");
    const [focusId, setFocusId] = useState(null);
    const [q, setQ] = useState("");
    const go = (t, id) => { setTab(t); setFocusId(id); setQ(""); };
    const view = q.trim() ? html`<${Search} q=${q} go=${go} />`
      : tab === "overview" ? html`<${Overview} go=${go} />`
      : tab === "timeline" ? html`<${Timeline} focusId=${focusId} />`
      : tab === "meds" ? html`<${Meds} />`
      : html`<${Trends} />`;
    return html`<div>
      <header>
        <h1>個人健康資料工作台</h1>
        <p class="note">本頁僅協助整理、搜尋與視覺化您自行提供的健康資料，不提供診斷、
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
      ${view}
    </div>`;
  }

  const root = document.getElementById("app");
  root.textContent = "";  // 移除 no-JS fallback
  render(html`<${App} />`, root);
})();
