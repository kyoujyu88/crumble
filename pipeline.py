#!/usr/bin/env python3
"""
Crumble — 破壊可能3Dオブジェクト生成パイプライン

使い方:
    python pipeline.py --type barrel --pieces 20 --seed 1 --out output/barrel.glb
    python pipeline.py --type barrel --pieces 30 --seed 42 --weight 50 --fragility 0.8 --out output/heavy_barrel.glb
"""
import argparse
import json
import subprocess
import sys
from pathlib import Path


def main():
    parser = argparse.ArgumentParser(
        description="破壊可能3Dオブジェクトを生成してGLBとして出力します",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
パラメータ例:
  # 標準的な樽（20破片）
  python pipeline.py --type barrel --pieces 20 --seed 1 --out output/barrel.glb

  # 重い頑丈な樽（壊れにくい）
  python pipeline.py --type barrel --pieces 15 --seed 2 --weight 80 --fragility 0.2 --out output/heavy.glb

  # 軽くて脆い樽（派手に割れる）
  python pipeline.py --type barrel --pieces 30 --seed 3 --weight 2 --fragility 1.0 --out output/fragile.glb
        """,
    )

    parser.add_argument("--type", choices=["barrel", "rock", "glass"], required=True,
                        help="オブジェクト種別 (barrel/rock/glass)")
    parser.add_argument("--pieces", type=int, default=20,
                        help="破片数 (デフォルト: 20)")
    parser.add_argument("--seed", type=int, default=1,
                        help="乱数シード — 同じシードで同じ割れ方を再現 (デフォルト: 1)")
    parser.add_argument("--out", required=True,
                        help="出力GLBファイルパス")
    parser.add_argument("--size", type=float, default=1.0,
                        help="スケール倍率 (デフォルト: 1.0)")
    parser.add_argument("--weight", type=float, default=10.0,
                        help="総質量 kg — 大きいほど破片が重く落ちる (デフォルト: 10.0)")
    parser.add_argument("--fragility", type=float, default=0.5,
                        help="壊れやすさ 0.0〜1.0 — 大きいほど派手に飛び散る (デフォルト: 0.5)")
    parser.add_argument("--friction", type=float, default=0.5,
                        help="摩擦係数 0.0〜1.0 (デフォルト: 0.5)")
    parser.add_argument("--restitution", type=float, default=0.3,
                        help="反発係数 0.0〜1.0 — 大きいほどよく跳ねる (デフォルト: 0.3)")
    parser.add_argument("--blender", default="blender",
                        help="Blenderバイナリのパス (デフォルト: blender)")

    args = parser.parse_args()

    # 値の範囲チェック
    if not 0.0 <= args.fragility <= 1.0:
        parser.error("--fragility は 0.0〜1.0 の範囲で指定してください")
    if not 0.0 <= args.friction <= 1.0:
        parser.error("--friction は 0.0〜1.0 の範囲で指定してください")
    if not 0.0 <= args.restitution <= 1.0:
        parser.error("--restitution は 0.0〜1.0 の範囲で指定してください")
    if args.pieces < 2:
        parser.error("--pieces は 2 以上を指定してください")
    if args.weight <= 0:
        parser.error("--weight は正の値を指定してください")

    # 出力ディレクトリを作成
    out_path = Path(args.out)
    out_path.parent.mkdir(parents=True, exist_ok=True)

    params = {
        "type": args.type,
        "pieces": args.pieces,
        "seed": args.seed,
        "out": str(out_path.resolve()),
        "size": args.size,
        "weight": args.weight,
        "fragility": args.fragility,
        "friction": args.friction,
        "restitution": args.restitution,
    }

    script = Path(__file__).parent / "blender_scripts" / "generate_and_fracture.py"
    if not script.exists():
        print(f"エラー: スクリプトが見つかりません: {script}", file=sys.stderr)
        sys.exit(1)

    cmd = [
        args.blender,
        "--background",
        "--python", str(script),
        "--",
        json.dumps(params),
    ]

    print(f"[pipeline] 生成開始: type={args.type}, pieces={args.pieces}, seed={args.seed}")
    print(f"[pipeline] 物理パラメータ: weight={args.weight}kg, fragility={args.fragility}, friction={args.friction}, restitution={args.restitution}")
    print(f"[pipeline] 出力先: {args.out}")
    print()

    result = subprocess.run(cmd)

    if result.returncode != 0:
        print(f"\n[pipeline] エラー: Blenderが終了コード {result.returncode} で失敗しました", file=sys.stderr)
        print("ヒント: Blenderがインストールされているか確認してください (bash setup.sh)", file=sys.stderr)
        sys.exit(result.returncode)

    if not out_path.exists():
        print(f"\n[pipeline] エラー: GLBファイルが生成されませんでした: {args.out}", file=sys.stderr)
        sys.exit(1)

    size_kb = out_path.stat().st_size / 1024
    print(f"\n[pipeline] 完了: {args.out} ({size_kb:.1f} KB)")
    print(f"[pipeline] ビューアで確認: cd viewer && npm run dev")
    print(f"[pipeline]   → http://localhost:5173/?glb=../{args.out}")


if __name__ == "__main__":
    main()
