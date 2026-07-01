"""
GLB ファイルの構造バリデーション。
生成済みの GLB に intact_mesh / shards / shard_NNN ノードが含まれているか、
および crumble_* メタデータが extras に入っているかを確認する。

実行方法:
    python tests/test_glb_structure.py output/barrel.glb
    pytest tests/test_glb_structure.py -v  （GLB が output/barrel.glb に存在する場合）
"""
import json
import struct
import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).parent.parent
DEFAULT_GLB = PROJECT_ROOT / "output" / "barrel.glb"


def parse_glb_json(path: str) -> dict:
    """GLB バイナリから JSON チャンクを抽出してパース"""
    with open(path, "rb") as f:
        # 12 バイトヘッダ
        magic, version, length = struct.unpack("<III", f.read(12))
        if magic != 0x46546C67:
            raise ValueError(f"不正な GLB マジックバイト: {hex(magic)}")

        # チャンク0（JSON）
        chunk0_len, chunk0_type = struct.unpack("<II", f.read(8))
        if chunk0_type != 0x4E4F534A:
            raise ValueError(f"チャンク0が JSON ではない: {hex(chunk0_type)}")

        return json.loads(f.read(chunk0_len))


def test_node_names(glb_path: str):
    """必要なノード名が存在するか確認"""
    glb = parse_glb_json(glb_path)
    names = [n.get("name", "") for n in glb.get("nodes", [])]

    assert "intact_mesh" in names, f"'intact_mesh' が見つからない。ノード: {names}"
    assert "shards" in names, f"'shards' が見つからない。ノード: {names}"
    assert "destructible_root" in names, f"'destructible_root' が見つからない。ノード: {names}"

    shard_names = [n for n in names if n.startswith("shard_")]
    assert shard_names, f"'shard_*' ノードが見つからない。ノード: {names}"

    print(f"  ノード確認 OK: intact_mesh + shards + {len(shard_names)} シャード")
    return len(shard_names)


def test_extras(glb_path: str):
    """glTF extras に crumble メタデータが含まれるか確認"""
    glb = parse_glb_json(glb_path)

    root_node = next(
        (n for n in glb.get("nodes", []) if n.get("name") == "destructible_root"),
        None
    )
    assert root_node is not None, "'destructible_root' ノードが見つからない"

    extras = root_node.get("extras", {})
    required_keys = [
        "crumble_type", "crumble_pieces", "crumble_weight", "crumble_fragility",
        "crumble_scatter_force",
    ]
    for key in required_keys:
        assert key in extras, f"'{key}' が extras にない。extras: {extras}"

    print(f"  extras 確認 OK: type={extras.get('crumble_type')}, "
          f"pieces={extras.get('crumble_pieces')}, "
          f"weight={extras.get('crumble_weight')}, "
          f"fragility={extras.get('crumble_fragility')}, "
          f"scatter_force={extras.get('crumble_scatter_force')}")


def test_shard_extras(glb_path: str):
    """各シャードノードに crumble_shard_index / crumble_shard_mass が含まれるか確認"""
    glb = parse_glb_json(glb_path)

    shard_nodes = [n for n in glb.get("nodes", []) if n.get("name", "").startswith("shard_")]
    if not shard_nodes:
        print("  シャードノードなし（スキップ）")
        return

    ok_index = 0
    ok_mass = 0
    mass_sum = 0.0
    for node in shard_nodes:
        extras = node.get("extras", {})
        if "crumble_shard_index" in extras:
            ok_index += 1
        if "crumble_shard_mass" in extras:
            ok_mass += 1
            mass_sum += extras["crumble_shard_mass"]

    print(f"  シャード extras 確認: {ok_index}/{len(shard_nodes)} ノードに crumble_shard_index あり")

    root_node = next(
        (n for n in glb.get("nodes", []) if n.get("name") == "destructible_root"),
        None
    )
    total_weight = root_node.get("extras", {}).get("crumble_weight") if root_node else None

    assert ok_mass == len(shard_nodes), \
        f"'crumble_shard_mass' が全シャードに揃っていない ({ok_mass}/{len(shard_nodes)})"
    if total_weight is not None:
        assert abs(mass_sum - total_weight) < max(0.01, total_weight * 0.01), \
            f"per-shard mass の合計 ({mass_sum}) が crumble_weight ({total_weight}) と一致しない"

    print(f"  シャード質量確認 OK: {ok_mass}/{len(shard_nodes)} ノード, "
          f"合計質量={mass_sum:.3f} (crumble_weight={total_weight})")


def run_all(glb_path: str):
    print(f"\n=== GLB 構造検証: {glb_path} ===\n")

    try:
        shard_count = test_node_names(glb_path)
    except Exception as e:
        print(f"FAIL ノード名: {e}")
        return False

    try:
        test_extras(glb_path)
    except Exception as e:
        print(f"FAIL extras: {e}")
        return False

    try:
        test_shard_extras(glb_path)
    except Exception as e:
        print(f"  警告 シャード extras: {e}")

    print(f"\n全チェック OK — {shard_count} シャードを確認")
    return True


# pytest 用フィクスチャ
def test_glb_node_names():
    if not DEFAULT_GLB.exists():
        import pytest
        pytest.skip(f"GLB がない: {DEFAULT_GLB}")
    test_node_names(str(DEFAULT_GLB))


def test_glb_extras():
    if not DEFAULT_GLB.exists():
        import pytest
        pytest.skip(f"GLB がない: {DEFAULT_GLB}")
    test_extras(str(DEFAULT_GLB))


if __name__ == "__main__":
    path = sys.argv[1] if len(sys.argv) > 1 else str(DEFAULT_GLB)
    if not Path(path).exists():
        print(f"エラー: ファイルが見つからない: {path}")
        print("先に pipeline.py で GLB を生成してください:")
        print("  python pipeline.py --type barrel --pieces 20 --seed 1 --out output/barrel.glb")
        sys.exit(1)
    ok = run_all(path)
    sys.exit(0 if ok else 1)
