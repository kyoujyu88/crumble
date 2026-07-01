# crumble

破壊可能3Dオブジェクト生成パイプライン ＋ **Crumble Smash**（AR破壊ゲーム）

## Crumble Smash — ARで壊しまくれ！

現実の部屋の床にオブジェクトを召喚して、タップで破壊しまくるアーケードゲーム。
WebXR 対応スマホなら AR モード、それ以外の端末（PC含む）では 3D モードで遊べる。

```bash
cd viewer && npm install
npm run dev -- --host
# PC:     http://localhost:5173/game.html （3Dモード）
# スマホ: https 経由でアクセスすると AR モードが選べる（WebXR は https 必須）
```

### 遊び方

1. モード（AR / 3D）を選んで「あそぶ」
2. AR ではカメラを床に向け、緑のリングをタップしてプレイエリアを配置
3. 出現するオブジェクトをタップで破壊！ 制限時間内にスコアを稼ぐ
4. 連続破壊で **チェイン**（倍率 最大×8）、つなげ続けると **フィーバータイム**
5. まれに出現する **ゴールデン** はスコア5倍＋ボーナスコイン

### ゲームの構造

- **8レベル**の進行制（★1 で次レベル解放、目標スコアで ★1〜★3）
- **コイン経済**: スコアに応じてコイン獲得、デイリーログインボーナス（連続日数で増加）
- **ショップ**: コインで「石の遺跡パック」「クリスタルパック」を解放して出現オブジェクトを追加
- **課金導線（デモ実装）**: プレミアムパス（全パック解放＋ゴールデン率UP＋コイン1.5倍）と
  コインパックを IAP スタブとして実装。`viewer/src/game/Economy.js` の `purchaseIAP()` が
  Stripe / StoreKit / Play Billing への統合ポイント
- 破壊オブジェクトは Blender 不要でランタイム生成（`viewer/src/game/Destructibles.js`）。
  パイプラインと同じ「intact + プレフラクチャ破片」構造で、物理は Rapier

## 生成パイプライン（GLB 書き出し）

テキストプロンプトまたはパラメータから「破壊可能な3Dオブジェクト」を生成し、
プレフラクチャ済みの GLB として書き出すツール。詳細は [CLAUDE.md](CLAUDE.md) を参照。

```bash
bash setup.sh   # Blender + npm セットアップ
python pipeline.py --prompt "重い木製の樽を30破片で派手に割れるように" --out output/barrel.glb
cd viewer && npm run dev   # http://localhost:5173/ がビューア
```
