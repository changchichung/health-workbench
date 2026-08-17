// defaultSavePath 純函式測試。這個判斷曾在兩處各寫一次、其中一處漏掉
// Windows 分隔符，抽成一支之後在這裡把兩個平台與邊界一次釘住。
import test from "node:test";
import assert from "node:assert/strict";
import { defaultSavePath } from "../../src/ui/paths.js";

test("沒有起始目錄時只回檔名", () => {
  assert.equal(defaultSavePath(null, "a.epub"), "a.epub");
  assert.equal(defaultSavePath("", "a.epub"), "a.epub");
});

test("macOS 路徑用斜線", () => {
  assert.equal(defaultSavePath("/Users/me/Documents", "a.epub"),
    "/Users/me/Documents/a.epub");
});

test("Windows 路徑用反斜線，不混用", () => {
  const r = defaultSavePath("C:\\Users\\me\\Documents", "a.epub");
  assert.equal(r, "C:\\Users\\me\\Documents\\a.epub");
  assert.ok(!r.includes("/"), `混進了斜線：${r}`);
});

test("起始目錄已帶結尾分隔符時不重複", () => {
  assert.equal(defaultSavePath("/Users/me/", "a.epub"), "/Users/me/a.epub");
  assert.equal(defaultSavePath("C:\\Users\\me\\", "a.epub"), "C:\\Users\\me\\a.epub");
});
