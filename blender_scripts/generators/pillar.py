"""石柱（Pillar）のプロシージャルメッシュ生成。基壇・シャフト・柱頭の旋盤形状。"""
import bpy

from generators._common import assign_material, lathe, new_material


def generate_pillar(params: dict) -> bpy.types.Object:
    size = params.get("size", 1.0)
    R = 0.22 * size
    H = 1.40 * size   # 背の高い柱

    # 基壇（広）→ シャフト（やや膨らむエンタシス）→ 柱頭（広）
    shape = [
        (1.00, 0.00), (1.00, 0.05), (0.78, 0.10), (0.74, 0.30),
        (0.76, 0.50), (0.74, 0.70), (0.78, 0.88), (1.00, 0.93),
        (1.00, 1.00),
    ]
    profile = [(R * m, H * f) for (m, f) in shape]
    pillar = lathe(profile, segments=24, name="pillar_body_tmp")

    mat = new_material("PillarStone", (0.78, 0.75, 0.68), roughness=0.9)
    assign_material(pillar, mat)

    print(f"[pillar] 生成完了: 頂点数={len(pillar.data.vertices)}")
    return pillar
