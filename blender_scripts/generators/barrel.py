"""
樽（Barrel）のプロシージャルメッシュ生成。
Blender bpy 内で実行される。
"""
import bpy
import bmesh
from mathutils import Vector


def generate_barrel(params: dict) -> bpy.types.Object:
    """樽メッシュを生成してオブジェクトを返す"""
    size = params.get("size", 1.0)
    radius = 0.4 * size
    height = 0.8 * size

    # ----- 樽本体（シリンダー） -----
    bpy.ops.mesh.primitive_cylinder_add(
        vertices=16,
        radius=radius,
        depth=height,
        location=(0, 0, 0),
        end_fill_type='NGON',
    )
    body = bpy.context.active_object
    body.name = "barrel_body_tmp"

    # bmesh で中間付近の頂点を外側にスケール（樽の膨らみ）
    me = body.data
    bm = bmesh.new()
    bm.from_mesh(me)
    bm.verts.ensure_lookup_table()

    half_h = height / 2.0
    for v in bm.verts:
        # z が端に近いほど t→1、中央ほど t→0
        t = abs(v.co.z) / half_h if half_h > 0 else 1.0
        t = min(t, 1.0)
        # 中央が 1.18 倍に膨らむ放物線カーブ
        bulge = 1.0 + 0.18 * (1.0 - t * t)
        v.co.x *= bulge
        v.co.y *= bulge

    bm.to_mesh(me)
    bm.free()
    me.update()

    # ----- 金属フープ（トーラス）を 3 本追加 -----
    hoop_z = [-height * 0.30, 0.0, height * 0.30]
    hoop_objs = []
    for z in hoop_z:
        bpy.ops.mesh.primitive_torus_add(
            major_radius=radius * 1.07,
            minor_radius=0.022 * size,
            major_segments=24,
            minor_segments=8,
            location=(0, 0, z),
        )
        h = bpy.context.active_object
        h.name = f"hoop_tmp"
        hoop_objs.append(h)

    # ----- 全パーツを Join -----
    bpy.ops.object.select_all(action='DESELECT')
    for h in hoop_objs:
        h.select_set(True)
    body.select_set(True)
    bpy.context.view_layer.objects.active = body
    bpy.ops.object.join()
    barrel = bpy.context.active_object

    # ----- マテリアル（木材） -----
    mat = bpy.data.materials.new(name="BarrelWood")
    mat.use_nodes = True
    nodes = mat.node_tree.nodes
    bsdf = nodes.get("Principled BSDF")
    if bsdf:
        bsdf.inputs["Base Color"].default_value = (0.33, 0.18, 0.07, 1.0)
        bsdf.inputs["Roughness"].default_value = 0.85
        bsdf.inputs["Specular IOR Level"].default_value = 0.1 if "Specular IOR Level" in bsdf.inputs else None

    if barrel.data.materials:
        barrel.data.materials[0] = mat
    else:
        barrel.data.materials.append(mat)

    print(f"[barrel] 生成完了: 頂点数={len(barrel.data.vertices)}, ポリゴン数={len(barrel.data.polygons)}")
    return barrel
