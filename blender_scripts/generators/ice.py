"""氷塊（Ice）のプロシージャルメッシュ生成。角の丸い半透明の塊。"""
import random

import bmesh
import bpy
from mathutils import Vector, noise

from generators._common import apply_modifier, assign_material, new_material


def generate_ice(params: dict) -> bpy.types.Object:
    size = params.get("size", 1.0)
    seed = params.get("seed", 1)
    s = 0.65 * size

    bpy.ops.mesh.primitive_cube_add(size=s, location=(0, 0, s * 0.55))
    ice = bpy.context.active_object
    ice.name = "ice_body_tmp"

    # 角を丸めて氷の塊らしく
    apply_modifier(ice, 'BEVEL', name="Bevel",
                   width=0.12 * size, segments=3)

    # わずかなノイズ変形で自然な氷の凹凸
    rng = random.Random(seed)
    off = Vector((rng.uniform(0, 100), rng.uniform(0, 100), rng.uniform(0, 100)))
    me = ice.data
    bm = bmesh.new()
    bm.from_mesh(me)
    for v in bm.verts:
        n = noise.noise(v.co * 3.0 + off)
        v.co += v.normal * (n * 0.03 * size)
    bm.to_mesh(me)
    bm.free()
    me.update()

    # 半透明の青白いマテリアル
    mat = new_material("Ice", (0.78, 0.90, 0.98), roughness=0.08,
                       alpha=0.6, ior=1.31, transmission=0.6)
    assign_material(ice, mat)

    print(f"[ice] 生成完了: 頂点数={len(ice.data.vertices)}")
    return ice
