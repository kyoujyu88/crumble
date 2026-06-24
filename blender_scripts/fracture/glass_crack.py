"""
ガラス板の放射状クラック（クモの巣状）フラクチャ。（フェーズ3）
現在は voronoi_cell.py の Voronoi フラクチャを流用するスタブ実装。
フェーズ3で衝突点起点の放射状パターンに拡張予定。
"""
from fracture.voronoi_cell import apply_voronoi_fracture


def apply_glass_fracture(source_obj, params: dict) -> list:
    """
    ガラス板を放射状クラックでフラクチャ。
    フェーズ3スタブ: Voronoi フラクチャで代替。
    TODO: impact_x, impact_y パラメータを使った中心密集型 Voronoi シード分布に拡張
    """
    print("[glass_crack] フェーズ3スタブ: Voronoi フラクチャで代替")
    return apply_voronoi_fracture(source_obj, params)
