"""Python oracle：用與正式 adapter 相同的 ET.iterparse 路徑抽同一組欄位，
產出與 JS spike 相同定義的指紋，做差分對帳。"""
import hashlib
import json
import sys
import time
import xml.etree.ElementTree as ET
from pathlib import Path

# 直接 import 正式 adapter 的 WANTED 清單，避免兩份清單漂移
_REPO_ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(_REPO_ROOT))
from src.adapters.apple_health import WANTED  # noqa: E402


def js_num(s):
    """模擬 JS `${parseFloat(x)}` 的字串化（僅處理常規數字）。"""
    try:
        v = float(s)
    except (TypeError, ValueError):
        return None
    if v == int(v) and abs(v) < 1e21:
        return str(int(v))
    return repr(v)


def main(path):
    h = hashlib.sha256()
    counts = {}
    records = workouts = epoch = 0
    t0 = time.time()
    with open(path, "rb") as f:
        for _, el in ET.iterparse(f, events=("end",)):
            if el.tag == "Record":
                t = el.get("type")
                if t in WANTED:
                    records += 1
                    counts[t] = counts.get(t, 0) + 1
                    start = (el.get("startDate") or "")[:19]
                    end = (el.get("endDate") or "")[:19]
                    if start < "2000-01-01":
                        epoch += 1
                    num = js_num(el.get("value"))
                    val = num if num is not None else (el.get("value") or "")
                    h.update((f"{t}|{start}|{end}|{val}|{el.get('unit') or ''}|"
                              f"{el.get('sourceName') or ''}\n").encode())
            elif el.tag == "Workout":
                workouts += 1
            el.clear()
    secs = time.time() - t0
    mb = Path(path).stat().st_size / 1048576
    print(json.dumps({
        "size_mb": round(mb, 1), "seconds": round(secs, 2),
        "mb_per_s": round(mb / secs, 1), "wanted_records": records,
        "workouts": workouts, "epoch_flags": epoch,
        "fingerprint": h.hexdigest()[:16],
        "type_counts": dict(sorted(counts.items())),
    }, indent=1))


if __name__ == "__main__":
    main(sys.argv[1])
