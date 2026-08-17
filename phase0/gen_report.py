#!/usr/bin/env python3
"""Phase 0：從 hwb.sqlite 產出本機 HTML 驗證報告（output/report.html）。
報告含個人醫療資料，只留本機，不得發佈或 commit。"""
import json
import sqlite3
from datetime import date
from pathlib import Path

OUT = Path(__file__).parent / "output"
con = sqlite3.connect(OUT / "hwb.sqlite")
con.row_factory = sqlite3.Row
cur = con.cursor()

TYPE_META = {  # 固定色序：slot1 藍、slot2 橘、slot3 aqua、slot4 黃
    "western_outpatient": ("西醫門診", "var(--s1)"),
    "tcm": ("中醫門診", "var(--s2)"),
    "dental": ("牙醫門診", "var(--s3)"),
    "pharmacy_dispensing": ("藥局調劑", "var(--s4)"),
}

# --- 月度就醫統計 ---
rows = cur.execute(
    "SELECT substr(date,1,7) ym, type, COUNT(*) n FROM encounters GROUP BY ym, type ORDER BY ym"
).fetchall()
months = sorted({r["ym"] for r in rows})
by_month = {m: {t: 0 for t in TYPE_META} for m in months}
for r in rows:
    by_month[r["ym"]][r["type"]] = r["n"]
max_total = max(sum(v.values()) for v in by_month.values())

# --- 檢驗：每項最新兩筆做變化表 ---
labs = cur.execute("""
    SELECT item_name, test_date, value_numeric, value_text, ref_range
    FROM lab_results WHERE item_name != '' AND value_numeric IS NOT NULL
    ORDER BY item_name, test_date""").fetchall()
lab_series = {}
for r in labs:
    lab_series.setdefault(r["item_name"], []).append(r)

# --- 身體數值（成健）---
bm = cur.execute("SELECT * FROM body_measurements ORDER BY check_date DESC LIMIT 1").fetchone()

# --- Apple Health：月中位數序列（抗離群），過濾佔位日期與量測異常 ---
def monthly_median(type_zh, lo, hi):
    rows = cur.execute("""
        SELECT substr(start_ts,1,7) ym, value_numeric v FROM apple_records
        WHERE type_zh=? AND start_ts>='2010' AND value_numeric BETWEEN ? AND ?
        ORDER BY ym""", (type_zh, lo, hi)).fetchall()
    buckets = {}
    for r in rows:
        buckets.setdefault(r["ym"], []).append(r["v"])
    return [(m, sorted(vs)[len(vs) // 2]) for m, vs in sorted(buckets.items())]

weight_series = monthly_median("體重", 30, 150)
bp_sys = monthly_median("收縮壓", 60, 250)
bp_dia = monthly_median("舒張壓", 30, 150)


def line_chart(series_list, unit, y_lo=None, y_hi=None):
    """series_list: [(label, color, [(ym, val)...])]；回傳含圖例的 SVG。"""
    all_m = sorted({m for _, _, s in series_list for m, _ in s})
    all_v = [v for _, _, s in series_list for _, v in s]
    if not all_v:
        return "<p class='note'>無資料</p>"
    y0 = y_lo if y_lo is not None else min(all_v) * 0.95
    y1 = y_hi if y_hi is not None else max(all_v) * 1.05
    W, H, PL, PB, PT = 900, 220, 44, 30, 10
    ph, pw = H - PB - PT, W - PL - 110
    mx = {m: PL + i * pw / max(len(all_m) - 1, 1) for i, m in enumerate(all_m)}
    my = lambda v: PT + ph - (v - y0) / (y1 - y0) * ph
    parts = []
    for gy in range(int(y0), int(y1) + 1, max(int((y1 - y0) / 4), 1)):
        parts.append(f'<line x1="{PL}" y1="{my(gy):.1f}" x2="{W-8}" y2="{my(gy):.1f}" class="grid"/>'
                     f'<text x="{PL-6}" y="{my(gy)+4:.1f}" class="ax" text-anchor="end">{gy}</text>')
    step = max(len(all_m) // 8, 1)
    for i, m in enumerate(all_m):
        if i % step == 0:
            parts.append(f'<text x="{mx[m]:.1f}" y="{H-8}" class="ax" text-anchor="middle">{m[2:]}</text>')
    for label, color, s in series_list:
        pts = " ".join(f"{mx[m]:.1f},{my(v):.1f}" for m, v in s)
        parts.append(f'<polyline points="{pts}" fill="none" stroke="{color}" stroke-width="2"/>')
        for m, v in s:
            parts.append(f'<circle cx="{mx[m]:.1f}" cy="{my(v):.1f}" r="3" fill="{color}">'
                         f'<title>{label} {m}：{v:g} {unit}</title></circle>')
        lm, lv = s[-1]
        parts.append(f'<text x="{mx[lm]+8:.1f}" y="{my(lv)+4:.1f}" class="ax" fill="{color}">{label} {lv:g}</text>')
    return (f'<div style="overflow-x:auto"><svg viewBox="0 0 {W} {H}" width="{W}" role="img">'
            + "".join(parts) + "</svg></div>")


# 步數：每日各來源分別加總取最大（避免 iPhone+手錶雙計），再取月平均
step_rows = cur.execute("""
    WITH daily AS (
      SELECT substr(start_ts,1,10) d, source_name, SUM(value_numeric) s
      FROM apple_records WHERE type_zh='步數' AND start_ts>='2010'
      GROUP BY d, source_name),
    best AS (SELECT d, MAX(s) steps FROM daily GROUP BY d)
    SELECT substr(d,1,7) ym, ROUND(AVG(steps)) FROM best GROUP BY ym ORDER BY ym""").fetchall()
steps_series = [(r[0], r[1]) for r in step_rows]
steps_chart = line_chart([("日均步數", "var(--s1)", steps_series)], "步")

weight_chart = line_chart([("體重", "var(--s1)", weight_series)], "kg")
if bm and bm["weight_kg"]:
    weight_chart += (f'<p class="note">成健檢查（{bm["check_date"]}）量得 {bm["weight_kg"]} kg，'
                     f'可與同期自主量測互相印證。來源：健保 r10。</p>')
bp_chart = line_chart([("收縮壓", "var(--s1)", bp_sys), ("舒張壓", "var(--s2)", bp_dia)], "mmHg")

# --- 最近就醫事件 ---
recent = cur.execute("""
    SELECT date, type, facility_name, dx_name FROM encounters
    ORDER BY date DESC LIMIT 12""").fetchall()

counts = {t: cur.execute(f"SELECT COUNT(*) FROM {t}").fetchone()[0]
          for t in ["encounters", "medications", "lab_results", "reports", "immunizations"]}
dmin, dmax = cur.execute("SELECT MIN(date), MAX(date) FROM encounters").fetchone()

# ---------- SVG 堆疊長條 ----------
W, H, PAD_L, PAD_B, PAD_T = max(720, len(months) * 22 + 60), 260, 36, 44, 10
plot_h = H - PAD_B - PAD_T
bw = 14
svg = []
for gy in range(0, max_total + 1, 2):
    y = PAD_T + plot_h - gy / max_total * plot_h
    svg.append(f'<line x1="{PAD_L}" y1="{y:.1f}" x2="{W-8}" y2="{y:.1f}" class="grid"/>')
    svg.append(f'<text x="{PAD_L-6}" y="{y+4:.1f}" class="ax" text-anchor="end">{gy}</text>')
for i, m in enumerate(months):
    x = PAD_L + 10 + i * ((W - PAD_L - 20) / len(months))
    y = PAD_T + plot_h
    total = sum(by_month[m].values())
    tip = f"{m}：共 {total} 次 " + " ".join(
        f"{TYPE_META[t][0]}{n}" for t, n in by_month[m].items() if n)
    parts = [f'<g class="bar"><title>{tip}</title>']
    for t, (label, color) in TYPE_META.items():
        n = by_month[m][t]
        if not n:
            continue
        h = n / max_total * plot_h - 2  # 2px surface gap
        y -= n / max_total * plot_h
        parts.append(
            f'<rect x="{x:.1f}" y="{y+1:.1f}" width="{bw}" height="{max(h,1):.1f}" rx="2" fill="{color}"/>')
    parts.append("</g>")
    svg.append("".join(parts))
    if i % 3 == 0:
        svg.append(
            f'<text x="{x+bw/2:.1f}" y="{H-PAD_B+16}" class="ax" text-anchor="middle">{m[2:]}</text>')
chart = (f'<div style="overflow-x:auto"><svg viewBox="0 0 {W} {H}" width="{W}" '
         f'role="img" aria-label="每月就醫次數堆疊長條圖">{"".join(svg)}</svg></div>')
legend = "".join(
    f'<span class="lg"><span class="sw" style="background:{c}"></span>{l}</span>'
    for l, c in TYPE_META.values())

# ---------- 檢驗變化表 ----------
lab_rows = []
for name, series in sorted(lab_series.items()):
    prev, last = (series[-2], series[-1]) if len(series) >= 2 else (None, series[-1])
    delta = ""
    if prev and prev["value_numeric"] and last["value_numeric"] is not None:
        d = last["value_numeric"] - prev["value_numeric"]
        arrow = "↑" if d > 0 else ("↓" if d < 0 else "→")
        delta = f'{arrow} {d:+g}'
    lab_rows.append(
        f"<tr><td>{name}</td>"
        f"<td class='num'>{prev['value_text'] if prev else '—'}<span class='dt'>{prev['test_date'] if prev else ''}</span></td>"
        f"<td class='num'>{last['value_text']}<span class='dt'>{last['test_date']}</span></td>"
        f"<td class='num'>{delta}</td><td class='dt'>{last['ref_range'] or '—'}</td></tr>")

# ---------- 身體數值 tiles ----------
tiles = ""
if bm:
    extra = json.loads(bm["extra_json"] or "{}")
    items = [("身高", bm["height_cm"], "cm"), ("體重", bm["weight_kg"], "kg"),
             ("BMI", bm["bmi"], ""), ("血壓", f'{bm["systolic"]}/{bm["diastolic"]}' if bm["systolic"] else None, "mmHg")]
    tiles = "".join(
        f'<div class="tile"><div class="tv">{v}<small> {u}</small></div><div class="tl">{k}</div></div>'
        for k, v, u in items if v)
    tiles += f'<div class="tile"><div class="tv">{bm["check_date"]}</div><div class="tl">成健檢查日（僅此一筆）</div></div>'

recent_rows = "".join(
    f'<tr><td class="dt">{r["date"]}</td>'
    f'<td><span class="chip" style="background:{TYPE_META[r["type"]][1]}"></span>{TYPE_META[r["type"]][0]}</td>'
    f'<td>{r["facility_name"] or ""}</td><td>{r["dx_name"] or ""}</td></tr>'
    for r in recent)

stat_tiles = "".join(
    f'<div class="tile"><div class="tv">{v}</div><div class="tl">{k}</div></div>'
    for k, v in [("就醫事件", counts["encounters"]), ("用藥明細", counts["medications"]),
                 ("檢驗結果", counts["lab_results"]), ("影像病理報告", counts["reports"]),
                 ("疫苗接種", counts["immunizations"])])

html = f"""<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>健康存摺 Phase 0 驗證報告</title><style>
:root {{ color-scheme: light dark;
  --s1:#2a78d6; --s2:#eb6834; --s3:#1baf7a; --s4:#eda100;
  --sur:#fcfcfb; --ink:#0b0b0b; --ink2:#52514e; --line:#e5e4e0; }}
@media (prefers-color-scheme: dark) {{ :root {{
  --s1:#3987e5; --s2:#d95926; --s3:#199e70; --s4:#c98500;
  --sur:#1a1a19; --ink:#fff; --ink2:#c3c2b7; --line:#3a3936; }} }}
body {{ margin:0; padding:24px; background:var(--sur); color:var(--ink);
  font:15px/1.6 -apple-system,"PingFang TC",sans-serif; max-width:960px; margin-inline:auto; }}
h1 {{ font-size:1.3em }} h2 {{ font-size:1.05em; margin-top:2em }}
.note {{ color:var(--ink2); font-size:.85em; border:1px solid var(--line);
  border-radius:8px; padding:10px 14px; }}
.tiles {{ display:flex; flex-wrap:wrap; gap:12px; margin:16px 0 }}
.tile {{ border:1px solid var(--line); border-radius:10px; padding:10px 16px; min-width:96px }}
.tv {{ font-size:1.5em; font-weight:650; font-variant-numeric:tabular-nums }}
.tv small {{ font-size:.55em; color:var(--ink2) }}
.tl {{ color:var(--ink2); font-size:.8em }}
.grid {{ stroke:var(--line); stroke-width:1 }}
.ax {{ fill:var(--ink2); font-size:11px }}
.lg {{ margin-right:14px; font-size:.85em; color:var(--ink2) }}
.sw,.chip {{ display:inline-block; width:10px; height:10px; border-radius:3px; margin-right:5px }}
table {{ border-collapse:collapse; width:100%; font-size:.9em }}
th,td {{ text-align:left; padding:6px 10px; border-bottom:1px solid var(--line) }}
th {{ color:var(--ink2); font-weight:500 }}
.num {{ font-variant-numeric:tabular-nums }}
.dt {{ color:var(--ink2); font-size:.85em; display:inline-block; margin-left:6px }}
.bar:hover rect {{ opacity:.8 }}
</style></head><body>
<h1>健康存摺個人資料：Phase 0 驗證報告</h1>
<p class="note">本頁僅為資料整理結果，不提供診斷、治療、用藥或其他醫療判斷建議；
實際診療資訊以醫事機構病歷為準。資料期間 {dmin} ～ {dmax}，
產生日期 {date.today().isoformat()}。本檔含個人資料，僅供本機檢視。</p>
<div class="tiles">{stat_tiles}</div>
<h2>每月就醫次數</h2>
<div>{legend}</div>{chart}
<h2>身體數值（成人預防保健）</h2>
<div class="tiles">{tiles or "<p class='note'>無資料</p>"}</div>
<h2>體重趨勢（Apple 健康，月中位數）</h2>
{weight_chart}
<h2>血壓趨勢（Apple 健康，月中位數）</h2>
{bp_chart}
<h2>日均步數（Apple 健康，月平均；每日取單一來源最大值避免重複計數）</h2>
{steps_chart}
<h2>檢驗數值變化（前次 → 最新）</h2>
<table><tr><th>項目</th><th>前次</th><th>最新</th><th>變化</th><th>參考值</th></tr>
{"".join(lab_rows)}</table>
<h2>最近就醫紀錄</h2>
<table><tr><th>日期</th><th>類型</th><th>院所</th><th>主診斷</th></tr>{recent_rows}</table>
</body></html>"""

(OUT / "report.html").write_text(html, encoding="utf-8")
print("written:", OUT / "report.html", f"({len(html)} bytes)")
