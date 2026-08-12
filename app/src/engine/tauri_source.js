// ByteSource 的 Tauri fs plugin 實作（App 端；Node 端見 tests/helpers/node_source.mjs）。
// readAt 每次開新 handle（seek+read+close），stream 用獨立 handle 順序讀。

export async function tauriFileSource(filePath, chunkSize = 4 * 1024 * 1024) {
  const fs = window.__TAURI__.fs;
  const st = await fs.stat(filePath);
  const name = filePath.split(/[/\\]/).pop();
  return {
    name,
    size: st.size,
    async readAt(offset, len) {
      const f = await fs.open(filePath, { read: true });
      try {
        await f.seek(offset, fs.SeekMode?.Start ?? 0);
        const buf = new Uint8Array(len);
        let filled = 0;
        while (filled < len) {
          const n = await f.read(buf.subarray(filled));
          if (n === null || n === 0) break;
          filled += n;
        }
        return buf.subarray(0, filled);
      } finally {
        await f.close();
      }
    },
    async *stream() {
      const f = await fs.open(filePath, { read: true });
      try {
        const buf = new Uint8Array(chunkSize);
        for (;;) {
          const n = await f.read(buf);
          if (n === null || n === 0) return;
          yield buf.slice(0, n);
        }
      } finally {
        await f.close();
      }
    },
  };
}

// 多檔來源（design D1／D9）：列出資料夾內的檔案供 registry.detectSet 判型。
// 判型階段只做 readDir，不 stat 也不讀內容；header 由 readHeader() 惰性取得，
// adapter 只讀自己需要的那幾個檔。實際的 ByteSource 等選定 adapter 後才建立
// （見 buildSourceSetTauri），含上千個檔案的資料夾才不會因為判型就付出
// 上千次 IO。
// maxEntries 是必要的防線而非最佳化：使用者可能選到 Downloads 這種大目錄，
// 無上限地列舉兩層會讓 UI 卡住。CPAP 的一張卡實測是數百個檔，5000 已極寬鬆；
// 達到上限即停止列舉，判型仍以已收集到的部分進行。
export async function collectDirEntriesTauri(dirPath, opts = {}) {
  return collectDirEntries(window.__TAURI__.fs, dirPath, opts);
}

// fs 注入版（走訪邏輯獨立可測：深度、上限、relPath 組合、路徑分隔符）
export async function collectDirEntries(fs, dirPath,
  { maxDepth = 2, headerBytes = 8192, maxEntries = 5000 } = {}) {
  const sep = dirPath.includes("\\") ? "\\" : "/";
  const join = (dir, name) => `${dir}${dir.endsWith(sep) ? "" : sep}${name}`;
  const out = [];
  async function walk(dir, rel, depth) {
    if (out.length >= maxEntries) return;
    const entries = await fs.readDir(dir).catch(() => []);
    for (const e of entries) {
      if (out.length >= maxEntries) return;
      const full = join(dir, e.name);
      const relPath = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory) {
        if (depth < maxDepth) await walk(full, relPath, depth + 1);
        continue;
      }
      out.push({
        relPath,
        path: full,
        async readHeader() {
          const f = await fs.open(full, { read: true });
          try {
            const buf = new Uint8Array(headerBytes);
            let filled = 0;
            while (filled < headerBytes) {
              const n = await f.read(buf.subarray(filled));
              if (n === null || n === 0) break;
              filled += n;
            }
            return buf.subarray(0, filled);
          } finally {
            await f.close();
          }
        },
      });
    }
  }
  await walk(dirPath, "", 1);
  return out;
}

// 判型完成後才把 entries 補上實際的 ByteSource（此處才 stat）
export async function buildSourceSetTauri(dirPath, entries) {
  const name = dirPath.split(/[/\\]/).filter(Boolean).pop() || dirPath;
  const withSources = [];
  for (const e of entries) {
    withSources.push({ relPath: e.relPath, source: await tauriFileSource(e.path) });
  }
  return { rootName: name, entries: withSources };
}

// 資料夾情境：找出非 cda 的 .xml（語意同 tests/helpers 的 resolveAppleDir）。
// 頂層找不到時下潛一層子資料夾（使用者常選到外層目錄如 Downloads，
// 匯出實際在其中的 apple_health_export/；2026-08-10 走查回饋）
export async function resolveAppleDirTauri(dirPath, depth = 1) {
  const fs = window.__TAURI__.fs;
  const sep = dirPath.includes("\\") ? "\\" : "/";
  const join = (name) => `${dirPath}${dirPath.endsWith(sep) ? "" : sep}${name}`;
  const entries = await fs.readDir(dirPath);
  const names = entries
    .filter(e => !e.isDirectory && e.name.toLowerCase().endsWith(".xml")
      && !e.name.toLowerCase().includes("cda"))
    .map(e => e.name).sort();
  if (names.length) return join(names[0]);
  if (depth <= 0) return null;
  // 子資料夾優先序：名稱含 apple_health_export 者最先，其餘按名稱排
  const subdirs = entries.filter(e => e.isDirectory)
    .map(e => e.name)
    .sort((a, b) => {
      const pa = a.toLowerCase().includes("apple_health_export") ? 0 : 1;
      const pb = b.toLowerCase().includes("apple_health_export") ? 0 : 1;
      return pa - pb || a.localeCompare(b);
    });
  for (const sub of subdirs) {
    const found = await resolveAppleDirTauri(join(sub), depth - 1).catch(() => null);
    if (found) return found;
  }
  return null;
}
