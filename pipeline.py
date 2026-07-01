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

  # 自然言語プロンプトから生成（フェーズ4）
  python pipeline.py --prompt "重い木製の樽を30破片で派手に割れるように" --out output/x.glb
        """,
    )

    parser.add_argument("--prompt", default=None,
                        help="自然言語の指示からパラメータを推定（明示引数があればそちらが優先）")
    parser.add_argument("--no-llm", action="store_true",
                        help="プロンプト解析で LLM フォールバックを使わない（ルールベースのみ）")
    parser.add_argument("--dry-run", action="store_true",
                        help="解決したパラメータを表示して終了（Blender を起動しない）")
    from prompt_parser import TYPES as VALID_TYPES
    parser.add_argument("--type", choices=VALID_TYPES, default=None,
                        help="オブジェクト種別 (" + "/".join(VALID_TYPES) + ")")
    parser.add_argument("--pieces", type=int, default=None,
                        help="破片数 (デフォルト: 20)")
    parser.add_argument("--seed", type=int, default=None,
                        help="乱数シード — 同じシードで同じ割れ方を再現 (デフォルト: 1)")
    parser.add_argument("--out", required=True,
                        help="出力GLBファイルパス")
    parser.add_argument("--size", type=float, default=None,
                        help="スケール倍率 (デフォルト: 1.0)")
    parser.add_argument("--weight", type=float, default=None,
                        help="総質量 kg — 大きいほど破片が重く落ちる (デフォルト: 10.0)")
    parser.add_argument("--fragility", type=float, default=None,
                        help="壊れやすさ 0.0〜1.0 — 大きいほど派手に飛び散る (デフォルト: 0.5)")
    parser.add_argument("--friction", type=float, default=None,
                        help="摩擦係数 0.0〜1.0 (デフォルト: 0.5)")
    parser.add_argument("--restitution", type=float, default=None,
                        help="反発係数 0.0〜1.0 — 大きいほどよく跳ねる (デフォルト: 0.3)")
    parser.add_argument("--impact-x", type=float, default=None,
                        help="衝突点 X 座標 -1.0〜1.0（glass のみ有効、デフォルト: 0.0 = 中心）")
    parser.add_argument("--impact-y", type=float, default=None,
                        help="衝突点 Y 座標 -1.0〜1.0（glass のみ有効、デフォルト: 0.0 = 中心）")
    parser.add_argument("--blender", default="blender",
                        help="Blenderバイナリのパス (デフォルト: blender)")
    parser.add_argument("--physics-extension", action="store_true",
                        help="実験的: OMI_physics_shape/OMI_physics_body（glTF標準ドラフト物理拡張）"
                             "も書き出す。要 `pip install pygltflib`（詳細は SCHEMA.md §7）")

    args = parser.parse_args()

    # ---- パラメータ解決: デフォルト < 種別プロファイル < プロンプト解析 < 明示引数 ----
    from prompt_parser import parse as parse_prompt, DEFAULTS, profile_for

    resolved = dict(DEFAULTS)   # pieces/seed/size/weight/... の既定値

    parsed = {}
    if args.prompt:
        use_llm = False if args.no_llm else "auto"
        parsed = parse_prompt(args.prompt, use_llm=use_llm)
        print(f"[pipeline] プロンプト解析: \"{args.prompt}\"")
        print(f"[pipeline]   → {parsed}")

    # 最終種別を先に決定（明示 > プロンプト）
    final_type = args.type or parsed.get("type")

    # 種別プロファイル（その物体にふさわしい既定値）を適用（プロンプト・明示より下位）
    if final_type:
        prof = profile_for(final_type)
        if prof:
            print(f"[pipeline] 種別プロファイル({final_type}): {prof}")
        resolved.update(prof)

    # プロンプト解析結果で上書き（プロファイルより優先）
    resolved.update(parsed)

    # 明示引数（None でないもの）で上書き
    explicit = {
        "type": args.type, "pieces": args.pieces, "seed": args.seed,
        "size": args.size, "weight": args.weight, "fragility": args.fragility,
        "friction": args.friction, "restitution": args.restitution,
        "impact_x": args.impact_x, "impact_y": args.impact_y,
    }
    for k, v in explicit.items():
        if v is not None:
            resolved[k] = v

    # 種別を最終確定（明示 > プロンプト）
    resolved["type"] = final_type

    # 種別は必須（明示 or プロンプトから）
    if not resolved["type"]:
        parser.error("--type を指定するか、--prompt で種別が判別できる指示を与えてください")

    # 値の範囲チェック
    if not 0.0 <= resolved["fragility"] <= 1.0:
        parser.error("fragility は 0.0〜1.0 の範囲で指定してください")
    if not -1.0 <= resolved["impact_x"] <= 1.0:
        parser.error("impact-x は -1.0〜1.0 の範囲で指定してください")
    if not -1.0 <= resolved["impact_y"] <= 1.0:
        parser.error("impact-y は -1.0〜1.0 の範囲で指定してください")
    if not 0.0 <= resolved["friction"] <= 1.0:
        parser.error("friction は 0.0〜1.0 の範囲で指定してください")
    if not 0.0 <= resolved["restitution"] <= 1.0:
        parser.error("restitution は 0.0〜1.0 の範囲で指定してください")
    if resolved["pieces"] < 2:
        parser.error("pieces は 2 以上を指定してください")
    if resolved["weight"] <= 0:
        parser.error("weight は正の値を指定してください")

    # 出力ディレクトリを作成
    out_path = Path(args.out)
    out_path.parent.mkdir(parents=True, exist_ok=True)

    params = {
        "type": resolved["type"],
        "pieces": int(resolved["pieces"]),
        "seed": int(resolved["seed"]),
        "out": str(out_path.resolve()),
        "size": float(resolved["size"]),
        "weight": float(resolved["weight"]),
        "fragility": float(resolved["fragility"]),
        "friction": float(resolved["friction"]),
        "restitution": float(resolved["restitution"]),
        "impact_x": float(resolved["impact_x"]),
        "impact_y": float(resolved["impact_y"]),
    }

    if args.dry_run:
        print("[pipeline] --dry-run: 解決したパラメータ")
        print(json.dumps({k: v for k, v in params.items() if k != "out"},
                         ensure_ascii=False, indent=2))
        return

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

    print(f"[pipeline] 生成開始: type={params['type']}, pieces={params['pieces']}, seed={params['seed']}")
    print(f"[pipeline] 物理パラメータ: weight={params['weight']}kg, fragility={params['fragility']}, friction={params['friction']}, restitution={params['restitution']}")
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

    if args.physics_extension:
        from physics_extension import add_physics_extension
        add_physics_extension(str(out_path))

    size_kb = out_path.stat().st_size / 1024
    print(f"\n[pipeline] 完了: {args.out} ({size_kb:.1f} KB)")
    print(f"[pipeline] ビューアで確認: cd viewer && npm run dev")
    print(f"[pipeline]   → http://localhost:5173/?glb=../{args.out}")


if __name__ == "__main__":
    main()
