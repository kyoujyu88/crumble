"""
ガラス板の放射状クラック（クモの巣状）フラクチャ。
衝突点から放射状スポーク + 同心状リングカットで spider-web パターンを生成。
"""
import math
import random
import sys
import bpy
from mathutils import Vector


def apply_glass_fracture(source_obj, params: dict) -> list:
    size = params.get("size", 1.0)
    pieces = params.get("pieces", 20)
    seed = params.get("seed", 1)
    impact_x = params.get("impact_x", 0.0)  # -1..1 正規化座標
    impact_y = params.get("impact_y", 0.0)  # -1..1 正規化座標

    rng = random.Random(seed)

    # ガラスパネルは Blender Z-up で XZ 平面に沿った垂直パネル
    # glass.py: scale = (size, thickness, size*0.8)
    # 衝突点の Blender 座標: X=横, Z=縦（Y は奥行きで無視）
    half_w = size * 0.5            # X 方向の半幅
    half_h = size * 0.4            # Z 方向の半高さ (size*0.8 / 2)
    cz_center = size * 0.4         # パネル Z 中心 (0〜size*0.8 → 中心は size*0.4)

    # 衝突点のワールド座標（X, Z）
    cx = impact_x * half_w
    cz = cz_center + impact_y * half_h

    # スポーク数とリング数を pieces から決定
    n_radial = max(4, min(12, round(math.sqrt(pieces * 2))))
    n_rings = max(1, (pieces - 1) // (2 * n_radial))

    print(f"[glass_crack] 衝突点=({cx:.2f}, {cz:.2f}), スポーク={n_radial}, リング={n_rings}", file=sys.stderr)

    # source_obj は呼び出し元（generate_and_fracture.py）が削除するため
    # 複製を作成してそちらを操作する
    bpy.ops.object.select_all(action='DESELECT')
    source_obj.select_set(True)
    bpy.context.view_layer.objects.active = source_obj
    bpy.ops.object.duplicate(linked=False)
    working = bpy.context.active_object

    objects = [working]

    # === Step 1: 放射状カット（スポーク）===
    # 垂直パネル XZ 平面: 法線は XZ 平面内（Y成分=0）
    for k in range(n_radial):
        theta = k * math.pi / n_radial + rng.uniform(-0.04, 0.04)
        # XZ 平面内の法線ベクトル（Y=0）
        normal = Vector((-math.sin(theta), 0.0, math.cos(theta)))
        objects = _cut_all(objects, normal, Vector((cx, 0.0, cz)))

    # === Step 2: 同心状リングカット ===
    # 衝突点から四隅までの最大距離（XZ 平面）
    corners = [
        Vector((half_w - cx, 0, half_h + cz_center - cz)),
        Vector((-half_w - cx, 0, half_h + cz_center - cz)),
        Vector((half_w - cx, 0, -(half_h - (cz - cz_center)))),
        Vector((-half_w - cx, 0, -(half_h - (cz - cz_center)))),
    ]
    max_r = max(math.sqrt(c.x**2 + c.z**2) for c in corners)

    for ring_i in range(n_rings):
        # 冪乗分布: 衝突点近くほどリング間隔が狭い
        t = (ring_i + 1) / (n_rings + 1)
        r = max_r * (t ** 0.65)

        new_objects = []
        for obj in objects:
            if not obj.data or len(obj.data.vertices) < 4:
                new_objects.append(obj)
                continue

            # メッシュ重心を XZ 平面で計算
            verts_w = [obj.matrix_world @ v.co for v in obj.data.vertices]
            centroid = sum(verts_w, Vector()) / len(verts_w)
            dx = centroid.x - cx
            dz = centroid.z - cz
            dist = math.sqrt(dx * dx + dz * dz)

            if dist < 0.01:
                new_objects.append(obj)
                continue

            # 衝突点→重心方向の単位ベクトル（XZ 平面）
            nx, nz = dx / dist, dz / dist
            plane_co = Vector((cx + nx * r, 0.0, cz + nz * r))
            plane_no = Vector((nx, 0.0, nz))

            parts = _bisect_one(obj, plane_no, plane_co)
            new_objects.extend(parts)
        objects = new_objects

    print(f"[glass_crack] {len(objects)} シャード生成完了", file=sys.stderr)
    return objects


def _cut_all(objects, normal, plane_co):
    """全オブジェクトに同一平面で bisect を適用"""
    result = []
    for obj in objects:
        result.extend(_bisect_one(obj, normal, plane_co))
    return result


def _bisect_one(obj, normal, plane_co):
    """オブジェクトを平面で bisect して 1〜2 ピースを返す"""
    if not obj.data or len(obj.data.vertices) < 4:
        return [obj]

    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.duplicate(linked=False)
    obj_b = bpy.context.active_object

    _bisect_keep(obj, normal, plane_co, keep_positive=False)
    _bisect_keep(obj_b, normal, plane_co, keep_positive=True)

    a_ok = obj.data and len(obj.data.vertices) >= 4
    b_ok = obj_b.data and len(obj_b.data.vertices) >= 4

    if not a_ok and not b_ok:
        bpy.data.objects.remove(obj_b, do_unlink=True)
        return [obj]
    if not a_ok:
        bpy.data.objects.remove(obj, do_unlink=True)
        return [obj_b]
    if not b_ok:
        bpy.data.objects.remove(obj_b, do_unlink=True)
        return [obj]
    return [obj, obj_b]


def _bisect_keep(obj, normal, plane_co, keep_positive: bool):
    """メッシュを平面で切断し指定した側を残す"""
    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.mesh.bisect(
        plane_co=plane_co,
        plane_no=normal,
        use_fill=True,
        clear_inner=keep_positive,    # 正側を保持 → 負側（inner）を削除
        clear_outer=not keep_positive,
    )
    bpy.ops.object.mode_set(mode='OBJECT')
