// ByteSource 的 Node 實作（測試/parity harness 用；App 端見 tauri_source.js）
import { open, stat, readdir } from "node:fs/promises";
import path from "node:path";

export async function nodeFileSource(filePath, chunkSize = 4 * 1024 * 1024) {
  const { size } = await stat(filePath);
  return {
    name: path.basename(filePath),
    size,
    async readAt(offset, len) {
      const fh = await open(filePath, "r");
      try {
        const buf = new Uint8Array(len);
        const { bytesRead } = await fh.read(buf, 0, len, offset);
        return buf.subarray(0, bytesRead);
      } finally {
        await fh.close();
      }
    },
    async *stream() {
      const fh = await open(filePath, "r");
      try {
        const buf = new Uint8Array(chunkSize);
        let offset = 0;
        for (;;) {
          const { bytesRead } = await fh.read(buf, 0, chunkSize, offset);
          if (bytesRead === 0) return;
          offset += bytesRead;
          yield buf.slice(0, bytesRead);
        }
      } finally {
        await fh.close();
      }
    },
  };
}

// 資料夾情境：找出非 cda 的 .xml 檔（語意同 Python _xml_source 的 dir 分支）
export async function resolveAppleDir(dirPath) {
  const names = (await readdir(dirPath)).filter(
    n => n.toLowerCase().endsWith(".xml") && !n.toLowerCase().includes("cda")).sort();
  if (!names.length) return null;
  return path.join(dirPath, names[0]);
}
