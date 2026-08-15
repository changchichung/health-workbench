#!/usr/bin/env bash
# macOS 簽章／公證驗收。掛載 DMG 後驗「DMG 裡面那顆 App」：斷言對象
# 就是使用者實際下載解開的東西，不驗建置目錄裡的散裝 .app。
#
# 同一支腳本供兩個 workflow 共用：
#   release.yml  → signed 模式（正式驗收，任一斷言失敗即擋發布）
#   app-build.yml→ unsigned 模式（每次推 main 對未簽章產物跑負向對照，
#                  發布當天才第一次執行的腳本等於沒有防線）
#
# NEVER 在判定命令上接 pipe：set -o pipefail 下 `codesign ... | grep -q`
# 會因 grep 命中後提前退出，codesign 後續寫入觸發 SIGPIPE(141)，把
# 正確簽章判成失敗（2026-08-15 本機 300/300 重現）。輸出一律先收進
# 變數再比對。
#
# NEVER 只用 spctl 判定：spctl 結果取決於執行機器的 Gatekeeper 狀態，
# `spctl --master-disable` 過的機器上完全未簽章的 App 也會回 accepted
# （2026-08-14 本機實測，輸出 `override=security disabled`）。真正的
# 判準是憑證類型與公證票據，兩者都不看 Gatekeeper。
#
# 用法：verify_macos_signing.sh <dmg 路徑> signed|unsigned
set -euo pipefail

DMG="${1:?用法：verify_macos_signing.sh <dmg 路徑> signed|unsigned}"
MODE="${2:?第二個參數必須是 signed 或 unsigned}"
case "$MODE" in
  signed|unsigned) ;;
  *) echo "未知模式：${MODE}（只接受 signed 或 unsigned）" >&2; exit 2 ;;
esac
[ -f "$DMG" ] || { echo "找不到 DMG：$DMG" >&2; exit 1; }

MNT="$(mktemp -d)"
trap 'hdiutil detach "$MNT" >/dev/null 2>&1 || true; rmdir "$MNT" 2>/dev/null || true' EXIT
hdiutil attach "$DMG" -nobrowse -noautoopen -readonly -mountpoint "$MNT" >/dev/null
APP="$MNT/MyHealthBank.app"
[ -d "$APP" ] || { echo "DMG 內找不到 MyHealthBank.app" >&2; exit 1; }

fail=0
SIGN_INFO="$(codesign -dv --verbose=4 "$APP" 2>&1 || true)"

if [ "$MODE" = "signed" ]; then
  echo "── 1. 憑證類型必須是 Developer ID Application"
  # Apple Distribution 憑證也簽得過，但那是 App Store 用的，直接分發
  # 會被 Gatekeeper 擋；明確斷言憑證種類而不只是「有簽章」。
  case "$SIGN_INFO" in
    *"Authority=Developer ID Application"*) echo "  OK" ;;
    *)
      echo "::error::未以 Developer ID Application 簽章（adhoc 或憑證類型錯誤）"
      sed -n '1,20p' <<<"$SIGN_INFO"
      fail=1 ;;
  esac

  echo "── 2. 簽章本身必須通過嚴格驗證"
  codesign --verify --deep --strict --verbose=2 "$APP" || { echo "::error::codesign 驗證失敗"; fail=1; }

  echo "── 3. App 與 DMG 都必須有公證票據"
  # Tauri 只對 .app 公證＋staple，從不 staple DMG；DMG 層票據由
  # release workflow 在附完使用說明後自行 submit＋staple。兩層都驗，
  # 離線環境的 Gatekeeper 檢查才不會被擋。
  xcrun stapler validate "$APP" || { echo "::error::App 沒有公證票據"; fail=1; }
  xcrun stapler validate "$DMG" || { echo "::error::DMG 沒有公證票據"; fail=1; }

  echo "── 4. Gatekeeper 評估（僅在該機器啟用評估時才有判定力）"
  SPCTL_STATUS="$(spctl --status 2>&1 || true)"
  case "$SPCTL_STATUS" in
    *"assessments enabled"*)
      spctl -a -vvv -t install "$DMG" || { echo "::error::Gatekeeper 拒絕此 DMG"; fail=1; } ;;
    *)
      echo "::warning::此機器的 Gatekeeper 評估已停用，spctl 無判定力，略過（前三項仍具約束力）" ;;
  esac
else
  echo "── 未簽章負向對照：斷言此產物「不是」Developer ID 簽章且無票據"
  # 負向對照防止驗收邏輯退化成「什麼都過」：若未簽章建置也能通過
  # signed 模式的斷言，代表斷言本身壞了。
  case "$SIGN_INFO" in
    *"Authority=Developer ID Application"*)
      echo "::error::未簽章建置卻驗出 Developer ID 簽章，建置環境異常"; fail=1 ;;
    *) echo "  OK（非 Developer ID 簽章）" ;;
  esac
  if xcrun stapler validate "$APP" >/dev/null 2>&1; then
    echo "::error::未簽章建置卻有公證票據，建置環境異常"; fail=1
  else
    echo "  OK（無公證票據，stapler 如預期拒絕）"
  fi
fi

[ "$fail" = "0" ] || { echo "::error::簽章／公證驗收未通過，請勿發布此產物"; exit 1; }
# 變數後緊接中文字元必須用大括號界定：macOS bash 會把多位元組字元
# 併進變數名，變成 unbound variable
echo "驗收通過（模式：${MODE}，對象：${DMG}）"
