"""Adapter 註冊制：每來源一個版本化 parser，依 detect() 自動判型。"""
import sys

_REGISTRY = []


def register(adapter_cls):
    _REGISTRY.append(adapter_cls)
    return adapter_cls


def get_adapters():
    # 匯入時註冊（延遲載入避免循環相依）；載入失敗直接浮出，不得靜默
    from . import apple_health, nhi_json  # noqa: F401
    return list(_REGISTRY)


def detect_and_import(path, *, db_path, rebuild=True, assume_profile=False):
    """對輸入路徑自動判型並匯入。無法判型時明確報錯並列出支援格式。"""
    if not path.exists():
        print(f"找不到檔案或資料夾：{path}", file=sys.stderr)
        return 2
    for adapter_cls in get_adapters():
        if adapter_cls.detect(path):
            adapter = adapter_cls()
            rc = adapter.import_file(path, db_path=db_path, assume_profile=assume_profile)
            if rc == 0 and rebuild:
                from src.dashboard.generate import rebuild as do_rebuild
                rc = do_rebuild(db_path=db_path)
            return rc
    supported = "、".join(a.FORMAT_DESC for a in get_adapters()) or "健保存摺醫療類 JSON、Apple Health 匯出（尚未註冊）"
    print(f"無法辨識輸入格式：{path}\n支援的格式：{supported}", file=sys.stderr)
    return 2
