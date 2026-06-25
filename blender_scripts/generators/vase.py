"""花瓶・壺（Vase）のプロシージャルメッシュ生成。回転体。"""
import bpy

from generators._common import assign_material, lathe, new_material


def generate_vase(params: dict) -> bpy.types.Object:
    size = params.get("size", 1.0)
    R = 0.30 * size   # 最大半径の基準
    H = 0.90 * size   # 高さ

    # (半径倍率, 高さ割合) 下→上：すぼまった足→膨らんだ胴→細い首→開いた口
    shape = [
        (0.55, 0.00), (0.46, 0.05), (0.72, 0.14), (1.00, 0.32),
        (0.92, 0.46), (0.58, 0.64), (0.40, 0.80), (0.48, 0.92),
        (0.58, 1.00),
    ]
    profile = [(R * m, H * f) for (m, f) in shape]
    vase = lathe(profile, segments=28, name="vase_body_tmp")

    mat = new_material("VaseCeramic", (0.30, 0.45, 0.60),
                       roughness=0.25, metallic=0.0)
    assign_material(vase, mat)

    print(f"[vase] 生成完了: 頂点数={len(vase.data.vertices)}")
    return vase
