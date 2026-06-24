# Changelog

プロジェクトの変更履歴。[Keep a Changelog](https://keepachangelog.com/ja/1.0.0/) 形式。

---

## [0.1.0] — 2026-06-23

### 追加（Added）
- **フェーズ1: 樽（Barrel）エンドツーエンドパイプライン**
  - `pipeline.py` — メイン CLI。`--type barrel --pieces 20 --seed 1 --out barrel.glb` 形式
  - `blender_scripts/generate_and_fracture.py` — Blender headless 実行エントリポイント
  - `blender_scripts/generators/barrel.py` — 樽メッシュのプロシージャル生成（シリンダー + 膨らみ + 金属フープ）
  - `blender_scripts/fracture/voronoi_cell.py` — Voronoi セルフラクチャ（Cell Fracture アドオン + BSP フォールバック）
  - `blender_scripts/export_glb.py` — メタデータ付き GLB エクスポート

- **Webビューア**
  - `viewer/` — Vite + three.js 0.184 + @dimforge/rapier3d-compat 0.19
  - クリックで無傷メッシュを破片群に差し替え → Rapier 物理で落下・バウンド
  - OrbitControls（マウスドラッグで視点操作）
  - `R` キーでリセット
  - ドラッグ＆ドロップで任意の GLB ファイルを読み込める
  - HUD オーバーレイ（種別・破片数・質量・壊れやすさを表示）

- **物理パラメータ（GLB extras 経由で Rapier に伝達）**
  - `--weight` — 総質量 kg（Rapier の RigidBody mass に反映）
  - `--fragility` — 壊れやすさ（散乱インパルス強度に反映）
  - `--friction` — 摩擦係数
  - `--restitution` — 反発係数

- **フェーズ2〜3 スタブ**
  - `generators/rock.py` — 岩メッシュ生成（IcoSphere + ノイズ変形）
  - `generators/glass.py` — ガラス板生成スタブ
  - `fracture/glass_crack.py` — 放射状クラックスタブ（Voronoi で代替）

- **ドキュメント・設定**
  - `CLAUDE.md` — プロジェクトドキュメント（コマンド・アーキテクチャ・GLB スキーマ）
  - `setup.sh` — 環境セットアップスクリプト（Blender + pip + npm）
  - `requirements.txt` — Python 依存関係
  - `.gitignore` — 生成 GLB・node_modules を除外
  - `tests/test_pipeline.py` — パイプライン統合テスト
  - `tests/test_glb_structure.py` — GLB 構造バリデーション

### GLB スキーマ（初版）
```
Scene
└── destructible_root   (extras: crumble_type, crumble_weight, etc.)
    ├── intact_mesh
    └── shards
        ├── shard_000
        └── ...
```

---

## 今後の予定

### [0.2.0] — フェーズ2: 岩（Rock）
- `generators/rock.py` の完全実装
- `--type rock` の end-to-end テスト追加
- 岩特有のマテリアル（表面粗さ・色変化）

### [0.3.0] — フェーズ3: ガラス板（Glass）
- `fracture/glass_crack.py` の放射状クラック実装
- `--impact-x`・`--impact-y` パラメータ追加（衝突点指定）
- ガラスの透過マテリアル（three.js 側も対応）

### [0.4.0] — フェーズ4: プロンプト解析
- `prompt_parser.py` 追加
- 自然言語 → `{type, pieces, weight, fragility, ...}` 変換
- `--prompt "重い木製の樽を 30 破片で"` オプション
