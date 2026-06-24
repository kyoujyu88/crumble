#!/usr/bin/env python3
"""
Blender が実行するマスタースクリプト。
pipeline.py から以下のように呼ばれる:
    blender --background --python generate_and_fracture.py -- '<json_params>'
"""
import sys
import json
from pathlib import Path

# blender_scripts ディレクトリを sys.path に追加してローカルインポートを有効化
_scripts_dir = Path(__file__).parent
if str(_scripts_dir) not in sys.path:
    sys.path.insert(0, str(_scripts_dir))

import bpy


def parse_params() -> dict:
    """sys.argv の '--' 以降のJSON引数をパース"""
    try:
        sep = sys.argv.index("--")
        raw = sys.argv[sep + 1]
        return json.loads(raw)
    except (ValueError, IndexError):
        print("[generate] エラー: -- の後にJSONパラメータが見つかりません", file=sys.stderr)
        print(f"[generate] sys.argv = {sys.argv}", file=sys.stderr)
        sys.exit(1)
    except json.JSONDecodeError as e:
        print(f"[generate] エラー: JSONパースに失敗: {e}", file=sys.stderr)
        sys.exit(1)


def reset_scene():
    """Blenderシーンを完全にリセット"""
    # 全オブジェクト削除
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.object.delete(use_global=False)

    # 孤立データを削除
    for block in list(bpy.data.meshes):
        bpy.data.meshes.remove(block)
    for block in list(bpy.data.materials):
        bpy.data.materials.remove(block)
    for block in list(bpy.data.curves):
        bpy.data.curves.remove(block)


def duplicate_object(obj: bpy.types.Object) -> bpy.types.Object:
    """オブジェクトを複製してアクティブに設定"""
    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.duplicate(linked=False)
    dup = bpy.context.active_object
    return dup


def main():
    params = parse_params()
    obj_type = params["type"]

    print(f"[generate] ===== 生成開始 =====")
    print(f"[generate] type={obj_type}, pieces={params['pieces']}, seed={params['seed']}")
    print(f"[generate] 出力先: {params['out']}")

    reset_scene()

    # --------- メッシュ生成 ---------
    if obj_type == "barrel":
        from generators.barrel import generate_barrel
        intact_obj = generate_barrel(params)
    elif obj_type == "rock":
        from generators.rock import generate_rock
        intact_obj = generate_rock(params)
    elif obj_type == "glass":
        from generators.glass import generate_glass
        intact_obj = generate_glass(params)
    else:
        print(f"[generate] エラー: 未対応のタイプ: {obj_type}", file=sys.stderr)
        sys.exit(1)

    intact_obj.name = "intact_mesh"
    print(f"[generate] メッシュ生成完了: 頂点数={len(intact_obj.data.vertices)}")

    # --------- フラクチャ用に複製 ---------
    fracture_source = duplicate_object(intact_obj)
    fracture_source.name = "fracture_source_tmp"

    # --------- フラクチャ適用 ---------
    if obj_type == "glass":
        from fracture.glass_crack import apply_glass_fracture
        shard_objects = apply_glass_fracture(fracture_source, params)
    else:
        from fracture.voronoi_cell import apply_voronoi_fracture
        shard_objects = apply_voronoi_fracture(fracture_source, params)

    print(f"[generate] フラクチャ完了: {len(shard_objects)} 個のシャード")

    # --------- フラクチャソース削除 ---------
    if fracture_source.name in bpy.data.objects:
        bpy.data.objects.remove(fracture_source, do_unlink=True)

    # --------- シャードグループ(Empty)作成 ---------
    bpy.ops.object.select_all(action='DESELECT')
    bpy.ops.object.empty_add(type='PLAIN_AXES', location=(0, 0, 0))
    shards_empty = bpy.context.active_object
    shards_empty.name = "shards"

    for shard in shard_objects:
        shard.parent = shards_empty

    # --------- メタデータ付きGLBエクスポート ---------
    from export_glb import setup_root_and_export
    setup_root_and_export(intact_obj, shards_empty, shard_objects, params)

    print(f"[generate] ===== 完了 =====")


main()
