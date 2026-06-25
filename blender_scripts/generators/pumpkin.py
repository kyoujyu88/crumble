"""カボチャ（Pumpkin）のプロシージャルメッシュ生成。縦溝（リブ）入りの扁球。"""
import math

import bmesh
import bpy

from generators._common import assign_material, new_material


def generate_pumpkin(params: dict) -> bpy.types.Object:
    size = params.get("size", 1.0)
    radius = 0.46 * size

    bpy.ops.mesh.primitive_uv_sphere_add(
        segments=24, ring_count=16, radius=radius, location=(0, 0, 0))
    pumpkin = bpy.context.active_object
    pumpkin.name = "pumpkin_body_tmp"

    me = pumpkin.data
    bm = bmesh.new()
    bm.from_mesh(me)

    ribs = 8  # 縦溝の数
    for v in bm.verts:
        # 上下に潰す
        v.co.z *= 0.78
        # 経度方向に cos で半径変調 → リブ
        theta = math.atan2(v.co.y, v.co.x)
        rib = 1.0 - 0.12 * (0.5 + 0.5 * math.cos(ribs * theta))
        v.co.x *= rib
        v.co.y *= rib

    bm.to_mesh(me)
    bm.free()
    me.update()

    # 接地させる
    pumpkin.location = (0, 0, radius * 0.78)
    bpy.ops.object.transform_apply(location=True)

    mat = new_material("Pumpkin", (0.85, 0.40, 0.10), roughness=0.6)
    assign_material(pumpkin, mat)

    print(f"[pumpkin] 生成完了: 頂点数={len(pumpkin.data.vertices)}")
    return pumpkin
