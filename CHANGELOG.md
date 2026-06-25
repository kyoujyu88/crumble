# Changelog

プロジェクトの変更履歴。[Keep a Changelog](https://keepachangelog.com/ja/1.0.0/) 形式。

---

## [0.6.0] — 2026-06-26

### 追加（Added）
- **種別を 3 → 12 に拡張**。各種別に「その物体にふさわしい既定パラメータ」を付与
  - 新種別: `crate`（木箱）, `vase`（花瓶・壺）, `pillar`（石柱）, `pumpkin`（カボチャ）,
    `ice`（氷塊）, `pot`（植木鉢）, `tombstone`（墓石）, `concrete`（コンクリブロック）, `egg`（卵）
  - 各 `generators/<type>.py` をプロシージャル生成で実装
    （箱系=cube+bevel、回転体=`_common.lathe`、球ベース変形=pumpkin/egg）
  - `generators/_common.py` を追加（マテリアル生成・モディファイア適用・回転体ヘルパー）
- **種別プロファイル（`prompt_parser.TYPE_PROFILES`）**
  - weight/fragility/friction/restitution/pieces を種別ごとに最適化
    （例: 石柱=95kg・頑丈、卵=1kg・即割れ、氷=つるつる、コンクリ=80kg）
  - 優先順位を **デフォルト < 種別プロファイル < プロンプト解析 < 明示引数** の 4 段に拡張
- **プロンプト解析の種別語彙を拡充**＋**最長一致優先**ロジック
  - 「石柱」→pillar が「石」→rock に勝つ、「石碑」→tombstone なども正しく判定
- **GUI**: 種別ドロップダウンに 12 種を反映。種別を選ぶとその物体の既定パラメータを
  各スライダーへ自動セット
- **ビューア**: オーバーレイ（`Overlay.js`）に新種別の日本語ラベルを追加

### 変更（Changed）
- `generate_and_fracture.py` のメッシュ生成ディスパッチを `GENERATORS` レジストリ化
  （新種別の追加が 1 行で済む）
- シャード名 `shard_000..` の付与を生成スクリプト側に一元化
  （フラクチャ経路によらず統一。glass のシャード名も `shard_NNN` に正規化）

### 修正（Fixed）
- `ice` ジェネレータの `Vector + tuple` エラーを修正（オフセットを `Vector` 化）

---

## [0.5.0] — 2026-06-25

### 追加（Added）
- **フェーズ4: プロンプト解析層（`prompt_parser.py`）**
  - 自然言語の指示を `pipeline.py` のパラメータ辞書に変換
  - **A. ルールベース層**: キーワード辞書（種別・形容詞・素材）＋正規表現で
    `type / pieces / seed / size / weight / fragility / friction / restitution` を抽出
    - 例: 「重い木製の樽を30破片で派手に割れるように」→ `{type:barrel, pieces:30, weight:50, fragility:0.9}`
  - **B. LLM フォールバック層（任意）**: 種別が判定できない／曖昧な時に Claude の tool use で構造化出力
    - `ANTHROPIC_API_KEY` と `anthropic` パッケージがある時のみ自動有効化、無ければルールベースのみで動作
- **`pipeline.py --prompt`**: プロンプトからの生成に対応
  - 優先順位は **デフォルト < プロンプト解析 < 明示引数**
  - `--no-llm`（ルールベース固定）、`--dry-run`（解決パラメータ表示のみ）を追加
  - `--type` はプロンプトで種別が判別できる場合に省略可
- **GUI のプロンプト欄**: 上部に自然言語入力欄と「解析→反映」ボタンを追加
  - 解析結果を各フォーム／スライダーに自動セット（別スレッドで実行、LLM 利用時も UI が固まらない）
- **テスト**: `tests/test_prompt_parser.py`（ルールベース 16 ケース、Blender 不要）

---

## [0.4.0] — 2026-06-24

### 追加（Added）
- **デスクトップ GUI（`gui.py`）**
  - tkinter 製。種別・破片数・シード・サイズ・物理パラメータをフォーム／スライダーで設定し「生成」ボタンで GLB を出力
  - glass 選択時のみ衝突点（impact-x / impact-y）を有効化
  - Blender パスと最後の設定を `~/.crumble_gui.json` に自動保存
  - `pipeline.py` を別スレッドで subprocess 実行し、ログをリアルタイム表示（標準ライブラリのみ・追加依存なし）
- **ビューア内パラメータ調整パネル（`viewer/src/ui/ControlPanel.js`）**
  - 質量・壊れやすさ・摩擦・反発をスライダーでリアルタイム調整 → 破壊挙動に即反映
  - 「この設定で壊し直す」ボタンで同じモデルを新パラメータのまま再ロード＆再破壊
  - オーバーレイ表示もスライダー操作に連動
  - `R` キーのリセット対象を「現在のソース」に変更（ドロップしたファイルも正しく復元）

### 変更（Changed）
- `setup.sh` に Linux 用 `python3-tk` の自動インストールを追加（GUI 用、失敗しても続行）

### 修正（Fixed）
- BSP フォールバックフラクチャ（Cell Fracture アドオン非搭載の Blender 4.2+ / 5.x）で
  `source_obj` をシャードに含めて返していたことによる `ReferenceError: StructRNA of type Object has been removed` を修正（PR #4）

---

## [0.3.0] — 2026-06-24

### 追加（Added）
- **フェーズ3: ガラス板（Glass）エンドツーエンドパイプライン**
  - `blender_scripts/generators/glass.py` — 縦置きガラスパネル（Blender XZ平面、Z-up）生成。透過マテリアル（Alpha=0.3）付き
  - `blender_scripts/fracture/glass_crack.py` — クモの巣状（スパイダーウェブ）フラクチャ：衝突点から放射状スポーク + 同心リングカット
  - `pipeline.py` — `--impact-x`・`--impact-y` パラメータ追加（-1.0〜1.0 正規化座標）

### 使い方
```bash
# 中心衝突（デフォルト）
python pipeline.py --type glass --pieces 20 --seed 3 --out output/glass.glb

# 右下1/3あたりに衝突
python pipeline.py --type glass --pieces 20 --seed 3 --impact-x 0.3 --impact-y -0.2 --out output/glass_offset.glb
```

### 技術メモ
- BSP bisect (`bpy.ops.mesh.bisect`) を XZ 平面（法線 Y=0）で適用して縦パネルを正確に分割
- `apply_glass_fracture` 開始時に `source_obj` を複製することで、`generate_and_fracture.py` が元オブジェクトを削除しても ReferenceError が起きないよう修正

---

## [0.2.0] — 2026-06-24

### 追加（Added）
- **フェーズ2: 岩（Rock）エンドツーエンドパイプライン**
  - `blender_scripts/generators/rock.py` — IcoSphere（3段サブディビジョン）+ mathutils.noise による凹凸変形
  - `python pipeline.py --type rock --pieces 15 --seed 5 --out output/rock.glb` で動作確認済み
  - Webビューアで岩のクリック破壊・Rapier 物理落下を確認

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

全フェーズ（1〜4）実装済み。今後の拡張候補:
- プロンプト解析辞書の語彙拡充・英語対応強化
- ガラスの透過マテリアルをビューア側でも反映
- フォールバックフラクチャ（BSP）の凹形状対応改善
