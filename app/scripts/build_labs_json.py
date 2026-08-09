"""建置期產物：src/knowledge/labs.yaml → app/src/knowledge/labs.json。

經 Python 版 load_entries()（schema 驗證＋禁用詞檢查）後轉出，
確保 App 端條目與 CLI 端同源。--check 模式比對現存檔是否過期（CI 守衛）。
"""
import json
import sys
from datetime import date
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO))
from src.knowledge.labs import load_entries  # noqa: E402

OUT = REPO / "app/src/knowledge/labs.json"


def render():
    entries = load_entries()
    def ser(o):
        if isinstance(o, date):
            return str(o)
        raise TypeError(type(o))
    return json.dumps(entries, ensure_ascii=False, indent=1, default=ser)


def main():
    text = render()
    if "--check" in sys.argv:
        current = OUT.read_text(encoding="utf-8") if OUT.exists() else ""
        if current != text:
            print("labs.json 過期：labs.yaml 已變更，請重跑 app/scripts/build_labs_json.py",
                  file=sys.stderr)
            sys.exit(1)
        print("labs.json 與 labs.yaml 同步")
        return
    OUT.write_text(text, encoding="utf-8")
    print(f"labs.json 已更新（{len(json.loads(text))} 條）")


if __name__ == "__main__":
    main()
