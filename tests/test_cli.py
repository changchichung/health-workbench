"""CLI：--help 四子命令、status、quality、判型錯誤。"""
import subprocess
import sys

import pytest


def run_cli(*argv):
    return subprocess.run([sys.executable, "-m", "src.mhb_cli", *argv],
                          capture_output=True, text=True)


def test_help():
    r = run_cli("--help")
    assert r.returncode == 0
    for cmd in ["import", "rebuild", "status", "quality"]:
        assert cmd in r.stdout
    assert "健康資料" in r.stdout  # 繁中說明


def test_status_empty_db(tmp_path):
    r = run_cli("--db", str(tmp_path / "s.sqlite"), "status")
    assert r.returncode == 0
    assert "schema 版本：2" in r.stdout
    assert "encounters: 0" in r.stdout


def test_quality_empty_db(tmp_path):
    r = run_cli("--db", str(tmp_path / "s.sqlite"), "quality")
    assert r.returncode == 0
    assert "品質報告" in r.stdout


def test_unknown_format_error(tmp_path):
    f = tmp_path / "x.txt"
    f.write_text("hello")
    r = run_cli("--db", str(tmp_path / "s.sqlite"), "import", str(f))
    assert r.returncode != 0
    assert "支援" in (r.stderr + r.stdout)  # 明確列出支援格式


def test_corrupt_db_friendly_error(tmp_path):
    bad = tmp_path / "bad.sqlite"
    bad.write_text("not a database")
    r = run_cli("--db", str(bad), "status")
    assert r.returncode == 4
    assert "重建" in r.stderr and "Traceback" not in r.stderr


def test_zip_import(tmp_path):
    import shutil, zipfile
    from pathlib import Path as P
    src = P(__file__).parent / "fixtures" / "apple_sample.xml"
    exp = tmp_path / "apple_health_export"
    exp.mkdir(); shutil.copy(src, exp / "輸出.xml")
    zpath = tmp_path / "export.zip"
    with zipfile.ZipFile(zpath, "w") as z:
        z.write(exp / "輸出.xml", "apple_health_export/輸出.xml")
    r = run_cli("--db", str(tmp_path / "z.sqlite"), "import", str(zpath),
                "--no-rebuild", "--yes")
    assert r.returncode == 0
    assert "輸出.xml" in r.stdout  # 中文檔名無 mojibake
