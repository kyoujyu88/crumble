"""
岩（Rock）のプロシージャルメッシュ生成。（フェーズ2）
"""
import bpy
import bmesh
import random
from mathutils import Vector, noise


def generate_rock(params: dict) -> bpy.types.Object:
    """岩メッシュを生成してオブジェクトを返す（フェーズ2実装）"""
    size = params.get("size", 1.0)
    seed = params.get("seed", 1)

    # IcoSphere をベースに
    bpy.ops.mesh.primitive_ico_sphere_add(
        subdivisions=3,
        radius=0.5 * size,
        location=(0, 0, 0),
    )
    rock = bpy.context.active_object
    rock.name = "rock_body_tmp"

    # bmesh でノイズ変形（岩らしい凸凹）
    rng = random.Random(seed)
    offset = Vector((rng.uniform(0, 100), rng.uniform(0, 100), rng.uniform(0, 100)))

    me = rock.data
    bm = bmesh.new()
    bm.from_mesh(me)
    bm.verts.ensure_lookup_table()

    for v in bm.verts:
        n = noise.noise(v.co * 2.5 + offset)
        n2 = noise.noise(v.co * 5.0 + offset * 1.7)
        displacement = (n * 0.25 + n2 * 0.10) * size
        v.co += v.normal * displacement

    bm.to_mesh(me)
    bm.free()
    me.update()

    # マテリアル（石）
    mat = bpy.data.materials.new(name="RockStone")
    mat.use_nodes = True
    nodes = mat.node_tree.nodes
    bsdf = nodes.get("Principled BSDF")
    if bsdf:
        bsdf.inputs["Base Color"].default_value = (0.45, 0.42, 0.38, 1.0)
        bsdf.inputs["Roughness"].default_value = 0.95

    if rock.data.materials:
        rock.data.materials[0] = mat
    else:
        rock.data.materials.append(mat)

    print(f"[rock] 生成完了: 頂点数={len(rock.data.vertices)}")
    return rock
