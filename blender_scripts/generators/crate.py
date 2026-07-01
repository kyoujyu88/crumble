"""木箱（Crate）のプロシージャルメッシュ生成。"""
import bpy

from generators._common import apply_modifier, assign_material, new_material


def generate_crate(params: dict) -> bpy.types.Object:
    size = params.get("size", 1.0)
    s = 0.7 * size

    bpy.ops.mesh.primitive_cube_add(size=s, location=(0, 0, s * 0.5))
    crate = bpy.context.active_object
    crate.name = "crate_body_tmp"

    # 角を少し面取りして「木箱」らしいゴツさを出す
    apply_modifier(crate, 'BEVEL', name="Bevel",
                   width=0.02 * size, segments=2)

    mat = new_material("CrateWood", (0.42, 0.27, 0.12), roughness=0.85)
    assign_material(crate, mat)

    print(f"[crate] 生成完了: 頂点数={len(crate.data.vertices)}")
    return crate
