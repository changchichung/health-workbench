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
MNT=""
# if 而非 &&：set -e 下 && 的假值分支可能讓後面的清理被跳過
trap 'if [ -n "$MNT" ]; then hdiutil detach "$MNT" >/dev/null 2>&1 || true; fi; rm -rf "$WORK"' EXIT
RW="$WORK/rw.dmg"
VERIFY="$WORK/verify"
mkdir -p "$VERIFY"

echo "來源 DMG：$DMG"
hdiutil convert "$DMG" -format UDRW -o "$RW" >/dev/null
# 說明檔只有數 KB，但唯讀映像剩餘空間通常為零，必須先放大再寫入。
# 尺寸取 resize -limits 的最小值加 10MB（512 bytes/sector），
# 不硬編數字，App 體積成長時自動跟著長
MIN_SECTORS="$(hdiutil resize -limits "$RW" | tail -1 | awk '{print $1}')"
[ -n "$MIN_SECTORS" ] || { echo "讀不到映像最小尺寸" >&2; exit 1; }
hdiutil resize -sectors "$((MIN_SECTORS + 20480))" "$RW" >/dev/null

# 不加 -nobrowse：Finder 要看得到這顆卷才能設定圖示位置（見下）。
# 掛載與解析分兩步：pipefail 下 grep 沒命中會讓整個指派失敗且無訊息，
# 拆開才分得出「hdiutil 掛不起來」與「輸出格式沒有掛載點」。
ATTACH_OUT="$(hdiutil attach "$RW" -noautoopen)"
MNT="$(printf '%s\n' "$ATTACH_OUT" | grep -o '/Volumes/.*' | tail -1 \
  | sed 's/[[:space:]]*$//' || true)"
[ -n "$MNT" ] || { echo "掛載後取不到掛載點：$ATTACH_OUT" >&2; exit 1; }
cp "$SRC_TXT" "$MNT/$DEST_NAME"
[ -f "$MNT/$DEST_NAME" ] || { echo "說明檔寫入可寫映像失敗" >&2; exit 1; }

# 圖示配位：Tauri 產生的 .DS_Store 只記錄 App 與 Applications 兩個座標，
# 新增的檔案交給 Finder 自動配位會落到視窗外（2026-08-11 實測落在左下角
# 看不到，使用者打開 DMG 根本沒發現說明檔）。這裡明確指定三個項目的
# 座標並放大視窗，用的是 Tauri 自己排 DMG 版面的同一套 AppleScript。
# 失敗（例如無 Finder 自動化權限）就刪掉 .DS_Store，讓 Finder 全部
# 自動排列：版面較樸素但保證三個項目都看得見。
if osascript - "$(basename "$MNT")" "$DEST_NAME" <<'APPLESCRIPT' >/dev/null 2>&1
on run argv
  set volName to item 1 of argv
  set txtName to item 2 of argv
  tell application "Finder"
    tell disk volName
      open
      set current view of container window to icon view
      set toolbar visible of container window to false
      set statusbar visible of container window to false
      set the bounds of container window to {180, 120, 900, 620}
      set opts to the icon view options of container window
      set arrangement of opts to not arranged
      set icon size of opts to 96
      set position of item "MyHealthBank.app" of container window to {150, 170}
      set position of item "Applications" of container window to {470, 170}
      set position of item txtName of container window to {310, 350}
      close
      open
      delay 1
      update without registering applications
      close
    end tell
  end tell
end run
APPLESCRIPT
then
  echo "圖示位置：已明確指定（說明檔置於視窗下方中央）"
else
  rm -f "$MNT/.DS_Store"
  echo "圖示位置：AppleScript 不可用，改為 Finder 自動排列（已移除 .DS_Store）"
fi

sync
hdiutil detach "$MNT" >/dev/null
MNT=""

OUT="$WORK/out.dmg"
hdiutil convert "$RW" -format UDZO -imagekey zlib-level=9 -o "$OUT" >/dev/null

# 掛載最終映像逐項斷言（避免壓縮階段靜默掉檔）
hdiutil attach "$OUT" -nobrowse -noautoopen -readonly -mountpoint "$VERIFY" >/dev/null
ok=1
[ -f "$VERIFY/$DEST_NAME" ] || { echo "驗證失敗：最終 DMG 缺說明檔" >&2; ok=0; }
[ -d "$VERIFY/MyHealthBank.app" ] || { echo "驗證失敗：最終 DMG 缺 App" >&2; ok=0; }
# 圖示可見性斷言：.DS_Store 若存在，說明檔 MUST 有座標記錄且落在視窗內；
# 沒有 .DS_Store 則是自動排列路徑（一律可見），兩者皆可，其他情況擋下。
DS="$VERIFY/.DS_Store" python3 - "$DEST_NAME" <<'PYCHECK' || ok=0
import os, struct, sys
ds, name = os.environ["DS"], sys.argv[1]
if not os.path.exists(ds):
    print("圖示位置：無 .DS_Store（Finder 自動排列，項目一律可見）")
    raise SystemExit(0)
data = open(ds, "rb").read()
found = {}
i = 0
while True:
    i = data.find(b"Iloc", i)
    if i < 0:
        break
    for nlen in range(1, 60):
        start = i - nlen * 2 - 4
        if start >= 0 and struct.unpack(">I", data[start:start + 4])[0] == nlen:
            try:
                key = data[start + 4:i].decode("utf-16-be")
            except Exception:
                key = "?"
            if data[i + 4:i + 8] == b"blob":
                found[key] = struct.unpack(">II", data[i + 12:i + 20])
            break
    i += 4
print("圖示座標：" + "、".join(f"{k}={v}" for k, v in found.items()))
pos = found.get(name)
if pos is None:
    print(f"驗證失敗：.DS_Store 沒有「{name}」的圖示座標（會落在視窗外）", file=sys.stderr)
    raise SystemExit(1)
# 視窗為 {180,120,900,620}＝720x500，扣掉圖示半徑留安全邊界
if not (40 <= pos[0] <= 660 and 40 <= pos[1] <= 430):
    print(f"驗證失敗：說明檔圖示座標 {pos} 超出視窗可見範圍", file=sys.stderr)
    raise SystemExit(1)
PYCHECK
hdiutil detach "$VERIFY" >/dev/null
[ "$ok" = "1" ] || exit 1

mv "$OUT" "$DMG"
# 變數後緊接中文字元必須用大括號界定：macOS bash 會把多位元組字元
# 併進變數名，變成 unbound variable
echo "已放入「${DEST_NAME}」，DMG 大小 $(du -h "$DMG" | cut -f1)"
