"""卵（Egg）のプロシージャルメッシュ生成。片側がすぼまった回転楕円体。"""
import bpy

from generators._common import assign_material, new_material


def generate_egg(params: dict) -> bpy.types.Object:
    size = params.get("size", 1.0)
    radius = 0.34 * size

    bpy.ops.mesh.primitive_uv_sphere_add(
        segments=20, ring_count=14, radius=radius, location=(0, 0, 0))
    egg = bpy.context.active_object
    egg.name = "egg_body_tmp"

    me = egg.data
    import bmesh
    bm = bmesh.new()
    bm.from_mesh(me)

    zmax = radius
    for v in bm.verts:
        v.co.z *= 1.30  # 縦に伸ばす
        # 上半分をすぼめて卵型に
        if v.co.z > 0:
            taper = 1.0 - 0.28 * (v.co.z / (zmax * 1.30))
            v.co.x *= taper
            v.co.y *= taper

    bm.to_mesh(me)
    bm.free()
    me.update()

    egg.location = (0, 0, radius * 1.30)
    bpy.ops.object.transform_apply(location=True)

    mat = new_material("Eggshell", (0.93, 0.88, 0.80), roughness=0.4)
    assign_material(egg, mat)

    print(f"[egg] 生成完了: 頂点数={len(egg.data.vertices)}")
    return egg
