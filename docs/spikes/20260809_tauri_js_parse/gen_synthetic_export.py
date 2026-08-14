"""合成 Apple Health export.xml（去識別化，spike 用）。

目標：~200MB、約 70 萬個 Record（其中 WANTED 型別約 50 萬）＋ Workout，
混入雜訊型別、MetadataEntry 多行元素、XML entity、epoch 日期、離群值，
逼近真實檔的解析難度。
"""
import random
import sys
from pathlib import Path

random.seed(42)

WANTED = [
    ("HKQuantityTypeIdentifierStepCount", "count", lambda: random.randint(10, 3000)),
    ("HKQuantityTypeIdentifierActiveEnergyBurned", "kcal", lambda: round(random.uniform(0.1, 30), 3)),
    ("HKQuantityTypeIdentifierBasalEnergyBurned", "kcal", lambda: round(random.uniform(0.5, 40), 3)),
    ("HKQuantityTypeIdentifierDistanceWalkingRunning", "km", lambda: round(random.uniform(0.01, 2.5), 5)),
    ("HKQuantityTypeIdentifierHeartRate", "count/min", lambda: random.randint(45, 180)),
    ("HKQuantityTypeIdentifierBodyMass", "kg", lambda: round(random.uniform(60, 90), 1)),
    ("HKQuantityTypeIdentifierBloodPressureSystolic", "mmHg", lambda: random.randint(95, 145)),
    ("HKQuantityTypeIdentifierBloodPressureDiastolic", "mmHg", lambda: random.randint(55, 95)),
    ("HKQuantityTypeIdentifierBodyFatPercentage", "%", lambda: round(random.uniform(0.12, 0.35), 3)),
    ("HKQuantityTypeIdentifierWalkingSpeed", "km/hr", lambda: round(random.uniform(2, 7), 3)),
    ("HKQuantityTypeIdentifierFlightsClimbed", "count", lambda: random.randint(1, 20)),
    ("HKCategoryTypeIdentifierSleepAnalysis", None, lambda: "HKCategoryValueSleepAnalysisAsleepCore"),
]
NOISE = [
    ("HKQuantityTypeIdentifierEnvironmentalAudioExposure", "dBASPL", lambda: round(random.uniform(40, 90), 2)),
    ("HKQuantityTypeIdentifierAppleExerciseTime", "min", lambda: random.randint(1, 30)),
    ("HKQuantityTypeIdentifierAppleStandTime", "min", lambda: random.randint(1, 30)),
    ("HKCategoryTypeIdentifierAppleStandHour", None, lambda: "HKCategoryValueAppleStandHourStood"),
]
SOURCES = ["iPhone", "Apple Watch", "好轻", "Health &amp; Fitness App", "OMRON connect"]


def ts():
    y = random.randint(2019, 2026)
    return (f"{y}-{random.randint(1,12):02d}-{random.randint(1,28):02d} "
            f"{random.randint(0,23):02d}:{random.randint(0,59):02d}:{random.randint(0,59):02d} +0800")


def record(pool):
    t, unit, gen = random.choice(pool)
    v = gen()
    src = random.choice(SOURCES)
    start = ts() if random.random() > 0.001 else "1970-01-01 08:00:00 +0800"
    attrs = (f'type="{t}" sourceName="{src}" sourceVersion="17.5"'
             + (f' unit="{unit}"' if unit else "")
             + f' creationDate="{start}" startDate="{start}" endDate="{start}" value="{v}"')
    if random.random() < 0.05:
        meta = (f'\n  <MetadataEntry key="HKMetadataKeyHeartRateMotionContext" value="{random.randint(0,2)}"/>'
                f'\n  <MetadataEntry key="HKWasUserEntered" value="0"/>')
        return f" <Record {attrs}>{meta}\n </Record>\n"
    return f" <Record {attrs}/>\n"


def main(out_path, target_mb):
    target = target_mb * 1024 * 1024
    with open(out_path, "w", encoding="utf-8") as f:
        f.write('<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE HealthData [\n')
        for i in range(60):
            f.write(f'<!ATTLIST Record attr{i} CDATA #IMPLIED>\n')
        f.write(']>\n<HealthData locale="zh_TW">\n')
        f.write(' <ExportDate value="2026-08-09 12:00:00 +0800"/>\n')
        written = f.tell()
        n = 0
        while written < target:
            pool = WANTED if random.random() < 0.72 else NOISE
            chunk = "".join(record(pool) for _ in range(2000))
            f.write(chunk)
            written += len(chunk.encode("utf-8"))
            n += 2000
        for _ in range(200):
            s, e = ts(), ts()
            f.write(f' <Workout workoutActivityType="HKWorkoutActivityTypeWalking" duration="{round(random.uniform(10,90),3)}"'
                    f' sourceName="Apple Watch" startDate="{s}" endDate="{e}"/>\n')
        f.write("</HealthData>\n")
    size = Path(out_path).stat().st_size
    print(f"records≈{n} workouts=200 size={size/1048576:.1f}MB")


if __name__ == "__main__":
    main(sys.argv[1], int(sys.argv[2]))
