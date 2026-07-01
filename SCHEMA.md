# Crumble GLB スキーマ仕様

Crumble が出力する GLB を **自作ビューア以外のエンジン/アプリ**（Unity, Unreal,
別の three.js プロジェクトなど）に読み込ませて、同等の破壊挙動を再現するための
リファレンス。`viewer/` の実装（`PhysicsWorld.js` / `GLBLoader.js`）が「正」の実装であり、
本書はその内容を他エンジン向けに移植しやすい形で言語化したもの。

## 1. なぜ読み込むだけでは自然に壊れないか

Crumble の GLB は「あらかじめ割れた形状」と「物理パラメータの数値」しか運ばない。
どのくらいの力で・どの方向に破片を飛ばすか、破片ごとの質量をどう配分するかという
**挙動のロジックは GLB の中にはなく、`viewer/` 側の JavaScript コードにある**。
そのため他アプリで自然な挙動を得るには、以下のスキーマを読み取って
同等のロジックをそのアプリ側に実装する必要がある。

## 2. シーングラフ

```
Scene
└── destructible_root        ← extras に全体パラメータ
    ├── intact_mesh           ← 無傷メッシュ（初期状態: 表示）
    └── shards                ← Empty グループ（初期状態: 非表示）
        ├── shard_000          ← extras に per-shard パラメータ
        ├── shard_001
        └── shard_NNN
```

- 破壊トリガー時に `intact_mesh` を非表示、`shards` を表示に切り替える。
- `destructible_root` / `intact_mesh` / `shards` の **ローカル transform は必ず identity**
  （location=(0,0,0), rotation=identity, scale=(1,1,1)）。これは Rapier ビューアの
  `syncMeshes()` が rigid body のワールド座標をそのまま `mesh.position` に代入する
  実装になっているため。他アプリでも、物理シミュレーション結果をこれらのノードの
  ローカル transform として扱うなら同じ前提を守ること（`export_glb.py` の
  `_assert_identity_transform` がエクスポート時に検証している）。

## 3. `destructible_root` の extras（node.extras）

| キー | 型 | 単位/範囲 | 説明 |
|---|---|---|---|
| `crumble_type` | string | - | 種別（barrel/rock/glass/...） |
| `crumble_pieces` | int | - | シャード数 |
| `crumble_seed` | int | - | 乱数シード |
| `crumble_weight` | float | kg | 総質量 |
| `crumble_fragility` | float | 0.0〜1.0 | 壊れやすさ |
| `crumble_friction` | float | 0.0〜1.0 | 摩擦係数 |
| `crumble_restitution` | float | 0.0〜1.0 | 反発係数 |
| `crumble_scatter_force` | float | N相当 | 計算済み散乱インパルス強度 = `crumble_fragility × 15.0` |
| `crumble_version` | string | - | スキーマバージョン（現在 `"1.0"`） |

`crumble_scatter_force` は `crumble_fragility` から一意に決まる値だが、
他エンジンの実装者が式を推測する必要がないよう計算済みの値として同梱している。
式自体は `viewer/src/PhysicsWorld.js` の `SCATTER_FORCE_PER_FRAGILITY`（=15.0）と
`blender_scripts/export_glb.py` の `SCATTER_FORCE_PER_FRAGILITY` に定義されている。
将来この係数を変える場合は両方を同時に変更すること。

## 4. 各 `shard_NNN` ノードの extras

| キー | 型 | 説明 |
|---|---|---|
| `crumble_shard_index` | int | 0始まりの通し番号 |
| `crumble_centroid_x/y/z` | float | シャードのワールド座標での重心 |
| `crumble_shard_mass` | float (kg) | このシャードの質量。全シャードの `crumble_shard_mass` を合計すると `crumble_weight` に一致する |

`crumble_shard_mass` は `crumble_weight` をシャード数で均等割りするのではなく、
**各シャードのメッシュ体積比**で配分している（`export_glb.py` の `_calc_volume`）。
小さい破片は軽く、大きい破片は重く扱われるため、質量を無視して単に頂点数や
シャード数だけで割ると不自然な挙動になる。

## 5. 破壊時の挙動を再現するリファレンス実装（Rapier / three.js 版）

```
massPerShard   = shard.crumble_shard_mass  # 均等割りではなく体積比
scatterForce   = root.crumble_scatter_force
direction      = normalize(shardWorldPos - impactPoint)   # 衝突点0距離ならランダム方向
distFactor     = max(0.3, 1.0 - distance(shardWorldPos, impactPoint) * 0.5)

impulse.xz     = direction.xz * scatterForce * massPerShard * distFactor
impulse.y      = abs(direction.y) * scatterForce * massPerShard * 0.4
                 + scatterForce * massPerShard * 0.2
torqueImpulse  = random(-1, 1) * scatterForce * 0.3  (各軸)

collider       = convexHull(shard.vertices)  # 失敗時は AABB (cuboid) にフォールバック
collider.friction    = root.crumble_friction
collider.restitution = root.crumble_restitution
rigidBody.linearDamping  = 0.05
rigidBody.angularDamping = 0.1
```

完全な実装は `viewer/src/PhysicsWorld.js` の `createShardBodies` /
`_buildCollider` / `_applyScatterImpulse` を参照。

## 6. コライダー形状についての注意

Crumble のシャードは Blender の Cell Fracture（Voronoi分割）によって生成されており、
各セルは基本的に凸形状になる。そのため `convexHull` ベースのコライダー生成と
相性が良い。フォールバックの BSP 平面分割（Cell Fracture アドオンが使えない場合）も
平面で切るだけなので凸形状を維持する。三角メッシュ（trimesh）コライダーを使う
必要は基本的にない。

## 7. 標準 glTF 物理拡張（実験的サポート）

上記の `crumble_*` extras は独自スキーマであり、対応コードを書かないと
他エンジンでは解釈されない。より広いエンジンでの互換性のため、Crumble は
コミュニティドラフトの glTF 物理拡張である
[`OMI_physics_shape`](https://github.com/omigroup/gltf-extensions/tree/main/extensions/2.0/OMI_physics_shape) /
[`OMI_physics_body`](https://github.com/omigroup/gltf-extensions/tree/main/extensions/2.0/OMI_physics_body)
を使って、各シャードに convex コライダー・質量・摩擦・反発係数を
**標準の拡張フォーマットとしても**書き出すオプションを持つ（`pipeline.py` の
`--physics-extension` フラグ、実装は `physics_extension.py`）。

これらの拡張はまだドラフト段階であり対応エンジンは限定的（2026年7月時点）。
`crumble_*` extras が一次情報源であり、`OMI_physics_*` 拡張はベストエフォートの
互換性レイヤーという位置づけ。仕様が更新された場合は
`physics_extension.py` の実装を上記リポジトリの最新スキーマに追従させること。
