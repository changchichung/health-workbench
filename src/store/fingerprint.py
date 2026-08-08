"""D1 內容指紋：正規化健保紀錄後取 SHA-256 前 16 bytes。

正規化規則（對應 JSON/XML 已知表示差異）：
- 空值統一：None 與空字串等價
- 字串：去前後空白、連續空白（含換行）折疊為單一空格、雙引號置換為單引號
- 鍵排序；巢狀清單以各元素的正規化結果排序（元素順序不影響指紋）
"""
import hashlib
import json
import re

_WS = re.compile(r"\s+")


def _norm_value(v):
    if v is None:
        return ""
    if isinstance(v, str):
        return _WS.sub(" ", v).strip().replace('"', "'")
    return v


def _canon(obj):
    if isinstance(obj, dict):
        return {k: _canon_field(obj[k]) for k in sorted(obj)}
    return _canon_field(obj)


def _canon_field(v):
    if isinstance(v, list):
        items = [_canon(x) for x in v]
        return sorted(items, key=lambda x: json.dumps(x, ensure_ascii=False, sort_keys=True))
    if isinstance(v, dict):
        return _canon(v)
    return _norm_value(v)


def canonical_json(record: dict) -> str:
    """回傳紀錄的正規化 JSON 字串（碰撞防禦時用於完整內容比對）。"""
    return json.dumps(_canon(record), ensure_ascii=False, sort_keys=True)


def record_fp(record: dict) -> str:
    """回傳 32 字元 hex（SHA-256 前 16 bytes）。"""
    return hashlib.sha256(canonical_json(record).encode("utf-8")).hexdigest()[:32]
