import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';

const SHARD_LIFE_MS = 2600;   // 破片が消えるまでの寿命
const FADE_START_MS = 1700;   // フェード開始
const MAX_BODIES = 320;       // 同時破片数の上限（モバイル性能保護）

/**
 * ゲーム用 Rapier 物理ワールド。
 * 複数オブジェクトの破片を同時に扱い、寿命でフェードアウト→自動削除する。
 */
export class GamePhysics {
  constructor() {
    this.world = null;
    this._ground = null;
    this._batches = []; // { bodies: [{rigidBody, mesh}], bornAt, materials }
  }

  async init() {
    await RAPIER.init();
    this.world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    const desc = RAPIER.RigidBodyDesc.fixed().setTranslation(0, 0, 0);
    this._ground = this.world.createRigidBody(desc);
    this.world.createCollider(
      RAPIER.ColliderDesc.cuboid(50, 0.05, 50).setFriction(0.8).setRestitution(0.2),
      this._ground
    );
  }

  setGroundY(y) {
    this._ground.setTranslation({ x: 0, y: y - 0.05, z: 0 }, true);
  }

  /**
   * 破片メッシュ群（ワールド空間に配置済み）を剛体化して散乱させる。
   * @param {THREE.Mesh[]} shards ワールド空間の破片メッシュ
   * @param {THREE.Vector3} impactPoint 衝突点（ワールド）
   * @param {object} meta { weight, fragility, friction, restitution }
   * @param {THREE.Material[]} materials フェード対象マテリアル
   */
  addShards(shards, impactPoint, meta, materials) {
    const massPerShard = (meta.weight ?? 10) / Math.max(shards.length, 1);
    const scatter = (meta.fragility ?? 0.5) * 15.0;
    const bodies = [];

    const wp = new THREE.Vector3();
    const wq = new THREE.Quaternion();

    for (const shard of shards) {
      shard.getWorldPosition(wp);
      shard.getWorldQuaternion(wq);

      const rbDesc = RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(wp.x, wp.y, wp.z)
        .setRotation({ x: wq.x, y: wq.y, z: wq.z, w: wq.w })
        .setLinearDamping(0.05)
        .setAngularDamping(0.1);
      const rigidBody = this.world.createRigidBody(rbDesc);
      this.world.createCollider(
        this._buildCollider(shard, massPerShard, meta.friction ?? 0.5, meta.restitution ?? 0.2),
        rigidBody
      );
      this._applyScatterImpulse(rigidBody, wp, impactPoint, scatter, massPerShard);
      bodies.push({ rigidBody, mesh: shard });
    }

    this._batches.push({ bodies, bornAt: performance.now(), materials });
    this._enforceCap();
  }

  _buildCollider(shard, mass, friction, restitution) {
    const posAttr = shard.geometry.attributes.position;
    const scale = shard.getWorldScale(new THREE.Vector3());
    const verts = new Float32Array(posAttr.count * 3);
    for (let i = 0; i < posAttr.count; i++) {
      verts[i * 3] = posAttr.getX(i) * scale.x;
      verts[i * 3 + 1] = posAttr.getY(i) * scale.y;
      verts[i * 3 + 2] = posAttr.getZ(i) * scale.z;
    }
    let desc = RAPIER.ColliderDesc.convexHull(verts);
    if (!desc) {
      const box = new THREE.Box3().setFromBufferAttribute(posAttr);
      const size = box.getSize(new THREE.Vector3());
      desc = RAPIER.ColliderDesc.cuboid(
        Math.max(size.x * scale.x / 2, 0.001),
        Math.max(size.y * scale.y / 2, 0.001),
        Math.max(size.z * scale.z / 2, 0.001)
      );
    }
    return desc.setMass(mass).setFriction(friction).setRestitution(restitution);
  }

  _applyScatterImpulse(rigidBody, shardPos, impactPos, force, mass) {
    const dir = shardPos.clone().sub(impactPos);
    const dist = dir.length();
    if (dist > 0.001) dir.divideScalar(dist);
    else dir.set(rand2(), 0.5 + Math.random() * 0.5, rand2()).normalize();

    const distFactor = Math.max(0.3, 1.0 - dist * 1.2);
    rigidBody.applyImpulse({
      x: dir.x * force * mass * distFactor,
      y: Math.abs(dir.y) * force * mass * 0.4 + force * mass * 0.25,
      z: dir.z * force * mass * distFactor,
    }, true);
    rigidBody.applyTorqueImpulse({
      x: rand2() * force * 0.05 * mass,
      y: rand2() * force * 0.05 * mass,
      z: rand2() * force * 0.05 * mass,
    }, true);
  }

  step(deltaMs) {
    if (!this.world || this._batches.length === 0) return;
    this.world.timestep = Math.min(deltaMs / 1000, 1 / 30);
    this.world.step();
    // メッシュ同期（ワールド空間: 破片は scene 直下に attach 済み）
    for (const batch of this._batches) {
      for (const { rigidBody, mesh } of batch.bodies) {
        if (rigidBody.isSleeping()) continue;
        const t = rigidBody.translation();
        const r = rigidBody.rotation();
        mesh.position.set(t.x, t.y, t.z);
        mesh.quaternion.set(r.x, r.y, r.z, r.w);
      }
    }
  }

  /** 寿命管理: フェード → 削除。毎フレーム呼ぶ。 */
  update(scene) {
    const now = performance.now();
    for (let i = this._batches.length - 1; i >= 0; i--) {
      const batch = this._batches[i];
      const age = now - batch.bornAt;
      if (age > SHARD_LIFE_MS) {
        this._removeBatch(batch, scene);
        this._batches.splice(i, 1);
      } else if (age > FADE_START_MS) {
        const k = 1 - (age - FADE_START_MS) / (SHARD_LIFE_MS - FADE_START_MS);
        for (const m of batch.materials) {
          m.transparent = true;
          m.opacity = Math.min(m.opacity, Math.max(k, 0.01));
        }
      }
    }
  }

  _removeBatch(batch, scene) {
    for (const { rigidBody, mesh } of batch.bodies) {
      this.world.removeRigidBody(rigidBody);
      scene.remove(mesh);
      mesh.geometry.dispose();
    }
    for (const m of batch.materials) m.dispose();
  }

  _enforceCap() {
    let total = this._batches.reduce((n, b) => n + b.bodies.length, 0);
    while (total > MAX_BODIES && this._batches.length > 1) {
      // 最古のバッチを即時フェード扱いにする（次の update で消える）
      this._batches[0].bornAt = -Infinity;
      total -= this._batches[0].bodies.length;
      break;
    }
  }

  clear(scene) {
    for (const batch of this._batches) this._removeBatch(batch, scene);
    this._batches = [];
  }
}

function rand2() { return (Math.random() - 0.5) * 2; }
