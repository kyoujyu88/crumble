"""
ジェネレータ共通ヘルパー。

- new_material: Principled BSDF マテリアルを版差に強く生成
- assign_material: オブジェクトに単一マテリアルを割り当て
- apply_modifier: モディファイアを追加して即適用
- lathe: (半径, 高さ) プロファイルから回転体（壺・鉢・柱）を生成
"""
import math

import bmesh
import bpy
from mathutils import Vector


def new_material(name, base_color, roughness=0.8, metallic=0.0,
                 alpha=1.0, ior=1.45, transmission=0.0):
    """Principled BSDF マテリアルを作る。Blender 4.x の入力名差を吸収する。"""
    mat = bpy.data.materials.new(name=name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    if bsdf:
        if "Base Color" in bsdf.inputs:
            bsdf.inputs["Base Color"].default_value = (*base_color, 1.0)
        if "Roughness" in bsdf.inputs:
            bsdf.inputs["Roughness"].default_value = roughness
        if "Metallic" in bsdf.inputs:
            bsdf.inputs["Metallic"].default_value = metallic
        if "Alpha" in bsdf.inputs:
            bsdf.inputs["Alpha"].default_value = alpha
        if "IOR" in bsdf.inputs:
            bsdf.inputs["IOR"].default_value = ior
        # Transmission は 4.0 で "Transmission Weight" に改名
        for key in ("Transmission Weight", "Transmission"):
            if key in bsdf.inputs:
                bsdf.inputs[key].default_value = transmission
                break
    if alpha < 1.0:
        mat.blend_method = 'BLEND'
    return mat


def assign_material(obj, mat):
    """オブジェクトに単一マテリアルを割り当てる。"""
    if obj.data.materials:
        obj.data.materials[0] = mat
    else:
        obj.data.materials.append(mat)


def apply_modifier(obj, mod_type, name="mod", **props):
    """モディファイアを追加してプロパティを設定し、即適用する。"""
    bpy.context.view_layer.objects.active = obj
    mod = obj.modifiers.new(name=name, type=mod_type)
    for k, v in props.items():
        setattr(mod, k, v)
    bpy.ops.object.modifier_apply(modifier=mod.name)


def lathe(profile, segments=24, name="lathe"):
    """
    回転体（solid of revolution）を bmesh で直接構築する。

    profile: [(radius, z), ...]  下から上へ。radius は絶対値。
    上下を扇状に閉じた多様体メッシュを返す（フラクチャに使える体積を持つ）。
    """
    mesh = bpy.data.meshes.new(name)
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)

    bm = bmesh.new()
    rings = []
    for (r, z) in profile:
        ring = []
        for i in range(segments):
            a = 2.0 * math.pi * i / segments
            ring.append(bm.verts.new((r * math.cos(a), r * math.sin(a), z)))
        rings.append(ring)

    # 側面
    for k in range(len(rings) - 1):
        lo, hi = rings[k], rings[k + 1]
        for i in range(segments):
            j = (i + 1) % segments
            bm.faces.new((lo[i], lo[j], hi[j], hi[i]))

    # 底（扇）
    bottom_c = bm.verts.new((0.0, 0.0, profile[0][1]))
    for i in range(segments):
        j = (i + 1) % segments
        bm.faces.new((bottom_c, rings[0][j], rings[0][i]))

    # 天（扇）
    top_c = bm.verts.new((0.0, 0.0, profile[-1][1]))
    for i in range(segments):
        j = (i + 1) % segments
        bm.faces.new((top_c, rings[-1][i], rings[-1][j]))

    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(mesh)
    bm.free()

    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    return obj
