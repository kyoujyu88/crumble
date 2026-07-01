"""
メタデータ付き GLB エクスポート。
glTF extras（カスタムプロパティ）に物理パラメータを埋め込む。
"""
import sys

import bmesh
import bpy
from mathutils import Vector

# fragility(0.0-1.0) → 散乱インパルス強度(N) の変換係数。
# viewer/src/PhysicsWorld.js の _applyScatterImpulse と同じ値を使うこと。
SCATTER_FORCE_PER_FRAGILITY = 15.0


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

    # viewer の syncMeshes() は「shards グループの親はすべて identity transform」を
    # 前提にしている（rigid body のワールド座標をそのまま mesh.position に代入するため）。
    # この前提が崩れると他アプリ・他エンジンに持ち込んだ時に破片が誤った位置に飛ぶので、
    # エクスポート直前に検証しておく。
    for node, label in ((root, "destructible_root"), (intact_obj, "intact_mesh"), (shards_empty, "shards")):
        _assert_identity_transform(node, label)

    # ----- カスタムプロパティ → glTF extras -----
    # Blender の object["key"] = value は export_extras=True で extras.key に変換される
    fragility = params.get("fragility", 0.5)
    total_weight = params.get("weight", 10.0)

    root["crumble_type"] = params["type"]
    root["crumble_pieces"] = len(shard_list)
    root["crumble_seed"] = params.get("seed", 1)
    root["crumble_weight"] = total_weight
    root["crumble_fragility"] = fragility
    root["crumble_friction"] = params.get("friction", 0.5)
    root["crumble_restitution"] = params.get("restitution", 0.3)
    # 他エンジンが式を再実装しなくて済むよう、計算済みの散乱インパルス強度も渡す
    root["crumble_scatter_force"] = fragility * SCATTER_FORCE_PER_FRAGILITY
    root["crumble_version"] = "1.0"

    # 各シャードの体積を計算し、総質量を体積比で配分する（均等割りより実際の挙動に近い）
    volumes = [_calc_volume(shard) for shard in shard_list]
    total_volume = sum(volumes)

    # 各シャードにインデックス・重心・質量を付与
    for i, (shard, volume) in enumerate(zip(shard_list, volumes)):
        centroid = _calc_centroid(shard)
        shard["crumble_shard_index"] = i
        shard["crumble_centroid_x"] = centroid.x
        shard["crumble_centroid_y"] = centroid.y
        shard["crumble_centroid_z"] = centroid.z
        if total_volume > 1e-9:
            shard["crumble_shard_mass"] = total_weight * (volume / total_volume)
        else:
            shard["crumble_shard_mass"] = total_weight / max(len(shard_list), 1)

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


def _calc_volume(obj: bpy.types.Object) -> float:
    """
    マニフォールドメッシュのワールド空間での体積を計算する（符号付き四面体分割法）。
    シャードは Cell Fracture / BSP 分割いずれも閉じたソリッドを生成する前提。
    """
    if not obj.data or not hasattr(obj.data, 'polygons') or not obj.data.polygons:
        return 0.0

    bm = bmesh.new()
    bm.from_mesh(obj.data)
    bm.transform(obj.matrix_world)
    bmesh.ops.triangulate(bm, faces=bm.faces)

    volume = 0.0
    for face in bm.faces:
        v0, v1, v2 = (v.co for v in face.verts)
        volume += v0.dot(v1.cross(v2)) / 6.0

    bm.free()
    return abs(volume)


def _assert_identity_transform(obj: bpy.types.Object, label: str, eps: float = 1e-6):
    """
    ノードの位置・回転・スケールが identity かどうかを検証し、崩れていれば警告する。
    （root / intact_mesh / shards は viewer 側で identity 前提のコードがあるため）
    """
    loc_ok = all(abs(c) < eps for c in obj.location)
    rot_ok = all(abs(c) < eps for c in obj.rotation_euler)
    scale_ok = all(abs(c - 1.0) < eps for c in obj.scale)

    if not (loc_ok and rot_ok and scale_ok):
        print(
            f"[export] 警告: '{label}' が identity transform ではありません "
            f"(location={tuple(obj.location)}, rotation={tuple(obj.rotation_euler)}, "
            f"scale={tuple(obj.scale)})。破壊時のシャード位置が他エンジンでズレる原因になります。",
            file=sys.stderr,
        )
