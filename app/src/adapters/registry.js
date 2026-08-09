// adapter 註冊制（design D7）：每來源一 adapter、內容判型不看檔名。
// adapter 介面：{ id, formatDesc, detect(header: Uint8Array, name: string) => bool,
//   importSource(source, store, progress, opts) => Promise<result> }
// 新格式＝新增 adapter 模組＋register 一行，引擎與 GUI 不改（spec 驗收）。

export function createRegistry() {
  const adapters = [];
  return {
    register(adapter) {
      if (!adapter?.id || typeof adapter.detect !== "function"
        || typeof adapter.importSource !== "function") {
        throw new Error("adapter 介面不完整（需 id/detect/importSource）");
      }
      adapters.push(adapter);
      return adapter;
    },
    detect(header, name) {
      return adapters.find(a => a.detect(header, name)) ?? null;
    },
    formats() {
      return adapters.map(a => a.formatDesc);
    },
    list() {
      return [...adapters];
    },
  };
}
