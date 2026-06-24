import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';

export class PhysicsWorld {
  constructor() {
    this.world = null;
    this.bodies = []; // [{ rigidBody, mesh }]
    this._groundBody = null;
    this._isRunning = false;
  }

  async init() {
    await RAPIER.init();
    this.world = new RAPIER.World({ x: 0.0, y: -9.81, z: 0.0 });
    this._addGround(0);
  }

  setGroundY(y) {
    if (this._groundBody) {
      this._groundBody.setTranslation({ x: 0, y, z: 0 }, true);
    }
  }

  _addGround(y) {
    const desc = RAPIER.RigidBodyDesc.fixed().setTranslation(0, y, 0);
    this._groundBody = this.world.createRigidBody(desc);
    this.world.createCollider(
      RAPIER.ColliderDesc.cuboid(50, 0.05, 50).setFriction(0.8).setRestitution(0.3),
      this._groundBody
    );
  }

  /**
   * シャードごとに Rapier RigidBody を生成して物理シミュレーションを開始する。
   * @param {THREE.Object3D} shardsGroup - シャードを含む three.js グループ
   * @param {THREE.Vector3} impactPoint  - 衝突点（ワールド座標）
   * @param {object} metadata            - GLB から読んだ crumble メタデータ
   */
  createShardBodies(shardsGroup, impactPoint, metadata) {
    const massTotal = metadata.weight ?? 10.0;
    const fragility = metadata.fragility ?? 0.5;
    const friction = metadata.friction ?? 0.5;
    const restitution = metadata.restitution ?? 0.3;

    // シャードメッシュを収集
    const shards = [];
    shardsGroup.traverse(obj => { if (obj.isMesh) shards.push(obj); });

    const massPerShard = massTotal / Math.max(shards.length, 1);
    // fragility が高いほど大きな散乱力（0.0→0N, 1.0→15N相当）
    const scatterForce = fragility * 15.0;

    shards.forEach(shard => {
      const worldPos = new THREE.Vector3();
      const worldQuat = new THREE.Quaternion();
      shard.getWorldPosition(worldPos);
      shard.getWorldQuaternion(worldQuat);

      // RigidBody 作成
      const rbDesc = RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(worldPos.x, worldPos.y, worldPos.z)
        .setRotation({ x: worldQuat.x, y: worldQuat.y, z: worldQuat.z, w: worldQuat.w })
        .setLinearDamping(0.05)
        .setAngularDamping(0.1);

      const rigidBody = this.world.createRigidBody(rbDesc);

      // ローカル頂点から ConvexHull コライダーを生成
      const colliderDesc = this._buildCollider(shard, massPerShard, friction, restitution);
      this.world.createCollider(colliderDesc, rigidBody);

      // 衝突点から外向きのインパルスを適用
      this._applyScatterImpulse(rigidBody, worldPos, impactPoint, scatterForce, massPerShard);

      this.bodies.push({ rigidBody, mesh: shard });
    });

    this._isRunning = true;
  }

  _buildCollider(shard, mass, friction, restitution) {
    const geo = shard.geometry;
    const posAttr = geo.attributes.position;

    // ローカル座標の頂点（Rapier の convexHull は body ローカル空間で受け取る）
    const verts = new Float32Array(posAttr.count * 3);
    for (let i = 0; i < posAttr.count; i++) {
      verts[i * 3]     = posAttr.getX(i);
      verts[i * 3 + 1] = posAttr.getY(i);
      verts[i * 3 + 2] = posAttr.getZ(i);
    }

    let desc = RAPIER.ColliderDesc.convexHull(verts);

    if (!desc) {
      // Convex Hull 計算失敗（縮退ポリゴン等）→ AABB にフォールバック
      const box = new THREE.Box3().setFromBufferAttribute(posAttr);
      const size = box.getSize(new THREE.Vector3());
      desc = RAPIER.ColliderDesc.cuboid(
        Math.max(size.x / 2, 0.001),
        Math.max(size.y / 2, 0.001),
        Math.max(size.z / 2, 0.001)
      );
    }

    return desc.setMass(mass).setFriction(friction).setRestitution(restitution);
  }

  _applyScatterImpulse(rigidBody, shardPos, impactPos, force, mass) {
    const dir = shardPos.clone().sub(impactPos);
    const dist = dir.length();

    if (dist > 0.001) {
      dir.divideScalar(dist);
    } else {
      // 衝突点と同位置の場合はランダム方向
      dir.set(
        (Math.random() - 0.5) * 2,
        0.5 + Math.random() * 0.5,
        (Math.random() - 0.5) * 2
      ).normalize();
    }

    // 距離減衰（近いほど強く飛ぶ）
    const distFactor = Math.max(0.3, 1.0 - dist * 0.5);

    rigidBody.applyImpulse(
      {
        x: dir.x * force * mass * distFactor,
        y: Math.abs(dir.y) * force * mass * 0.4 + force * mass * 0.2,
        z: dir.z * force * mass * distFactor,
      },
      true
    );

    // ランダムな回転インパルス（破片がくるくる回る）
    rigidBody.applyTorqueImpulse(
      {
        x: (Math.random() - 0.5) * force * 0.3,
        y: (Math.random() - 0.5) * force * 0.3,
        z: (Math.random() - 0.5) * force * 0.3,
      },
      true
    );
  }

  step(deltaMs) {
    if (!this._isRunning || !this.world) return;
    // タイムステップを固定（物理の安定性のため最大 1/30s）
    this.world.timestep = Math.min(deltaMs / 1000, 1 / 30);
    this.world.step();
  }

  /**
   * Rapier の rigid body 位置を three.js mesh に反映する。
   * 前提: shards グループの親はすべて identity transform（origin での生成）。
   */
  syncMeshes() {
    for (const { rigidBody, mesh } of this.bodies) {
      if (rigidBody.isSleeping()) continue;
      const t = rigidBody.translation();
      const r = rigidBody.rotation();
      mesh.position.set(t.x, t.y, t.z);
      mesh.quaternion.set(r.x, r.y, r.z, r.w);
    }
  }

  reset() {
    for (const { rigidBody } of this.bodies) {
      this.world.removeRigidBody(rigidBody);
    }
    this.bodies = [];
    this._isRunning = false;
  }
}
