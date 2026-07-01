#!/usr/bin/env python3
"""
GLB に標準ドラフトの glTF 物理拡張（OMI_physics_shape / OMI_physics_body）を追加する。

crumble_* extras（独自スキーマ）は残したまま、それとは別に業界ドラフトの
拡張フォーマットでも同じ物理情報（凸コライダー・質量・摩擦・反発係数）を
埋め込む。対応エンジン側でカスタム extras 解釈コードを書かなくても、
このドラフト拡張をサポートしていれば破片の物理挙動を再現できる可能性がある。

仕様参照:
  - https://github.com/omigroup/gltf-extensions/tree/main/extensions/2.0/OMI_physics_shape
  - https://github.com/omigroup/gltf-extensions/tree/main/extensions/2.0/OMI_physics_body

Blender の gltf エクスポータはこの拡張を書き出せないため、
エクスポート後の GLB を pygltflib で後処理する形を取る
（bpy 側の Python 環境に pygltflib を追加インストールする必要がないよう、
 通常の Python（pipeline.py 実行環境）側で行う）。

このドラフト拡張は仕様が今後変わる可能性があるため実験的機能として扱うこと。
SCHEMA.md の §7 も参照。
"""
import sys

SHAPE_EXT = "OMI_physics_shape"
BODY_EXT = "OMI_physics_body"


def add_physics_extension(glb_path: str) -> bool:
    """
    glb_path のGLBに OMI_physics_shape / OMI_physics_body 拡張を追加して上書き保存する。
    pygltflib が無い場合や shard ノードが見つからない場合は False を返して何もしない。
    """
    try:
        import pygltflib
    except ImportError:
        print(
            "[physics_ext] 警告: pygltflib が見つかりません。"
            "`pip install pygltflib` でインストールすると --physics-extension が使えます。",
            file=sys.stderr,
        )
        return False

    gltf = pygltflib.GLTF2().load(glb_path)

    shard_nodes = [
        (i, node) for i, node in enumerate(gltf.nodes)
        if (node.name or "").startswith("shard_") and node.mesh is not None
    ]
    if not shard_nodes:
        print("[physics_ext] 警告: shard_* ノードが見つからないためスキップ", file=sys.stderr)
        return False

    root_node = next((n for n in gltf.nodes if n.name == "destructible_root"), None)
    root_extras = (root_node.extras if root_node and root_node.extras else {}) or {}
    friction = float(root_extras.get("crumble_friction", 0.5))
    restitution = float(root_extras.get("crumble_restitution", 0.3))

    # ----- physicsMaterial（全シャード共通: 1つの物体は同じ摩擦・反発係数を持つ） -----
    physics_material = {
        "staticFriction": friction,
        "dynamicFriction": friction,
        "restitution": restitution,
    }

    # ----- shape（シャードごとに convex hull、参照メッシュは export_glb.py が既に生成済み） -----
    shapes = []
    mesh_to_shape_index = {}
    for _, node in shard_nodes:
        if node.mesh not in mesh_to_shape_index:
            mesh_to_shape_index[node.mesh] = len(shapes)
            shapes.append({"type": "convex", "convex": {"mesh": node.mesh}})

    # ----- ドキュメントレベル拡張 -----
    if gltf.extensions is None:
        gltf.extensions = {}
    gltf.extensions[SHAPE_EXT] = {"shapes": shapes}
    gltf.extensions[BODY_EXT] = {"physicsMaterials": [physics_material]}

    for ext_name in (SHAPE_EXT, BODY_EXT):
        if ext_name not in gltf.extensionsUsed:
            gltf.extensionsUsed.append(ext_name)

    # ----- ノードレベル拡張（各シャードに dynamic body + collider を付与） -----
    for node_index, node in shard_nodes:
        extras = node.extras or {}
        mass = float(extras.get("crumble_shard_mass", 1.0))
        shape_index = mesh_to_shape_index[node.mesh]

        if node.extensions is None:
            node.extensions = {}
        node.extensions[BODY_EXT] = {
            "motion": {"type": "dynamic", "mass": mass},
            "collider": {"shape": shape_index, "physicsMaterial": 0},
        }

    gltf.save(glb_path)
    print(f"[physics_ext] {SHAPE_EXT}/{BODY_EXT} を {len(shard_nodes)} シャードに追加しました（実験的機能）")
    return True


if __name__ == "__main__":
    if len(sys.argv) != 2:
        print("使い方: python physics_extension.py <path/to/file.glb>", file=sys.stderr)
        sys.exit(1)
    ok = add_physics_extension(sys.argv[1])
    sys.exit(0 if ok else 1)
