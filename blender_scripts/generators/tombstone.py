"""墓石（Tombstone）のプロシージャルメッシュ生成。アーチ型の石板。"""
import bpy

from generators._common import apply_modifier, assign_material, new_material


def generate_tombstone(params: dict) -> bpy.types.Object:
    size = params.get("size", 1.0)
    w, d, h = 0.55 * size, 0.16 * size, 0.95 * size

    bpy.ops.mesh.primitive_cube_add(size=1.0, location=(0, 0, h * 0.5))
    stone = bpy.context.active_object
    stone.name = "tombstone_body_tmp"
    stone.scale = (w, d, h)
    bpy.ops.object.transform_apply(scale=True)

    # 上端を大きめに面取りしてアーチ風の丸みを付ける
    apply_modifier(stone, 'BEVEL', name="Bevel",
                   width=min(w, d) * 0.45, segments=4)

    mat = new_material("Tombstone", (0.50, 0.50, 0.52), roughness=0.9)
    assign_material(stone, mat)

    print(f"[tombstone] 生成完了: 頂点数={len(stone.data.vertices)}")
    return stone
