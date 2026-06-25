"""植木鉢（Pot）のプロシージャルメッシュ生成。上が広い円錐台＋縁。"""
import bpy

from generators._common import assign_material, lathe, new_material


def generate_pot(params: dict) -> bpy.types.Object:
    size = params.get("size", 1.0)
    R = 0.36 * size
    H = 0.52 * size

    # 下がすぼまり上が広い円錐台。最上部に少し張り出した縁。
    shape = [
        (0.60, 0.00), (0.62, 0.05), (0.78, 0.45), (0.98, 0.88),
        (1.08, 0.92), (1.08, 1.00),
    ]
    profile = [(R * m, H * f) for (m, f) in shape]
    pot = lathe(profile, segments=26, name="pot_body_tmp")

    mat = new_material("Terracotta", (0.70, 0.34, 0.20), roughness=0.85)
    assign_material(pot, mat)

    print(f"[pot] 生成完了: 頂点数={len(pot.data.vertices)}")
    return pot
