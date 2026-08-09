// App 前端入口。Tauri API 走 withGlobalTauri（window.__TAURI__），
// 引擎模組（engine/、adapters/、store/）維持純 ESM，Node 測試可直接 import。
import { maybeRunSpike } from "./spike.js";

const status = document.getElementById("status");
if (window.__TAURI__) {
  status.textContent = "殼已就緒（task 0.1）。";
  maybeRunSpike(status);
} else {
  status.textContent = "非 Tauri 環境（瀏覽器預覽模式）。";
}
