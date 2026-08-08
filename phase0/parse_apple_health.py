#!/usr/bin/env python3
"""Phase 0：解析 Apple Health 匯出 XML，寫入 mhb.sqlite 的 apple_records 表。

設計重點（對應「跨批次累加合併」規格需求）：
- 以 (type, start_ts, end_ts, source_name, value) 為自然鍵建 UNIQUE 索引，
  INSERT OR IGNORE 達成冪等：同一份或重疊的匯出重複匯入，筆數不變。
- 只擷取健康相關型別（身體組成、血壓、心率、睡眠、血氧），
  活動類（步數/能量/步態）量大且與就醫紀錄無關，Phase 0 先不入庫。

用法：python3 parse_apple_health.py <apple_health_export/輸出.xml> [db_path]
"""
import hashlib
import json
import sqlite3
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

WANTED = {
    "HKQuantityTypeIdentifierBodyMass": "體重",
    "HKQuantityTypeIdentifierBodyMassIndex": "BMI",
    "HKQuantityTypeIdentifierHeight": "身高",
    "HKQuantityTypeIdentifierBodyFatPercentage": "體脂率",
    "HKQuantityTypeIdentifierLeanBodyMass": "除脂體重",
    "HKQuantityTypeIdentifierBloodPressureSystolic": "收縮壓",
    "HKQuantityTypeIdentifierBloodPressureDiastolic": "舒張壓",
    "HKQuantityTypeIdentifierHeartRate": "心率",
    "HKQuantityTypeIdentifierRestingHeartRate": "安靜心率",
    "HKQuantityTypeIdentifierOxygenSaturation": "血氧",
    "HKQuantityTypeIdentifierRespiratoryRate": "呼吸速率",
    "HKCategoryTypeIdentifierSleepAnalysis": "睡眠",
    # 活動類（2026-08-08 拍板納入：全面性健康檢視）
    "HKQuantityTypeIdentifierStepCount": "步數",
    "HKQuantityTypeIdentifierDistanceWalkingRunning": "步行跑步距離",
    "HKQuantityTypeIdentifierDistanceCycling": "騎車距離",
    "HKQuantityTypeIdentifierFlightsClimbed": "爬樓層數",
    "HKQuantityTypeIdentifierActiveEnergyBurned": "活動能量",
    "HKQuantityTypeIdentifierBasalEnergyBurned": "基礎能量",
    "HKQuantityTypeIdentifierWalkingSpeed": "步行速度",
    "HKQuantityTypeIdentifierWalkingStepLength": "步幅",
    "HKQuantityTypeIdentifierWalkingDoubleSupportPercentage": "雙腳支撐比例",
    "HKQuantityTypeIdentifierWalkingAsymmetryPercentage": "步態不對稱比例",
    "HKQuantityTypeIdentifierAppleWalkingSteadiness": "行走穩定度",
    "HKQuantityTypeIdentifierHeadphoneAudioExposure": "耳機音量暴露",
    "HKQuantityTypeIdentifierDietaryWater": "飲水量",
    "HKQuantityTypeIdentifierDietaryEnergyConsumed": "攝取熱量",
    "HKQuantityTypeIdentifierDietaryFatTotal": "攝取脂肪",
    "HKQuantityTypeIdentifierDietaryCarbohydrates": "攝取碳水",
    "HKQuantityTypeIdentifierDietaryProtein": "攝取蛋白質",
}
EPOCH_PLACEHOLDER = "1970-01-01"


def main():
    xml_path = Path(sys.argv[1])
    db_path = Path(sys.argv[2]) if len(sys.argv) > 2 else Path(__file__).parent / "output" / "mhb.sqlite"
    con = sqlite3.connect(db_path)
    cur = con.cursor()
    cur.executescript("""
    CREATE TABLE IF NOT EXISTS apple_records(
        id INTEGER PRIMARY KEY, type TEXT, type_zh TEXT,
        start_ts TEXT, end_ts TEXT, value_numeric REAL, value_text TEXT,
        unit TEXT, source_name TEXT, quality_flags TEXT, import_batch TEXT);
    CREATE UNIQUE INDEX IF NOT EXISTS uq_apple ON apple_records(
        type, start_ts, end_ts, source_name, COALESCE(value_numeric, -1), COALESCE(value_text,''));
    CREATE TABLE IF NOT EXISTS apple_workouts(
        id INTEGER PRIMARY KEY, activity TEXT, start_ts TEXT, end_ts TEXT,
        duration_min REAL, source_name TEXT, import_batch TEXT);
    CREATE UNIQUE INDEX IF NOT EXISTS uq_workout ON apple_workouts(activity, start_ts, end_ts, source_name);
    """)

    batch = hashlib.sha256(xml_path.read_bytes()[:1 << 20]).hexdigest()[:12]
    stats = {"scanned": 0, "inserted": 0, "skipped_dup": 0, "epoch_flagged": 0}
    rows = []

    def flush():
        nonlocal rows
        before = con.total_changes
        cur.executemany(
            """INSERT OR IGNORE INTO apple_records
               (type,type_zh,start_ts,end_ts,value_numeric,value_text,unit,source_name,quality_flags,import_batch)
               VALUES(?,?,?,?,?,?,?,?,?,?)""", rows)
        stats["inserted"] += con.total_changes - before
        rows = []

    for ev, el in ET.iterparse(str(xml_path), events=("end",)):
        if el.tag == "Record":
            t = el.get("type")
            if t in WANTED:
                stats["scanned"] += 1
                start = (el.get("startDate") or "")[:19]
                end = (el.get("endDate") or "")[:19]
                v = el.get("value")
                try:
                    vnum, vtext = float(v), None
                except (TypeError, ValueError):
                    vnum, vtext = None, v
                flags = []
                if start.startswith(EPOCH_PLACEHOLDER):
                    flags.append("epoch_placeholder_date")
                    stats["epoch_flagged"] += 1
                rows.append((t, WANTED[t], start, end, vnum, vtext,
                             el.get("unit"), el.get("sourceName"),
                             ",".join(flags), batch))
                if len(rows) >= 5000:
                    flush()
        elif el.tag == "Workout":
            cur.execute(
                """INSERT OR IGNORE INTO apple_workouts
                   (activity,start_ts,end_ts,duration_min,source_name,import_batch)
                   VALUES(?,?,?,?,?,?)""",
                (el.get("workoutActivityType", "").replace("HKWorkoutActivityType", ""),
                 (el.get("startDate") or "")[:19], (el.get("endDate") or "")[:19],
                 float(el.get("duration") or 0), el.get("sourceName"), batch))
        el.clear()
    flush()
    stats["skipped_dup"] = stats["scanned"] - stats["inserted"]
    con.commit()

    total = cur.execute("SELECT COUNT(*) FROM apple_records").fetchone()[0]
    print(json.dumps({**stats, "table_total": total}, ensure_ascii=False))
    con.close()


if __name__ == "__main__":
    main()
