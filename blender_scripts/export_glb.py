"""
メタデータ付き GLB エクスポート。
glTF extras（カスタムプロパティ）に物理パラメータを埋め込む。
"""
import bpy
from mathutils import Vector


def setup_root_and_export(
    intact_obj: bpy.types.Object,
    shards_empty: bpy.types.Object,
    shard_list: list,
    params: dict,
):
    """
    ルート Empty を作成してシーングラフを整理し、GLB としてエクスポートする。

    シーングラフ構造:
        destructible_root  ← extras にパラメータ
        ├── intact_mesh    ← 無傷の完全メッシュ
        └── shards         ← Empty グループ
            ├── shard_000
            ├── shard_001
            └── ...
    """

    # ----- ルート Empty 作成 -----
    bpy.ops.object.select_all(action='DESELECT')
    bpy.ops.object.empty_add(type='PLAIN_AXES', location=(0, 0, 0))
    root = bpy.context.active_object
    root.name = "destructible_root"

    # intact_mesh と shards を root にペアレント
    intact_obj.parent = root
    shards_empty.parent = root

    # ----- カスタムプロパティ → glTF extras -----
    # Blender の object["key"] = value は export_extras=True で extras.key に変換される
    root["crumble_type"] = params["type"]
    root["crumble_pieces"] = len(shard_list)
    root["crumble_seed"] = params.get("seed", 1)
    root["crumble_weight"] = params.get("weight", 10.0)
    root["crumble_fragility"] = params.get("fragility", 0.5)
    root["crumble_friction"] = params.get("friction", 0.5)
    root["crumble_restitution"] = params.get("restitution", 0.3)
    root["crumble_version"] = "1.0"

    # 各シャードにインデックスと重心を付与
    for i, shard in enumerate(shard_list):
        centroid = _calc_centroid(shard)
        shard["crumble_shard_index"] = i
        shard["crumble_centroid_x"] = centroid.x
        shard["crumble_centroid_y"] = centroid.y
        shard["crumble_centroid_z"] = centroid.z

    print(f"[export] メタデータ設定完了: {len(shard_list)} シャード")

    # ----- GLB エクスポート -----
    out_path = params["out"]
    try:
        bpy.ops.export_scene.gltf(
            filepath=out_path,
            export_format='GLB',
            use_selection=False,
            export_apply=True,        # モディファイア適用
            export_extras=True,       # カスタムプロパティを extras として出力
            export_yup=True,          # Blender Z-up → glTF Y-up 変換
            export_materials='EXPORT',
            export_normals=True,
            export_tangents=False,
            export_draco_mesh_compression_enable=False,
        )
        print(f"[export] GLB エクスポート完了: {out_path}")
    except Exception as e:
        # パラメータ名が Blender バージョンで異なる場合のフォールバック
        print(f"[export] 警告: パラメータエラー ({e})、最小パラメータでリトライ")
        bpy.ops.export_scene.gltf(
            filepath=out_path,
            export_format='GLB',
            export_extras=True,
            export_yup=True,
        )
        print(f"[export] GLB エクスポート完了（最小パラメータ）: {out_path}")


def _calc_centroid(obj: bpy.types.Object) -> Vector:
    """オブジェクトのワールド座標での重心を計算"""
    if not obj.data or not hasattr(obj.data, 'vertices') or not obj.data.vertices:
        return obj.location.copy()
    world_verts = [obj.matrix_world @ v.co for v in obj.data.vertices]
    if not world_verts:
        return obj.location.copy()
    centroid = sum(world_verts, Vector()) / len(world_verts)
    return centroid
