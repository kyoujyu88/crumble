"""
Voronoi セルフラクチャ（樽・岩共用）。
Blender の Cell Fracture アドオンを使用する。
フォールバック: アドオンが使えない場合は簡易分割。
"""
import bpy
import random
import sys
from mathutils import Vector


def apply_voronoi_fracture(source_obj: bpy.types.Object, params: dict) -> list:
    """
    source_obj を Voronoi フラクチャして破片オブジェクトのリストを返す。
    source_obj は処理後も残る（呼び出し元で削除すること）。
    """
    pieces = params.get("pieces", 20)
    seed = params.get("seed", 1)

    # ----- Cell Fracture アドオンを有効化 -----
    addon_ok = _enable_cell_fracture()

    if addon_ok:
        shards = _fracture_with_addon(source_obj, pieces, seed, params)
    else:
        shards = _fracture_fallback(source_obj, pieces, seed, params)

    if not shards:
        print("[voronoi] 警告: シャードが生成されなかった。ソースをそのままシャードとして使用", file=sys.stderr)
        source_obj.name = "shard_000"
        return [source_obj]

    # ----- 命名と素材コピー -----
    src_mats = list(source_obj.data.materials) if source_obj.data else []
    for i, shard in enumerate(sorted(shards, key=lambda o: (o.location.x, o.location.y, o.location.z))):
        shard.name = f"shard_{i:03d}"
        if not shard.data.materials and src_mats:
            for mat in src_mats:
                shard.data.materials.append(mat)

    print(f"[voronoi] {len(shards)} シャード生成完了")
    return shards


def _enable_cell_fracture() -> bool:
    """Cell Fracture アドオンを有効化して成功可否を返す"""
    try:
        result = bpy.ops.preferences.addon_enable(module="object_fracture_cell")
        # オペレータが実際に登録されているか確認
        if hasattr(bpy.ops.object, 'add_fracture_cell_objects'):
            print("[voronoi] Cell Fracture アドオン有効化成功")
            return True
        print("[voronoi] Cell Fracture オペレータが見つからない")
        return False
    except Exception as e:
        print(f"[voronoi] Cell Fracture アドオン有効化失敗: {e}")
        return False


def _fracture_with_addon(source_obj, pieces, seed, params) -> list:
    """Cell Fracture アドオンでフラクチャ"""

    # ----- パーティクルシステムで乱数シードを制御 -----
    bpy.ops.object.select_all(action='DESELECT')
    source_obj.select_set(True)
    bpy.context.view_layer.objects.active = source_obj

    use_particle = False
    try:
        bpy.ops.object.particle_system_add()
        psys = source_obj.particle_systems[-1]
        psys.seed = seed % 32767   # seed は ParticleSystem レベルの属性
        pset = psys.settings
        pset.count = pieces
        pset.emit_from = 'VOLUME'
        pset.physics_type = 'NO'
        pset.distribution = 'RAND'
        pset.use_emit_random = True
        pset.use_even_distribution = True

        # 依存グラフを更新してパーティクル位置を確定
        bpy.context.scene.frame_set(1)
        bpy.context.view_layer.update()
        bpy.context.evaluated_depsgraph_get().update()

        use_particle = True
        print(f"[voronoi] パーティクルシステム設定完了: count={pieces}, seed={seed}")
    except Exception as e:
        print(f"[voronoi] パーティクル設定失敗 ({e})、VERT_OWN にフォールバック")

    # ----- フラクチャ前のオブジェクト一覧を記録 -----
    before = {o.name for o in bpy.data.objects}

    source_param = {'PARTICLE_OWN'} if use_particle else {'VERT_OWN'}

    try:
        bpy.ops.object.add_fracture_cell_objects(
            source=source_param,
            source_limit=pieces,
            source_noise=0.05,
            use_smooth_faces=False,
            use_sharp_edges=True,
            use_data_match=True,
            use_island_split=True,
            margin=0.001,
        )
    except Exception as e:
        print(f"[voronoi] Cell Fracture オペレータ失敗: {e}")
        return _fracture_fallback(source_obj, pieces, seed, params)

    # ----- 新しく生成されたシャードを収集 -----
    after = {o.name for o in bpy.data.objects}
    new_names = after - before - {source_obj.name}
    shards = [
        bpy.data.objects[n]
        for n in new_names
        if n in bpy.data.objects and bpy.data.objects[n].type == 'MESH'
    ]

    if not shards:
        print("[voronoi] Cell Fracture がシャードを生成しなかった")
        return _fracture_fallback(source_obj, pieces, seed, params)

    return shards


def _fracture_fallback(source_obj, pieces, seed, params) -> list:
    """
    Cell Fracture が使えない場合のフォールバック。
    bounding box を軸方向ランダムに二分割を繰り返してシャードを近似。
    """
    print("[voronoi] フォールバックフラクチャ: BSP 平面分割")

    rng = random.Random(seed)
    objects = [source_obj]

    target_count = min(pieces, 64)  # フォールバックは最大64分割
    iterations = 0
    max_iters = target_count * 3

    while len(objects) < target_count and iterations < max_iters:
        iterations += 1
        obj = objects[rng.randint(0, len(objects) - 1)]
        if len(obj.data.vertices) < 6:
            continue

        # ランダムな法線方向（軸揃え）と位置で bisect
        axis = rng.choice(['X', 'Y', 'Z'])
        bb = [obj.matrix_world @ Vector(c) for c in obj.bound_box]
        if axis == 'X':
            coords = [v.x for v in bb]
        elif axis == 'Y':
            coords = [v.y for v in bb]
        else:
            coords = [v.z for v in bb]

        lo, hi = min(coords), max(coords)
        if hi - lo < 0.01:
            continue
        cut = rng.uniform(lo + (hi - lo) * 0.2, lo + (hi - lo) * 0.8)

        normal = {'X': (1, 0, 0), 'Y': (0, 1, 0), 'Z': (0, 0, 1)}[axis]
        plane_co = {'X': (cut, 0, 0), 'Y': (0, cut, 0), 'Z': (0, 0, cut)}[axis]

        # オブジェクトを選択して bisect
        bpy.ops.object.select_all(action='DESELECT')
        obj.select_set(True)
        bpy.context.view_layer.objects.active = obj
        bpy.ops.object.duplicate(linked=False)
        obj_b = bpy.context.active_object

        # obj を法線+側に、obj_b を法線-側にトリム
        _bisect_keep_side(obj, normal, plane_co, keep_positive=True)
        _bisect_keep_side(obj_b, normal, plane_co, keep_positive=False)

        if len(obj.data.vertices) < 4:
            bpy.data.objects.remove(obj_b, do_unlink=True)
            continue
        if len(obj_b.data.vertices) < 4:
            bpy.data.objects.remove(obj_b, do_unlink=True)
            continue

        objects.append(obj_b)

    print(f"[voronoi] フォールバック: {len(objects)} シャード生成")
    return objects


def _bisect_keep_side(obj, normal, plane_co, keep_positive: bool):
    """メッシュを平面で二分してどちらかの側を残す"""
    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.mesh.bisect(
        plane_co=plane_co,
        plane_no=normal,
        use_fill=True,
        clear_inner=keep_positive,   # 負側を削除
        clear_outer=not keep_positive,  # 正側を削除
    )
    bpy.ops.object.mode_set(mode='OBJECT')
