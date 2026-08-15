#!/usr/bin/env bash
# 定位 Tauri 產出的 DMG，stdout 印出唯一路徑。
#
# 為什麼不用裸 find -print -quit：Tauri 內嵌的 bundle_dmg.sh 會把中繼
# 映像 rw.<pid>.*.dmg 放在最終 DMG 同目錄，僅成功路徑會清除；失敗重跑
# 後殘留時 -print -quit 取 readdir 首個命中且無排序保證，驗收與上傳
# 兩個 step 可能各自撿到不同檔案。這裡排除中繼映像並要求「恰好一顆」，
# 多顆或零顆都直接失敗，所有 step 共用同一個答案。
#
# 用法：locate_dmg.sh [搜尋根目錄]（預設 app/src-tauri/target）
set -euo pipefail

ROOT="${1:-app/src-tauri/target}"
[ -d "$ROOT" ] || { echo "找不到搜尋根目錄：$ROOT" >&2; exit 1; }

MATCHES="$(find "$ROOT" -maxdepth 5 -name '*.dmg' ! -name 'rw.*.dmg' | sort)"
COUNT="$(printf '%s' "$MATCHES" | grep -c '.' || true)"
if [ "$COUNT" != "1" ]; then
  echo "預期恰好一顆 DMG，找到 ${COUNT} 顆：" >&2
  printf '%s\n' "$MATCHES" >&2
  exit 1
fi
printf '%s\n' "$MATCHES"
