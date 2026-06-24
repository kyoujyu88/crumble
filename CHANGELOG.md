# Changelog

プロジェクトの変更履歴。[Keep a Changelog](https://keepachangelog.com/ja/1.0.0/) 形式。

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

### [0.4.0] — フェーズ4: プロンプト解析
- `prompt_parser.py` 追加
- 自然言語 → `{type, pieces, weight, fragility, ...}` 変換
- `--prompt "重い木製の樽を 30 破片で"` オプション
