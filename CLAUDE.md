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

# 自然言語プロンプトから生成（フェーズ4）
python pipeline.py --prompt "重い木製の樽を30破片で派手に割れるように" --out output/barrel.glb

# プロンプト解析だけ確認（Blender を起動しない）
python pipeline.py --prompt "軽くて脆いガラスを20破片で" --out x.glb --dry-run
```

### プロンプト解析（フェーズ4）

```bash
# 単体で解析結果を確認（デバッグ）
python prompt_parser.py "重い木製の樽を30破片で派手に割れるように"
#   → {"type":"barrel","pieces":30,"weight":50,"fragility":0.9, ...}
```

- ルールベース（キーワード辞書＋正規表現）で `type/pieces/seed/size/weight/fragility/friction/restitution` を抽出
- 種別が判定できない／曖昧な場合は LLM フォールバック（`ANTHROPIC_API_KEY` と `anthropic` パッケージがある時のみ自動有効化）
- 優先順位は **デフォルト < プロンプト解析 < 明示引数**（`--pieces` 等を併用すればそちらが勝つ）
- `--no-llm` でルールベースのみに固定、`--dry-run` で解決結果を表示して終了

### デスクトップ GUI

```bash
# フォーム UI でパラメータを設定して GLB を生成（tkinter、追加依存なし）
python gui.py
```

- 上部のプロンプト欄に自然言語を入力 →「解析→反映」で各フォームに自動セット（フェーズ4）
- 種別・破片数・シード・サイズ・物理パラメータをスライダー／フォームで設定
- glass 選択時のみ衝突点（impact-x / impact-y）が有効化される
- Blender パスと最後の設定は `~/.crumble_gui.json` に自動保存
- 生成は `pipeline.py` を subprocess 実行し、ログをリアルタイム表示

### Webビューア

```bash
cd viewer && npm run dev
# ブラウザで http://localhost:5173/?glb=../output/barrel.glb
# R キーでリセット、ドラッグ＆ドロップで別の GLB を読み込める
# 右上のパラメータ調整パネルで質量・壊れやすさ・摩擦・反発をリアルタイム調整
#   →「この設定で壊し直す」で同じモデルを新パラメータで再破壊
```

### テスト実行

```bash
# GLB 構造バリデーション（要: output/barrel.glb）
python tests/test_glb_structure.py output/barrel.glb

# プロンプト解析（ルールベース、Blender 不要・高速）
python tests/test_prompt_parser.py

# 統合テスト（Blender 必須、時間がかかる）
python tests/test_pipeline.py

# pytest
pytest tests/ -v
```

## パラメータ一覧

| パラメータ | デフォルト | 説明 |
|---|---|---|
| `--prompt` | なし | 自然言語の指示からパラメータを推定（明示引数が優先） |
| `--type` | 必須※ | 12 種別（下記）から選択（※`--prompt` で種別が判別できれば省略可） |
| `--pieces` | 種別依存 | 破片数（2〜999） |
| `--seed` | 1 | 乱数シード（同じ値で同じ割れ方） |
| `--size` | 1.0 | スケール倍率 |
| `--weight` | 種別依存 | 総質量 kg（Rapier の mass に影響） |
| `--fragility` | 種別依存 | 壊れやすさ 0.0〜1.0（散乱インパルス強度） |
| `--friction` | 種別依存 | 摩擦係数 0.0〜1.0 |
| `--restitution` | 種別依存 | 反発係数 0.0〜1.0（跳ね返り） |
| `--no-llm` | off | プロンプト解析で LLM を使わずルールベースのみ |
| `--dry-run` | off | 解決したパラメータを表示して終了（Blender 起動なし） |

### 種別一覧（12種）と既定プロファイル

物理パラメータ（weight/fragility/friction/restitution/pieces）は **種別ごとに「ふさわしい既定値」**（`prompt_parser.TYPE_PROFILES`）を持つ。
明示引数やプロンプトで指定しなければ、その物体らしい値が自動適用される。

| 種別 | 内容 | weight | fragility | friction | restitution | pieces |
|---|---|---|---|---|---|---|
| `barrel` | 樽（木） | 18 | 0.55 | 0.60 | 0.15 | 20 |
| `rock` | 岩（石） | 60 | 0.30 | 0.85 | 0.05 | 22 |
| `glass` | ガラス板 | 5 | 1.00 | 0.30 | 0.10 | 24 |
| `crate` | 木箱 | 12 | 0.60 | 0.70 | 0.20 | 18 |
| `vase` | 花瓶・壺（陶器） | 4 | 0.95 | 0.40 | 0.10 | 28 |
| `pillar` | 石柱 | 95 | 0.22 | 0.85 | 0.04 | 16 |
| `pumpkin` | カボチャ | 6 | 0.70 | 0.55 | 0.20 | 14 |
| `ice` | 氷塊 | 18 | 0.85 | 0.04 | 0.30 | 24 |
| `pot` | 植木鉢（素焼き） | 7 | 0.80 | 0.55 | 0.12 | 20 |
| `tombstone` | 墓石 | 70 | 0.30 | 0.80 | 0.05 | 14 |
| `concrete` | コンクリブロック | 80 | 0.35 | 0.85 | 0.05 | 22 |
| `egg` | 卵 | 1 | 1.00 | 0.45 | 0.08 | 12 |

優先順位は **デフォルト < 種別プロファイル < プロンプト解析 < 明示引数**。
新しい種別の追加は ①`generators/<type>.py` を作成 ②`generate_and_fracture.GENERATORS` に1行追加
③`prompt_parser` の `TYPE_KEYWORDS` / `TYPE_PROFILES` に追加、の3点だけで済む。

## ディレクトリ構成

```
crumble/
├── pipeline.py                    # メイン CLI（--prompt 対応）
├── prompt_parser.py               # 自然言語 → パラメータ解析（フェーズ4）
├── gui.py                         # デスクトップ GUI（tkinter、プロンプト欄付き）
├── blender_scripts/
│   ├── generate_and_fracture.py   # Blender 実行エントリポイント
│   ├── generators/               # 種別ごとのメッシュ生成（GENERATORS レジストリで動的ディスパッチ）
│   │   ├── _common.py            # 共通ヘルパー（マテリアル / モディファイア / 回転体 lathe）
│   │   ├── barrel.py             # 樽    rock.py 岩    glass.py ガラス板
│   │   ├── crate.py              # 木箱  concrete.py コンクリ  tombstone.py 墓石  ice.py 氷塊
│   │   ├── vase.py               # 花瓶・壺  pot.py 植木鉢  pillar.py 石柱（lathe 回転体）
│   │   └── pumpkin.py            # カボチャ  egg.py 卵（球ベース変形）
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
│       └── ui/                    # HUD オーバーレイ + パラメータ調整パネル
│           ├── Overlay.js         # 種別・破片数などの情報表示
│           └── ControlPanel.js    # 物理パラメータのリアルタイム調整
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
  "crumble_weight": 18.0,
  "crumble_fragility": 0.55,
  "crumble_friction": 0.6,
  "crumble_restitution": 0.15,
  "crumble_seed": 1,
  "crumble_version": "1.0"
}
```

## フェーズロードマップ

| フェーズ | 状態 | 内容 |
|---|---|---|
| フェーズ1 | ✅ 実装済み | 樽（Barrel）エンドツーエンド |
| フェーズ2 | ✅ 実装済み | 岩（Rock）— IcoSphere + noise 変位、Voronoi フラクチャ |
| フェーズ3 | ✅ 実装済み | ガラス板（Glass）— 放射状クラック（スポーク＋同心リング）|
| フェーズ4 | ✅ 実装済み | プロンプト解析層（自然言語 → パラメータ）— ルールベース＋LLMフォールバック |

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

## アーキテクチャノート（フェーズ4：プロンプト解析）

- `prompt_parser.parse(text)` は「判定できたキーだけ」を含む部分辞書を返す
- ルールベース層: `TYPE_KEYWORDS` / `*_WORDS` 辞書 + 正規表現。形容詞は「既定値から最も離れた値」を採用
- 素材ヒント（木/鉄/氷…）→ 形容詞 → 明示数値 の順に上書き（後勝ち）
- LLM 層は Claude の tool use（`set_crumble_params`）で構造化出力。スキーマで範囲を強制
- 種別キーワードは **最長一致優先**（例: 「石柱」は「石」(rock) より長い `pillar` が勝つ）
- `pipeline.py` は **デフォルト < 種別プロファイル < プロンプト解析 < 明示引数** の4段でマージ

## 既知の制限・TODO

- [ ] フォールバックフラクチャ（BSP 分割）は凹形状に弱い
- [ ] convexHull フォールバックで物理挙動が不正確になる場合がある
- [ ] Cell Fracture のシャード数が `--pieces` より少なくなることがある（空洞部分の切り捨て）
- [ ] Rapier の `syncMeshes()` は親 transform が identity であることを前提とする
