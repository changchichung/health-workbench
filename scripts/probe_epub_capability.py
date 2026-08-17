#!/usr/bin/env python3
"""產一顆最小 EPUB 3，用來實測 Apple Books 對 scripted content 的支援程度。

分層診斷：載入即執行 → 事件處理 → 動態 SVG → 狀態重繪，四層各自 PASS/FAIL，
才知道匯出格式改用 EPUB 之後哪些互動保得住（本專案的互動分兩類：跳轉類與
狀態類，後者需要第 2、4 層都通）。

零依賴：只用標準庫 zipfile。mimetype MUST 是第一個項目且不壓縮（EPUB 規範）。
manifest 的 XHTML MUST 標 properties="scripted"，否則閱讀器可以合法地不執行。
"""
import zipfile, pathlib, sys

OUT = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else "epub-js-test.epub")

CONTAINER = '''<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>'''

OPF = '''<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="bookid">urn:uuid:mhb-epub-js-probe-20260817</dc:identifier>
    <dc:title>EPUB 互動能力測試</dc:title>
    <dc:language>zh-TW</dc:language>
    <dc:creator>MyHealthBank</dc:creator>
    <meta property="dcterms:modified">2026-08-17T00:00:00Z</meta>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="probe" href="probe.xhtml" media-type="application/xhtml+xml" properties="scripted svg"/>
  </manifest>
  <spine>
    <itemref idref="probe"/>
  </spine>
</package>'''

NAV = '''<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="zh-TW">
<head><meta charset="utf-8"/><title>目錄</title></head>
<body>
  <nav epub:type="toc" id="toc"><h1>目錄</h1>
    <ol><li><a href="probe.xhtml">互動能力測試</a></li></ol>
  </nav>
</body>
</html>'''

PROBE = '''<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="zh-TW">
<head>
<meta charset="utf-8"/>
<title>互動能力測試</title>
<style>
  body { font-family: -apple-system, "PingFang TC", sans-serif; line-height: 1.7; padding: 1em; }
  h1 { font-size: 1.3em; }
  .row { margin: 0.9em 0; padding: 0.7em; border: 1px solid #ccc; border-radius: 6px; }
  .label { font-weight: bold; }
  .verdict { font-size: 1.1em; }
  .fail { color: #b00; }
  .pass { color: #070; }
  button { font-size: 1em; padding: 0.5em 1em; margin-top: 0.4em; }
  .note { color: #666; font-size: 0.9em; }
</style>
</head>
<body>
<h1>EPUB 互動能力測試</h1>
<p class="note">這四項各自獨立。把看到的結果告訴我即可，不需要全部都通。</p>

<div class="row">
  <div class="label">1. 載入時自動執行 JS</div>
  <div id="t1" class="verdict fail">FAIL：這行字沒有被改寫，代表 JS 完全沒有執行</div>
</div>

<div class="row">
  <div class="label">2. 事件處理（摺疊展開靠這個）</div>
  <div id="t2" class="verdict fail">尚未測試：請按下面的按鈕</div>
  <button id="btn">點我</button>
</div>

<div class="row">
  <div class="label">3. 動態繪製 SVG（趨勢圖靠這個）</div>
  <div id="t3" class="verdict fail">FAIL：下方沒有出現折線圖</div>
  <div id="chart"></div>
</div>

<div class="row">
  <div class="label">4. 狀態重繪（切換區間、展開分項靠這個）</div>
  <div id="t4" class="verdict fail">尚未測試：請按下面的按鈕切換</div>
  <button id="btn2">切換區間</button>
  <div id="series"></div>
</div>

<div class="row">
  <div class="label">閱讀器資訊</div>
  <div id="info" class="note">（若 JS 沒執行，這裡會是空的）</div>
</div>

<script><![CDATA[
(function () {
  function set(id, text, ok) {
    var el = document.getElementById(id);
    if (!el) return;
    el.textContent = (ok ? "PASS：" : "FAIL：") + text;
    el.className = "verdict " + (ok ? "pass" : "fail");
  }

  // 1. 載入即執行
  set("t1", "JS 有執行", true);

  // 2. 事件處理
  var n = 0;
  var btn = document.getElementById("btn");
  if (btn) {
    btn.addEventListener("click", function () {
      n += 1;
      set("t2", "按鈕有反應，已點 " + n + " 次", true);
    });
  }

  // 3. 動態繪製 SVG
  try {
    var NS = "http://www.w3.org/2000/svg";
    var svg = document.createElementNS(NS, "svg");
    svg.setAttribute("viewBox", "0 0 300 80");
    svg.setAttribute("width", "100%");
    svg.setAttribute("height", "80");
    var poly = document.createElementNS(NS, "polyline");
    poly.setAttribute("fill", "none");
    poly.setAttribute("stroke", "#070");
    poly.setAttribute("stroke-width", "2");
    poly.setAttribute("points", "0,60 60,40 120,50 180,20 240,30 300,10");
    svg.appendChild(poly);
    document.getElementById("chart").appendChild(svg);
    set("t3", "SVG 有畫出來（下方應有一條綠色折線）", true);
  } catch (e) {
    set("t3", "SVG 繪製丟出例外：" + e.message, false);
  }

  // 4. 狀態重繪
  var ranges = ["近三月", "近一年", "全部"];
  var i = 0;
  function render() {
    var el = document.getElementById("series");
    if (!el) return;
    el.textContent = "目前區間：" + ranges[i] + "（點按鈕會換）";
  }
  var btn2 = document.getElementById("btn2");
  if (btn2) {
    btn2.addEventListener("click", function () {
      i = (i + 1) % ranges.length;
      render();
      set("t4", "重繪成功，目前是「" + ranges[i] + "」", true);
    });
  }
  render();

  // 閱讀器資訊
  var info = document.getElementById("info");
  var rs = navigator.epubReadingSystem;
  var parts = [];
  if (rs) {
    parts.push("閱讀系統：" + (rs.name || "?") + " " + (rs.version || ""));
    ["dom-manipulation", "layout-changes", "touch-events", "mouse-events"].forEach(function (f) {
      try { parts.push(f + "=" + rs.hasFeature(f)); } catch (e) { parts.push(f + "=?"); }
    });
  } else {
    parts.push("navigator.epubReadingSystem 不存在（不影響其他測試的判讀）");
  }
  parts.push("UA：" + navigator.userAgent);
  info.textContent = parts.join("　|　");
})();
]]></script>
</body>
</html>'''

with zipfile.ZipFile(OUT, "w") as z:
    # mimetype MUST 第一個且 STORED（不壓縮），否則部分閱讀器拒絕開啟
    z.writestr(zipfile.ZipInfo("mimetype"), "application/epub+zip",
               compress_type=zipfile.ZIP_STORED)
    z.writestr("META-INF/container.xml", CONTAINER, zipfile.ZIP_DEFLATED)
    z.writestr("OEBPS/content.opf", OPF, zipfile.ZIP_DEFLATED)
    z.writestr("OEBPS/nav.xhtml", NAV, zipfile.ZIP_DEFLATED)
    z.writestr("OEBPS/probe.xhtml", PROBE, zipfile.ZIP_DEFLATED)

print("已產生:", OUT.resolve())
