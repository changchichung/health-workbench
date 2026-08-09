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

// 資料夾情境：找出非 cda 的 .xml（語意同 tests/helpers 的 resolveAppleDir）
export async function resolveAppleDirTauri(dirPath) {
  const fs = window.__TAURI__.fs;
  const entries = await fs.readDir(dirPath);
  const names = entries
    .filter(e => !e.isDirectory && e.name.toLowerCase().endsWith(".xml")
      && !e.name.toLowerCase().includes("cda"))
    .map(e => e.name).sort();
  if (!names.length) return null;
  const sep = dirPath.includes("\\") ? "\\" : "/";
  return `${dirPath}${dirPath.endsWith(sep) ? "" : sep}${names[0]}`;
}
