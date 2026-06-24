"""
ガラス板（Glass）のプロシージャルメッシュ生成。（フェーズ3）
"""
import bpy


def generate_glass(params: dict) -> bpy.types.Object:
    """ガラス板メッシュを生成してオブジェクトを返す（フェーズ3実装）"""
    size = params.get("size", 1.0)
    thickness = 0.04 * size

    # Blender Z-up: X=幅, Y=奥行き(薄), Z=高さ
    # export_yup 後 three.js: X=幅, Y=高さ, Z=奥行き
    # Z を 0〜height にして地面（Z=0）に接する垂直パネル
    height = size * 0.8
    bpy.ops.mesh.primitive_cube_add(
        size=1.0,
        location=(0, 0, height * 0.5),  # 中心を高さ半分に
    )
    glass = bpy.context.active_object
    glass.name = "glass_body_tmp"
    glass.scale = (size, thickness, height)
    bpy.ops.object.transform_apply(scale=True)

    # マテリアル（ガラス）
    mat = bpy.data.materials.new(name="Glass")
    mat.use_nodes = True
    mat.blend_method = 'BLEND'
    nodes = mat.node_tree.nodes
    bsdf = nodes.get("Principled BSDF")
    if bsdf:
        bsdf.inputs["Base Color"].default_value = (0.85, 0.95, 1.0, 1.0)
        bsdf.inputs["Alpha"].default_value = 0.3
        bsdf.inputs["Roughness"].default_value = 0.0
        bsdf.inputs["IOR"].default_value = 1.45

    if glass.data.materials:
        glass.data.materials[0] = mat
    else:
        glass.data.materials.append(mat)

    print(f"[glass] 生成完了 (フェーズ3スタブ)")
    return glass
