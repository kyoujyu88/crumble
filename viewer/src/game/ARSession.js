import * as THREE from 'three';

/**
 * WebXR immersive-ar セッション管理。
 * - hit-test で床を検出し、緑のレティクルを表示
 * - タップでプレイエリアを配置（onPlaced）
 * - 配置後のタップは破壊レイとして通知（onSelect(ray)）
 * - UI は dom-overlay でそのまま表示（UI 上のタップは select にしない）
 */
export class ARSession {
  constructor(renderer, scene) {
    this.renderer = renderer;
    this.scene = scene;
    this.session = null;
    this.placing = false;

    this._hitTestSource = null;
    this._reticle = this._buildReticle();
    this._reticle.visible = false;
    scene.add(this._reticle);

    this._onPlaced = null;
    this._onSelect = null;
    this._onEnd = null;
  }

  static async isSupported() {
    if (!('xr' in navigator)) return false;
    try {
      return await navigator.xr.isSessionSupported('immersive-ar');
    } catch {
      return false;
    }
  }

  get active() { return this.session !== null; }

  _buildReticle() {
    const group = new THREE.Group();
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.13, 0.16, 40).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0x3dff88, transparent: true, opacity: 0.9 })
    );
    const dot = new THREE.Mesh(
      new THREE.CircleGeometry(0.02, 16).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0x3dff88 })
    );
    group.add(ring, dot);
    group.matrixAutoUpdate = false;
    return group;
  }

  /**
   * AR セッションを開始する。
   * @param {object} opts { uiRoot, onPlaced(position), onSelect(ray), onEnd() }
   */
  async start({ uiRoot, onPlaced, onSelect, onEnd }) {
    this._onPlaced = onPlaced;
    this._onSelect = onSelect;
    this._onEnd = onEnd;

    const session = await navigator.xr.requestSession('immersive-ar', {
      requiredFeatures: ['hit-test'],
      optionalFeatures: ['dom-overlay', 'local-floor'],
      domOverlay: { root: uiRoot },
    });
    this.session = session;
    this.placing = true;

    // UI 要素（ボタン等）へのタップを XR select にしない
    this._beforeSelect = (e) => { if (e.target !== uiRoot) e.preventDefault(); };
    uiRoot.addEventListener('beforexrselect', this._beforeSelect);
    this._uiRoot = uiRoot;

    this.renderer.xr.enabled = true;
    this.renderer.xr.setReferenceSpaceType('local');
    await this.renderer.xr.setSession(session);

    // viewer 空間からの hit-test（画面中央 = カメラの向いている先の床）
    const viewerSpace = await session.requestReferenceSpace('viewer');
    this._hitTestSource = await session.requestHitTestSource({ space: viewerSpace });

    session.addEventListener('select', (e) => this._handleSelect(e));
    session.addEventListener('end', () => this._handleEnd());
  }

  _handleSelect(event) {
    if (!this.session) return;
    if (this.placing) {
      if (this._reticle.visible) {
        const pos = new THREE.Vector3().setFromMatrixPosition(this._reticle.matrix);
        this.placing = false;
        this._reticle.visible = false;
        this._onPlaced?.(pos);
      }
      return;
    }
    // 破壊タップ: targetRaySpace（画面タップ位置に対応）からレイを構築
    const frame = event.frame;
    const refSpace = this.renderer.xr.getReferenceSpace();
    const pose = frame.getPose(event.inputSource.targetRaySpace, refSpace);
    if (!pose) return;
    const m = new THREE.Matrix4().fromArray(pose.transform.matrix);
    const origin = new THREE.Vector3().setFromMatrixPosition(m);
    const dir = new THREE.Vector3(0, 0, -1).transformDirection(m).normalize();
    this._onSelect?.(new THREE.Ray(origin, dir));
  }

  /** レンダーループから毎フレーム呼ぶ（XRFrame がある時のみ） */
  update(frame) {
    if (!this.session || !this.placing || !this._hitTestSource) return;
    const refSpace = this.renderer.xr.getReferenceSpace();
    const hits = frame.getHitTestResults(this._hitTestSource);
    if (hits.length > 0) {
      const pose = hits[0].getPose(refSpace);
      this._reticle.visible = true;
      this._reticle.matrix.fromArray(pose.transform.matrix);
    } else {
      this._reticle.visible = false;
    }
  }

  end() {
    if (this.session) this.session.end().catch(() => {});
  }

  _handleEnd() {
    this._hitTestSource?.cancel?.();
    this._hitTestSource = null;
    this.session = null;
    this.placing = false;
    this._reticle.visible = false;
    this.renderer.xr.enabled = false;
    if (this._uiRoot && this._beforeSelect) {
      this._uiRoot.removeEventListener('beforexrselect', this._beforeSelect);
    }
    this._onEnd?.();
  }
}
