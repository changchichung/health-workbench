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

  /* ---------- 總覽（洞察式摘要卡） ---------- */
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
    return html`<section>
      <div class="cards">
        <${Card} icon="⚖︎" color="var(--s1)" title="體重">
          ${w != null ? html`<div class="big">${w}<small> kg</small></div>
            <${Delta} d=${wd} unit=" kg（7日）" invert=${false} />`
            : html`<p class="note">尚無量測資料</p>`}
        </${Card}>
        <${Card} icon="♥" color="var(--s2)" title="血壓（最近量測日）">
          ${sys != null ? html`<div class="big">${sys}<small>/${dia}</small></div>
            <div class="delta flat">mmHg</div>` : html`<p class="note">尚無量測資料</p>`}
        </${Card}>
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
          <${LineChart} unit="kg" series=${[{ label: "體重", color: "var(--s1)",
            points: weightYear }]} />
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
        <${Card} wide icon="🗂" color="var(--ink2)" title="資料庫">
          <p class="note">就醫 ${c.encounters}｜用藥 ${c.medications}｜檢驗 ${c.lab_results}｜
            報告 ${c.reports}｜疫苗 ${c.immunizations}｜Apple 量測 ${c.apple_records.toLocaleString()}。
            來源：${DATA.meta.sources.map((s) => s.filename).join("、")}。</p>
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

  function Trends({ focus }) {
    const labNames = useMemo(() => {
      const names = {};
      DATA.labs.forEach((l) => (names[l.name] = names[l.name] || []).push(l));
      return Object.entries(names).sort((a, b) => b[1].length - a[1].length);
    }, []);
    const init = focus && focus.lab && labNames.some(([n]) => n === focus.lab)
      ? focus.lab : (labNames.length ? labNames[0][0] : "");
    const [sel, setSel] = useState(init);
    const rows = (labNames.find(([n]) => n === sel) || [null, []])[1];
    const numRows = rows.filter((l) => l.value_numeric != null);
    const ref = numRows.length ? parseRef(numRows[numRows.length - 1].ref_range) : null;
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
      <h2>日均步數（每日單一來源最大值，月平均）</h2>
      <${LineChart} unit="步" series=${[{ label: "日均步數", color: "var(--s1)",
        points: monthlyAvg(DATA.activity["步數"] || []) }]} />
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
  const TABS = [["overview", "總覽"], ["timeline", "就醫時間軸"], ["meds", "用藥"], ["trends", "趨勢"]];
  function App() {
    const [tab, setTab] = useState("overview");
    const [focus, setFocus] = useState(null);
    const [q, setQ] = useState("");
    const go = (t, payload) => { setTab(t); setFocus(payload || null); setQ(""); };
    const view = q.trim() ? html`<${Search} q=${q} go=${go} />`
      : tab === "overview" ? html`<${Overview} go=${go} />`
      : tab === "timeline" ? html`<${Timeline} key=${"t" + JSON.stringify(focus)} focus=${focus} />`
      : tab === "meds" ? html`<${Meds} key=${"m" + JSON.stringify(focus)} focus=${focus} go=${go} />`
      : html`<${Trends} key=${"r" + JSON.stringify(focus)} focus=${focus} />`;
    return html`<div>
      <header>
        <h1>個人健康資料工作台</h1>
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
      ${view}
    </div>`;
  }

  const root = document.getElementById("app");
  root.textContent = "";
  render(html`<${App} />`, root);
})();
