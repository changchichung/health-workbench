#!/bin/bash
# 端到端冪等演練（task 7.2 / Implementation Contract 驗收）：
# 真實健保檔＋Apple 匯出各匯入兩次，斷言全表筆數與 record_fp 集合不變。
# 用法：scripts/e2e_idempotency.sh <健保JSON> <apple匯出路徑> [工作目錄]
set -euo pipefail
NHI="$1"; APPLE="$2"; WORK="${3:-$(mktemp -d)}"
DB="$WORK/e2e.sqlite"
cd "$(dirname "$0")/.."

snapshot() {
  sqlite3 "$DB" "SELECT 'counts', (SELECT COUNT(*) FROM encounters),
    (SELECT COUNT(*) FROM medications), (SELECT COUNT(*) FROM lab_results),
    (SELECT COUNT(*) FROM reports), (SELECT COUNT(*) FROM apple_records),
    (SELECT COUNT(*) FROM apple_workouts);
    SELECT record_fp FROM encounters ORDER BY record_fp;" | shasum -a 256 | cut -d' ' -f1
}

echo "== 第一輪匯入 =="
python3 -m src.mhb_cli --db "$DB" import "$NHI" --no-rebuild --yes >/dev/null
python3 -m src.mhb_cli --db "$DB" import "$APPLE" --no-rebuild --yes >/dev/null
S1=$(snapshot)

echo "== 第二輪匯入（同輸入） =="
python3 -m src.mhb_cli --db "$DB" import "$NHI" --no-rebuild --yes >/dev/null
python3 -m src.mhb_cli --db "$DB" import "$APPLE" --no-rebuild --yes >/dev/null
S2=$(snapshot)

echo "== 產出 dashboard =="
python3 -m src.mhb_cli --db "$DB" rebuild >/dev/null

if [ "$S1" = "$S2" ]; then
  echo "PASS: 全表筆數與 record_fp 集合雙輪一致 ($S1)"
else
  echo "FAIL: 快照不一致 $S1 != $S2"
  exit 1
fi
