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
    assert "schema 版本：1" in r.stdout
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
