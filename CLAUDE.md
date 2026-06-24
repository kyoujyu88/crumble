# Crumble — 破壊可能3Dオブジェクト生成パイプライン

## プロジェクト概要

テキストプロンプト（またはパラメータ）から「破壊可能な3Dオブジェクト」を生成し、
プレフラクチャ済みの **GLB ファイル**として書き出すツール。
**重要**: 破壊はランタイム計算ではなく「プレフラクチャ」方式（事前分割）。

## 技術スタック

| レイヤー | 技術 |
|---|---|
| メッシュ生成・フラクチャ | Blender 4.0 (bpy + Cell Fracture アドオン) |
| Webビューア | three.js 0.184 + @dimforge/rapier3d-compat 0.19 |
| ビルドツール | Vite 8.1 |
| パイプラインCLI | Python 3.11 (subprocess で Blender を headless 呼び出し) |
| 出力フォーマット | GLB (glTF 2.0) |

## セットアップ

```bash
# 初回のみ（Blender + npm パッケージをインストール）
bash setup.sh
```

## よく使うコマンド

### GLB 生成

```bash
# 基本
python pipeline.py --type barrel --pieces 20 --seed 1 --out output/barrel.glb

# 重くて頑丈（壊れにくい）
python pipeline.py --type barrel --pieces 15 --seed 2 \
  --weight 80 --fragility 0.2 --friction 0.6 --restitution 0.1 \
  --out output/heavy_barrel.glb

# 軽くて脆い（派手に吹き飛ぶ）
python pipeline.py --type barrel --pieces 30 --seed 3 \
  --weight 2 --fragility 1.0 --restitution 0.7 \
  --out output/fragile_barrel.glb

# 岩（フェーズ2）
python pipeline.py --type rock --pieces 25 --seed 5 --out output/rock.glb
```

### Webビューア

```bash
cd viewer && npm run dev
# ブラウザで http://localhost:5173/?glb=../output/barrel.glb
# R キーでリセット、ドラッグ＆ドロップで別の GLB を読み込める
```

### テスト実行

```bash
# GLB 構造バリデーション（要: output/barrel.glb）
python tests/test_glb_structure.py output/barrel.glb

# 統合テスト（Blender 必須、時間がかかる）
python tests/test_pipeline.py

# pytest
pytest tests/ -v
```

## パラメータ一覧

| パラメータ | デフォルト | 説明 |
|---|---|---|
| `--type` | 必須 | `barrel` / `rock` / `glass` |
| `--pieces` | 20 | 破片数（2〜999） |
| `--seed` | 1 | 乱数シード（同じ値で同じ割れ方） |
| `--size` | 1.0 | スケール倍率 |
| `--weight` | 10.0 | 総質量 kg（Rapier の mass に影響） |
| `--fragility` | 0.5 | 壊れやすさ 0.0〜1.0（散乱インパルス強度） |
| `--friction` | 0.5 | 摩擦係数 0.0〜1.0 |
| `--restitution` | 0.3 | 反発係数 0.0〜1.0（跳ね返り） |

## ディレクトリ構成

```
crumble/
├── pipeline.py                    # メイン CLI
├── blender_scripts/
│   ├── generate_and_fracture.py   # Blender 実行エントリポイント
│   ├── generators/
│   │   ├── barrel.py              # 樽メッシュ生成（実装済み）
│   │   ├── rock.py                # 岩メッシュ生成（フェーズ2）
│   │   └── glass.py               # ガラス板生成（フェーズ3）
│   ├── fracture/
│   │   ├── voronoi_cell.py        # Voronoi フラクチャ（Cell Fracture アドオン）
│   │   └── glass_crack.py         # 放射状クラック（フェーズ3）
│   └── export_glb.py              # GLB エクスポート + メタデータ
├── viewer/                        # three.js + Rapier Webビューア
│   └── src/
│       ├── main.js                # エントリ（ドラッグ＆ドロップ対応）
│       ├── SceneSetup.js          # レンダラー・カメラ・ライト
│       ├── GLBLoader.js           # GLB 読み込み・シーングラフ解析
│       ├── PhysicsWorld.js        # Rapier 物理ワールド管理
│       ├── DestructionController.js  # クリック → 破壊ロジック
│       └── ui/                    # HUD オーバーレイ
├── output/                        # 生成 GLB（.gitignore 対象）
└── tests/                         # テストスクリプト
```

## GLB スキーマ

### シーングラフ構造

```
Scene
└── destructible_root   ← extras に物理パラメータ
    ├── intact_mesh     ← 無傷の完全メッシュ（通常表示）
    └── shards          ← Empty グループ（破壊前は非表示）
        ├── shard_000
        ├── shard_001
        └── shard_NNN
```

### extras メタデータ（glTF node extras）

```json
{
  "crumble_type": "barrel",
  "crumble_pieces": 20,
  "crumble_weight": 10.0,
  "crumble_fragility": 0.5,
  "crumble_friction": 0.5,
  "crumble_restitution": 0.3,
  "crumble_seed": 1,
  "crumble_version": "1.0"
}
```

## フェーズロードマップ

| フェーズ | 状態 | 内容 |
|---|---|---|
| フェーズ1 | ✅ 実装済み | 樽（Barrel）エンドツーエンド |
| フェーズ2 | ✅ 実装済み | 岩（Rock）— IcoSphere + noise 変位、Voronoi フラクチャ |
| フェーズ3 | 📋 計画中 | ガラス板（Glass）— 放射状クラック |
| フェーズ4 | 📋 計画中 | プロンプト解析層（自然言語 → パラメータ） |

## アーキテクチャノート

### フラクチャ戦略
- **主**: Blender の `object_fracture_cell` アドオン（Cell Fracture）
  - パーティクルシステムで乱数シードを制御
  - `PARTICLE_OWN` ソースで体積内ランダム配置
- **フォールバック**: BSP 平面分割（アドオン不可時）

### Rapier 物理
- `@dimforge/rapier3d-compat` — WASM inline base64 版（Vite プラグイン不要）
- 各シャードの geometry から `ColliderDesc.convexHull()` でコライダー生成
- `convexHull` が null を返す場合（縮退ポリゴン）は `cuboid` フォールバック
- `weight` → Rapier の `setMass()`
- `fragility` → 散乱インパルス係数（`fragility × 15.0 N`）

### GLB extras
- Blender の `object["key"] = value` → `export_extras=True` → glTF `node.extras.key`
- three.js の `GLTFLoader` は `node.extras` を `object.userData` に自動マッピング
- フラットな `crumble_*` プレフィックス規則を使用（ネストなし）

## 既知の制限・TODO

- [ ] フォールバックフラクチャ（BSP 分割）は凹形状に弱い
- [ ] ガラスの放射状クラック（フェーズ3）は未実装
- [ ] convexHull フォールバックで物理挙動が不正確になる場合がある
- [ ] Cell Fracture のシャード数が `--pieces` より少なくなることがある（空洞部分の切り捨て）
- [ ] Rapier の `syncMeshes()` は親 transform が identity であることを前提とする
