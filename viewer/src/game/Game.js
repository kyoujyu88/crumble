import * as THREE from 'three';
import { TYPES, createDestructible } from './Destructibles.js';

/** レベル定義: 後半ほど速く・多く・高い目標。targets = [★1, ★2, ★3] */
export const LEVELS = [
  { id: 1, name: 'はじめての解体', duration: 45, spawnEvery: [1.6, 1.2], maxConcurrent: 3, targets: [1000, 2200, 3600] },
  { id: 2, name: '路地裏の倉庫', duration: 45, spawnEvery: [1.4, 1.0], maxConcurrent: 3, targets: [1600, 3200, 5000] },
  { id: 3, name: '朝市の搬入口', duration: 50, spawnEvery: [1.3, 0.9], maxConcurrent: 4, targets: [2400, 4600, 7000] },
  { id: 4, name: '陶器職人の工房', duration: 50, spawnEvery: [1.2, 0.85], maxConcurrent: 4, targets: [3200, 6000, 9000] },
  { id: 5, name: '崩れかけの遺跡', duration: 55, spawnEvery: [1.1, 0.8], maxConcurrent: 5, targets: [4200, 7800, 11500] },
  { id: 6, name: '真夜中の温室', duration: 55, spawnEvery: [1.0, 0.7], maxConcurrent: 5, targets: [5500, 9800, 14500] },
  { id: 7, name: '氷の貯蔵庫', duration: 60, spawnEvery: [0.9, 0.65], maxConcurrent: 6, targets: [7000, 12500, 18000] },
  { id: 8, name: '解体師の最終試験', duration: 60, spawnEvery: [0.85, 0.55], maxConcurrent: 7, targets: [9000, 16000, 24000] },
];

const COMBO_WINDOW = 2.5;     // 秒: この間に次を壊せばコンボ継続
const OBJECT_LIFETIME = 7.0;  // 秒: 壊されなかったオブジェクトは逃げる
const FEVER_DURATION = 6.0;
const FIRST_FEVER_CHAIN = 12;

/**
 * ゲーム進行の状態機械。
 * phase: idle → countdown → playing → ending → idle
 */
export class Game {
  constructor({ scene, physics, effects, sfx, economy, ui }) {
    this.scene = scene;
    this.physics = physics;
    this.effects = effects;
    this.sfx = sfx;
    this.economy = economy;
    this.ui = ui;

    this.phase = 'idle';
    this.level = null;
    this.origin = new THREE.Vector3();
    this.radius = 0.9;

    this.onRoundEnd = null; // (result) => void

    this._raycaster = new THREE.Raycaster();
    this._active = [];      // 未破壊の handle
    this._reset();
  }

  _reset() {
    this.score = 0;
    this.timeLeft = 0;
    this.chain = 0;
    this.chainTimer = 0;
    this.mult = 1;
    this.fever = false;
    this.feverTimer = 0;
    this.feverThreshold = FIRST_FEVER_CHAIN;
    this.goldenCount = 0;
    this.brokenCount = 0;
    this._spawnTimer = 0.6;
    this._elapsed = 0;
    this._lastTickSecond = -1;
    this._countdownLeft = 0;
  }

  get running() { return this.phase === 'playing'; }
  get inRound() { return this.phase !== 'idle'; }

  /** ラウンド開始（origin = プレイエリア中心の床位置） */
  startLevel(level, { origin, radius = 0.9 } = {}) {
    this.quit(); // 念のため掃除
    this.level = level;
    if (origin) this.origin.copy(origin);
    this.radius = radius;
    this._reset();
    this.timeLeft = level.duration;
    this.phase = 'countdown';
    this._countdownLeft = 3.4;
    this.ui.showHUD();
  }

  /** 毎フレーム更新（dt 秒） */
  update(dt) {
    if (this.phase === 'countdown') {
      const prev = Math.ceil(this._countdownLeft);
      this._countdownLeft -= dt;
      const cur = Math.ceil(this._countdownLeft);
      if (this._countdownLeft <= 0) {
        this.phase = 'playing';
        this.ui.showCountdown('GO!');
        this.sfx.countdown(true);
        this.sfx.haptic(30);
      } else if (cur !== prev && cur >= 1 && cur <= 3) {
        this.ui.showCountdown(String(cur));
        this.sfx.countdown(false);
      }
      return;
    }

    if (this.phase === 'ending') {
      this._countdownLeft -= dt;
      this._updateSpawnAnimations(dt);
      if (this._countdownLeft <= 0) this._finishRound();
      return;
    }

    if (this.phase !== 'playing') return;

    this._elapsed += dt;
    this.timeLeft -= dt;

    // 残り5秒警告
    const sec = Math.ceil(this.timeLeft);
    if (sec !== this._lastTickSecond && sec <= 5 && sec >= 1) {
      this._lastTickSecond = sec;
      this.sfx.timeWarning();
    }

    if (this.timeLeft <= 0) {
      this.timeLeft = 0;
      this.phase = 'ending';
      this._countdownLeft = 1.3; // 破片が飛び散るのを見せてからリザルトへ
      this.ui.showCountdown('TIME UP!');
      this.ui.updateHUD(this._hudState());
      return;
    }

    // コンボタイマー
    if (this.chain > 0) {
      this.chainTimer -= dt;
      if (this.chainTimer <= 0) {
        this.chain = 0;
        this.mult = 1;
      }
    }

    // フィーバー
    if (this.fever) {
      this.feverTimer -= dt;
      if (this.feverTimer <= 0) this.fever = false;
    }

    // スポーン
    this._spawnTimer -= dt;
    if (this._spawnTimer <= 0 && this._active.length < this.level.maxConcurrent) {
      this._spawn();
      const t = Math.min(this._elapsed / this.level.duration, 1);
      let interval = this.level.spawnEvery[0] + (this.level.spawnEvery[1] - this.level.spawnEvery[0]) * t;
      if (this.fever) interval *= 0.55;
      this._spawnTimer = interval * (0.8 + Math.random() * 0.4);
    }

    this._updateSpawnAnimations(dt);
    this._updateLifetimes(dt);
    this.ui.updateHUD(this._hudState());
  }

  _hudState() {
    return {
      time: Math.ceil(this.timeLeft),
      score: this.score,
      chain: this.chain,
      mult: this.mult,
      fever: this.fever,
      feverRatio: this.fever ? this.feverTimer / FEVER_DURATION : 0,
      comboRatio: this.chain > 0 ? this.chainTimer / COMBO_WINDOW : 0,
    };
  }

  // ---------- スポーン ----------

  _spawn() {
    const pool = this.economy.availableTypes(TYPES);
    const typeName = pool[Math.floor(Math.random() * pool.length)];
    const golden = Math.random() < this.economy.goldenRate;
    const handle = createDestructible(typeName, {
      golden,
      scale: 0.9 + Math.random() * 0.3,
    });

    // 既存オブジェクトと重ならない位置を探す
    const p = new THREE.Vector3();
    for (let tries = 0; tries < 10; tries++) {
      const a = Math.random() * Math.PI * 2;
      const r = 0.15 + Math.random() * (this.radius - 0.15);
      p.set(this.origin.x + Math.cos(a) * r, this.origin.y, this.origin.z + Math.sin(a) * r);
      const ok = this._active.every(h =>
        p.distanceTo(h.root.position) > (h.radius + handle.radius + 0.06));
      if (ok) break;
    }
    handle.root.position.copy(p);

    // ポップイン
    handle.spawnAge = 0;
    handle.age = 0;
    handle.targetScale = handle.root.scale.x;
    handle.root.scale.setScalar(0.01);

    this.scene.add(handle.root);
    this._active.push(handle);
  }

  _updateSpawnAnimations(dt) {
    for (const h of this._active) {
      if (h.spawnAge === null) continue;
      h.spawnAge += dt;
      const t = Math.min(h.spawnAge / 0.32, 1);
      // バウンス付きイージング
      const s = t < 1 ? (1.15 - 0.15 * Math.cos(t * Math.PI)) * t * (2 - t) : 1;
      h.root.scale.setScalar(h.targetScale * Math.max(s, 0.01));
      if (t >= 1) {
        h.root.scale.setScalar(h.targetScale);
        h.spawnAge = null;
      }
    }
  }

  _updateLifetimes(dt) {
    for (let i = this._active.length - 1; i >= 0; i--) {
      const h = this._active[i];
      h.age += dt;
      const life = this.fever ? OBJECT_LIFETIME * 1.5 : OBJECT_LIFETIME;
      if (h.age > life) {
        // 逃走: 縮んで消える
        if (!h.despawning) {
          h.despawning = 0;
          this.effects.popup(
            h.root.position.clone().setY(h.root.position.y + h.height),
            'にげられた…', 'fx-popup-miss'
          );
        }
        h.despawning += dt;
        const k = Math.max(1 - h.despawning / 0.3, 0.01);
        h.root.scale.setScalar(h.targetScale * k);
        if (h.despawning >= 0.3) {
          this._removeUnbroken(h);
          this._active.splice(i, 1);
        }
      }
    }
  }

  _removeUnbroken(handle) {
    this.scene.remove(handle.root);
    handle.root.traverse(o => { if (o.isMesh) o.geometry.dispose(); });
    for (const m of handle.materials) m.dispose();
  }

  // ---------- 破壊 ----------

  /**
   * レイで破壊を試みる。ヒットしたら true。
   * @param {THREE.Ray} ray ワールド空間のレイ
   */
  trySmash(ray) {
    if (this.phase !== 'playing') return false;
    this._raycaster.ray.copy(ray);
    this._raycaster.near = 0;
    this._raycaster.far = 30;

    const targets = this._active.filter(h => !h.despawning).map(h => h.intactGroup);
    if (targets.length === 0) return false;
    const hits = this._raycaster.intersectObjects(targets, true);
    if (hits.length === 0) return false;

    const hit = hits[0];
    const handle = hit.object.userData.destructible;
    if (!handle || handle.broken) return false;
    this._break(handle, hit.point);
    return true;
  }

  _break(handle, point) {
    handle.broken = true;
    const idx = this._active.indexOf(handle);
    if (idx >= 0) this._active.splice(idx, 1);

    // intact を消して破片をワールドへ解き放つ
    handle.intactGroup.visible = false;
    handle.shardsGroup.visible = true;
    const worldShards = [];
    for (const s of [...handle.shards]) {
      this.scene.attach(s); // ワールド変換を保ったまま scene 直下へ
      worldShards.push(s);
    }
    this.physics.addShards(worldShards, point, handle.meta, handle.materials);
    this.scene.remove(handle.root);
    handle.root.traverse(o => { if (o.isMesh) o.geometry.dispose(); });

    // ---- スコアリング ----
    this.brokenCount++;
    this.chain++;
    this.chainTimer = COMBO_WINDOW;
    const prevMult = this.mult;
    this.mult = Math.min(8, 1 + Math.floor(this.chain / 3));

    let gain = handle.def.score;
    if (handle.golden) gain *= 5;
    if (this.fever) gain *= 2;
    gain *= this.mult;
    this.score += gain;

    // ---- 演出 ----
    const popPos = point.clone();
    const cls = handle.golden ? 'fx-popup-golden' : (this.fever ? 'fx-popup-fever' : '');
    const multLabel = this.mult > 1 ? `<span class="fx-mult">×${this.mult}</span>` : '';
    this.effects.popup(popPos, `+${gain}${multLabel}`, cls);
    this.effects.burst(
      point,
      handle.golden ? 0xffd75e : handle.def.particleColor,
      handle.golden ? 46 : 30,
      handle.golden ? 3.0 : 2.2
    );
    this.sfx.crash(handle.def.sound);
    if (handle.golden) {
      this.goldenCount++;
      this.sfx.golden();
      this.effects.flash('fx-flash-gold');
      this.sfx.haptic([40, 30, 60]);
    } else {
      this.sfx.haptic(20);
    }
    if (this.mult > prevMult) this.sfx.combo(this.mult);

    // フィーバー突入
    if (!this.fever && this.chain >= this.feverThreshold) {
      this.fever = true;
      this.feverTimer = FEVER_DURATION;
      this.feverThreshold = this.chain + 15;
      this.sfx.feverStart();
      this.effects.flash('fx-flash-fever');
      this.ui.showFeverBanner();
      this.sfx.haptic([30, 40, 30, 40, 80]);
    }
  }

  // ---------- 終了 ----------

  _finishRound() {
    const level = this.level;
    const stars = level.targets.filter(t => this.score >= t).length;
    const coins = this.economy.roundReward(this.score, this.goldenCount);
    this.economy.addCoins(coins);
    const { newBest } = this.economy.recordResult(level.id, this.score, stars);

    const result = {
      level,
      score: this.score,
      stars,
      coins,
      broken: this.brokenCount,
      golden: this.goldenCount,
      newBest,
      best: this.economy.levelResult(level.id).best,
    };

    this._cleanupField();
    this.phase = 'idle';
    if (stars > 0) this.sfx.fanfare();
    if (this.onRoundEnd) this.onRoundEnd(result);
  }

  /** ラウンドを中断して片付ける */
  quit() {
    if (!this.inRound && this._active.length === 0) return;
    this._cleanupField();
    this.phase = 'idle';
  }

  _cleanupField() {
    for (const h of this._active) this._removeUnbroken(h);
    this._active = [];
    this.physics.clear(this.scene);
    this.effects.clearPopups();
  }
}
