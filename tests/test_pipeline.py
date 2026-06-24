"""
pipeline.py 統合テスト
実行前に setup.sh で Blender をインストールしてください。

実行方法:
    pytest tests/test_pipeline.py -v
    # または
    python tests/test_pipeline.py
"""
import os
import struct
import subprocess
import sys
import tempfile
from pathlib import Path

PROJECT_ROOT = Path(__file__).parent.parent


def run_pipeline(extra_args: list, timeout: int = 180) -> subprocess.CompletedProcess:
    """pipeline.py を実行して結果を返す"""
    return subprocess.run(
        [sys.executable, "pipeline.py"] + extra_args,
        cwd=str(PROJECT_ROOT),
        capture_output=True,
        text=True,
        timeout=timeout,
    )


def check_glb_magic(path: str) -> bool:
    """GLB マジックバイト（glTF）を確認"""
    with open(path, "rb") as f:
        magic = struct.unpack("<I", f.read(4))[0]
    return magic == 0x46546C67


def test_barrel_basic():
    """樽の基本生成テスト"""
    with tempfile.NamedTemporaryFile(suffix=".glb", delete=False) as f:
        out = f.name
    try:
        result = run_pipeline([
            "--type", "barrel",
            "--pieces", "10",
            "--seed", "1",
            "--out", out,
        ])
        assert result.returncode == 0, f"失敗:\n{result.stdout}\n{result.stderr}"
        assert os.path.exists(out), "GLB が生成されなかった"
        assert os.path.getsize(out) > 5000, f"GLB が小さすぎる: {os.path.getsize(out)} bytes"
        assert check_glb_magic(out), "GLB マジックバイト不正"
        print(f"OK: barrel.glb ({os.path.getsize(out):,} bytes)")
    finally:
        if os.path.exists(out):
            os.unlink(out)


def test_barrel_params():
    """重さ・壊れやすさパラメータのテスト"""
    with tempfile.NamedTemporaryFile(suffix=".glb", delete=False) as f:
        out = f.name
    try:
        result = run_pipeline([
            "--type", "barrel",
            "--pieces", "15",
            "--seed", "42",
            "--weight", "50.0",
            "--fragility", "0.9",
            "--friction", "0.3",
            "--restitution", "0.8",
            "--out", out,
        ])
        assert result.returncode == 0, f"失敗:\n{result.stdout}\n{result.stderr}"
        assert check_glb_magic(out), "GLB マジックバイト不正"
        print(f"OK: 重い樽 GLB ({os.path.getsize(out):,} bytes)")
    finally:
        if os.path.exists(out):
            os.unlink(out)


def test_invalid_type():
    """不正なタイプはエラーになること"""
    result = run_pipeline(["--type", "invalid", "--pieces", "5", "--out", "dummy.glb"])
    assert result.returncode != 0, "不正タイプがエラーにならなかった"
    print("OK: 不正タイプでエラー確認")


def test_invalid_fragility():
    """範囲外の fragility はエラーになること"""
    result = run_pipeline([
        "--type", "barrel", "--pieces", "5", "--fragility", "2.0", "--out", "dummy.glb"
    ])
    assert result.returncode != 0, "範囲外の fragility がエラーにならなかった"
    print("OK: 範囲外 fragility でエラー確認")


if __name__ == "__main__":
    print("=== Crumble パイプライン統合テスト ===\n")
    tests = [
        ("樽 基本生成", test_barrel_basic),
        ("樽 パラメータ変更", test_barrel_params),
        ("不正タイプ", test_invalid_type),
        ("不正 fragility", test_invalid_fragility),
    ]
    passed = 0
    for name, fn in tests:
        try:
            print(f"[TEST] {name}...")
            fn()
            passed += 1
        except Exception as e:
            print(f"FAIL: {e}")
    print(f"\n結果: {passed}/{len(tests)} テストパス")
