import * as THREE from 'three';

const MAX_PARTICLES = 700;

/**
 * 破壊演出: GPU パーティクルバースト + DOM スコアポップアップ + 画面フラッシュ。
 */
export class Effects {
  /**
   * @param {THREE.Scene} scene
   * @param {HTMLElement} uiRoot ポップアップを載せる DOM ルート
   */
  constructor(scene, uiRoot) {
    this.scene = scene;
    this.uiRoot = uiRoot;
    this._popups = []; // { el, worldPos, bornAt }

    // ---- パーティクルプール ----
    this._pos = new Float32Array(MAX_PARTICLES * 3);
    this._vel = new Float32Array(MAX_PARTICLES * 3);
    this._col = new Float32Array(MAX_PARTICLES * 3);
    this._life = new Float32Array(MAX_PARTICLES);    // 残り秒
    this._maxLife = new Float32Array(MAX_PARTICLES);
    this._size = new Float32Array(MAX_PARTICLES);
    this._alpha = new Float32Array(MAX_PARTICLES);
    this._cursor = 0;

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this._pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(this._col, 3));
    geo.setAttribute('aSize', new THREE.BufferAttribute(this._size, 1));
    geo.setAttribute('aAlpha', new THREE.BufferAttribute(this._alpha, 1));

    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      vertexShader: `
        attribute float aSize;
        attribute float aAlpha;
        varying vec3 vColor;
        varying float vAlpha;
        void main() {
          vColor = color;
          vAlpha = aAlpha;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = aSize * (140.0 / max(-mv.z, 0.1));
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: `
        varying vec3 vColor;
        varying float vAlpha;
        void main() {
          vec2 uv = gl_PointCoord - 0.5;
          float d = length(uv);
          if (d > 0.5) discard;
          float a = smoothstep(0.5, 0.15, d) * vAlpha;
          gl_FragColor = vec4(vColor, a);
        }
      `,
      vertexColors: true,
    });

    this._points = new THREE.Points(geo, mat);
    this._points.frustumCulled = false;
    scene.add(this._points);
  }

  /** 破壊バースト */
  burst(position, colorHex, count = 28, speed = 2.2) {
    const c = new THREE.Color(colorHex);
    for (let n = 0; n < count; n++) {
      const i = this._cursor;
      this._cursor = (this._cursor + 1) % MAX_PARTICLES;
      this._pos[i * 3] = position.x;
      this._pos[i * 3 + 1] = position.y;
      this._pos[i * 3 + 2] = position.z;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      const v = speed * (0.4 + Math.random() * 0.9);
      this._vel[i * 3] = Math.sin(phi) * Math.cos(theta) * v;
      this._vel[i * 3 + 1] = Math.abs(Math.cos(phi)) * v * 0.9 + 0.5;
      this._vel[i * 3 + 2] = Math.sin(phi) * Math.sin(theta) * v;
      const tint = 0.75 + Math.random() * 0.45;
      this._col[i * 3] = Math.min(c.r * tint, 1);
      this._col[i * 3 + 1] = Math.min(c.g * tint, 1);
      this._col[i * 3 + 2] = Math.min(c.b * tint, 1);
      this._maxLife[i] = this._life[i] = 0.5 + Math.random() * 0.5;
      this._size[i] = 0.02 + Math.random() * 0.05;
      this._alpha[i] = 1;
    }
  }

  /** スコアポップアップ（DOM、AR の dom-overlay でも表示される） */
  popup(worldPos, html, className = '') {
    const el = document.createElement('div');
    el.className = `fx-popup ${className}`;
    el.innerHTML = html;
    this.uiRoot.appendChild(el);
    this._popups.push({ el, worldPos: worldPos.clone(), bornAt: performance.now() });
  }

  /** 画面フラッシュ（フィーバー/ゴールデン用） */
  flash(className = 'fx-flash-gold') {
    const el = document.createElement('div');
    el.className = `fx-flash ${className}`;
    this.uiRoot.appendChild(el);
    setTimeout(() => el.remove(), 700);
  }

  /** 毎フレーム更新。camera は現在レンダリングに使われているカメラ。 */
  update(dt, camera) {
    // パーティクル
    const g = -4.8;
    for (let i = 0; i < MAX_PARTICLES; i++) {
      if (this._life[i] <= 0) continue;
      this._life[i] -= dt;
      if (this._life[i] <= 0) { this._alpha[i] = 0; continue; }
      this._vel[i * 3 + 1] += g * dt;
      this._pos[i * 3] += this._vel[i * 3] * dt;
      this._pos[i * 3 + 1] += this._vel[i * 3 + 1] * dt;
      this._pos[i * 3 + 2] += this._vel[i * 3 + 2] * dt;
      this._alpha[i] = Math.min(1, this._life[i] / (this._maxLife[i] * 0.5));
    }
    const geo = this._points.geometry;
    geo.attributes.position.needsUpdate = true;
    geo.attributes.color.needsUpdate = true;
    geo.attributes.aAlpha.needsUpdate = true;
    geo.attributes.aSize.needsUpdate = true;

    // ポップアップ（ワールド座標 → 画面座標へ投影）
    const now = performance.now();
    const v = _v3;
    for (let i = this._popups.length - 1; i >= 0; i--) {
      const p = this._popups[i];
      const age = now - p.bornAt;
      if (age > 900) {
        p.el.remove();
        this._popups.splice(i, 1);
        continue;
      }
      v.copy(p.worldPos);
      v.y += age * 0.0004; // ふわっと上昇
      v.project(camera);
      const x = (v.x * 0.5 + 0.5) * window.innerWidth;
      const y = (-v.y * 0.5 + 0.5) * window.innerHeight;
      const behind = v.z > 1;
      p.el.style.transform = `translate(-50%, -50%) translate(${x}px, ${y}px)`;
      p.el.style.opacity = behind ? '0' : String(Math.min(1, 2.5 - (age / 900) * 2.5));
    }
  }

  clearPopups() {
    for (const p of this._popups) p.el.remove();
    this._popups = [];
  }
}

const _v3 = new THREE.Vector3();
