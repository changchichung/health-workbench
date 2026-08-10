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
