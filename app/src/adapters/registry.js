// adapter 註冊制（design D7）：每來源一 adapter、內容判型不看檔名。
// adapter 介面：{ id, formatDesc, detect(header: Uint8Array, name: string) => bool,
//   importSource(source, store, progress, opts) => Promise<result> }
// 多檔來源（如 CPAP 的整張 SD 卡）另有可選介面：
//   detectSet(entries) => Promise<bool>，entries 為
//     [{ relPath, readHeader(): Promise<Uint8Array> }]
//   importSourceSet(sourceSet, store, progress, opts) => Promise<result>
// 新格式＝新增 adapter 模組＋register 一行，引擎與 GUI 不改（spec 驗收）。

export function createRegistry() {
  const adapters = [];
  return {
    register(adapter) {
      // 匯入方法二選一即可：多檔來源的 adapter 沒有單檔語意（半張 SD 卡
      // 匯入沒有意義），單檔 adapter 也不需要實作集合介面
      const hasImport = typeof adapter?.importSource === "function"
        || typeof adapter?.importSourceSet === "function";
      if (!adapter?.id || typeof adapter.detect !== "function" || !hasImport) {
        throw new Error(
          "adapter 介面不完整（需 id/detect，且 importSource 與 importSourceSet 至少一個）");
      }
      adapters.push(adapter);
      return adapter;
    },
    detect(header, name) {
      return adapters.find(a => a.detect(header, name)) ?? null;
    },
    // 多檔判型：entries 的 header 以 readHeader() 惰性取得，adapter 只讀
    // 自己需要的那幾個檔。若改成呼叫端預先讀好全部 header，含上千個檔案的
    // 資料夾（如 Apple 匯出的 workout-routes）每次匯入都要多上千次 IO。
    async detectSet(entries) {
      for (const a of adapters) {
        if (typeof a.detectSet !== "function") continue;
        if (await a.detectSet(entries)) return a;
      }
      return null;
    },
    formats() {
      return adapters.map(a => a.formatDesc);
    },
    list() {
      return [...adapters];
    },
  };
}
