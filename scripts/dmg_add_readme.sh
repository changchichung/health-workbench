#!/usr/bin/env bash
# 把使用說明放進 macOS DMG（就地覆寫傳入的檔案）。
#
# tauri-action 產出的 DMG 是唯讀壓縮映像（UDZO）且無剩餘空間，無法直接
# 寫入，必須先轉可寫（UDRW）並放大、放檔、再轉回壓縮。Tauri 的 bundle
# 設定沒有「附加任意檔案進 DMG」的選項，因此走這條後處理。
#
# 用法：scripts/dmg_add_readme.sh <dmg 路徑>
# 產物斷言：最終映像必須同時含說明檔與 App，否則非零退出（不出貨半成品）。
set -euo pipefail

DMG="${1:?用法：dmg_add_readme.sh <dmg 路徑>}"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC_TXT="$REPO_ROOT/packaging/dmg-readme.txt"
# 使用者在 DMG 視窗裡看到的檔名（repo 內維持 ASCII 檔名避免 CI 編碼問題）
DEST_NAME="使用說明（請先閱讀）.txt"

[ -f "$DMG" ] || { echo "找不到 DMG：$DMG" >&2; exit 1; }
[ -f "$SRC_TXT" ] || { echo "找不到說明檔：$SRC_TXT" >&2; exit 1; }

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
RW="$WORK/rw.dmg"
MNT="$WORK/mnt"
VERIFY="$WORK/verify"
mkdir -p "$MNT" "$VERIFY"

echo "來源 DMG：$DMG"
hdiutil convert "$DMG" -format UDRW -o "$RW" >/dev/null
# 說明檔只有數 KB，但唯讀映像剩餘空間通常為零，必須先放大再寫入。
# 尺寸取 resize -limits 的最小值加 10MB（512 bytes/sector），
# 不硬編數字，App 體積成長時自動跟著長
MIN_SECTORS="$(hdiutil resize -limits "$RW" | tail -1 | awk '{print $1}')"
[ -n "$MIN_SECTORS" ] || { echo "讀不到映像最小尺寸" >&2; exit 1; }
hdiutil resize -sectors "$((MIN_SECTORS + 20480))" "$RW" >/dev/null

hdiutil attach "$RW" -nobrowse -noautoopen -mountpoint "$MNT" >/dev/null
cp "$SRC_TXT" "$MNT/$DEST_NAME"
wrote=1
[ -f "$MNT/$DEST_NAME" ] || wrote=0
hdiutil detach "$MNT" >/dev/null
[ "$wrote" = "1" ] || { echo "說明檔寫入可寫映像失敗" >&2; exit 1; }

OUT="$WORK/out.dmg"
hdiutil convert "$RW" -format UDZO -imagekey zlib-level=9 -o "$OUT" >/dev/null

# 掛載最終映像逐項斷言（避免壓縮階段靜默掉檔）
hdiutil attach "$OUT" -nobrowse -noautoopen -readonly -mountpoint "$VERIFY" >/dev/null
ok=1
[ -f "$VERIFY/$DEST_NAME" ] || { echo "驗證失敗：最終 DMG 缺說明檔" >&2; ok=0; }
[ -d "$VERIFY/MyHealthBank.app" ] || { echo "驗證失敗：最終 DMG 缺 App" >&2; ok=0; }
hdiutil detach "$VERIFY" >/dev/null
[ "$ok" = "1" ] || exit 1

mv "$OUT" "$DMG"
# 變數後緊接中文字元必須用大括號界定：macOS bash 會把多位元組字元
# 併進變數名，變成 unbound variable
echo "已放入「${DEST_NAME}」，DMG 大小 $(du -h "$DMG" | cut -f1)"
