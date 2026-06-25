"""コンクリブロック（Concrete）のプロシージャルメッシュ生成。"""
import bpy

from generators._common import apply_modifier, assign_material, new_material


def generate_concrete(params: dict) -> bpy.types.Object:
    size = params.get("size", 1.0)

    # 横長のブロック比率（X:Y:Z ≈ 1.6:0.7:0.7）
    bpy.ops.mesh.primitive_cube_add(size=1.0, location=(0, 0, 0.35 * size))
    block = bpy.context.active_object
    block.name = "concrete_body_tmp"
    block.scale = (0.8 * size, 0.35 * size, 0.35 * size)
    bpy.ops.object.transform_apply(scale=True)

    apply_modifier(block, 'BEVEL', name="Bevel",
                   width=0.012 * size, segments=1)

    mat = new_material("Concrete", (0.62, 0.62, 0.60), roughness=0.95)
    assign_material(block, mat)

    print(f"[concrete] 生成完了: 頂点数={len(block.data.vertices)}")
    return block
