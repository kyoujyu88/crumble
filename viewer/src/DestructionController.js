import * as THREE from 'three';

export class DestructionController {
  /**
   * @param {THREE.Scene} scene
   * @param {THREE.Camera} camera
   * @param {THREE.WebGLRenderer} renderer
   * @param {import('./PhysicsWorld.js').PhysicsWorld} physicsWorld
   * @param {object} metadata
   * @param {THREE.Object3D} intactMesh
   * @param {THREE.Object3D} shardsGroup
   */
  constructor(scene, camera, renderer, physicsWorld, metadata, intactMesh, shardsGroup) {
    this.scene = scene;
    this.camera = camera;
    this.renderer = renderer;
    this.physics = physicsWorld;
    this.metadata = metadata;
    this.intactMesh = intactMesh;
    this.shardsGroup = shardsGroup;
    this.isBroken = false;

    this._raycaster = new THREE.Raycaster();
    this._pointer = new THREE.Vector2();

    renderer.domElement.addEventListener('click', this._onClick.bind(this));
    renderer.domElement.style.cursor = 'crosshair';
  }

  _onClick(event) {
    if (this.isBroken || !this.intactMesh) return;

    // ポインタ座標を正規化デバイス座標に変換
    const rect = this.renderer.domElement.getBoundingClientRect();
    this._pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this._pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

    this._raycaster.setFromCamera(this._pointer, this.camera);

    // intact_mesh 配下の全メッシュに対してレイキャスト
    const targets = [];
    this.intactMesh.traverse(obj => { if (obj.isMesh) targets.push(obj); });
    const intersects = this._raycaster.intersectObjects(targets, true);

    if (intersects.length > 0) {
      this._triggerDestruction(intersects[0].point);
    }
  }

  /** オブジェクト上端中央を衝突点として強制的に破壊する（パネルからの再破壊用）。 */
  forceBreakFromTop() {
    if (this.isBroken || !this.intactMesh) return;
    const box = new THREE.Box3().setFromObject(this.intactMesh);
    const center = box.getCenter(new THREE.Vector3());
    const impact = new THREE.Vector3(center.x, box.max.y, center.z);
    this._triggerDestruction(impact);
  }

  _triggerDestruction(impactPoint) {
    if (this.isBroken) return;
    this.isBroken = true;

    // 無傷メッシュを隠してシャードを表示
    if (this.intactMesh) this.intactMesh.visible = false;

    if (this.shardsGroup) {
      this.shardsGroup.visible = true;
      this.physics.createShardBodies(this.shardsGroup, impactPoint, this.metadata);
    }

    this.renderer.domElement.style.cursor = 'default';
  }

  syncMeshesToPhysics() {
    if (this.isBroken) {
      this.physics.syncMeshes();
    }
  }

  /** オブジェクトをリセット（再ロード時に使用） */
  reset(intactMesh, shardsGroup) {
    this.isBroken = false;
    this.intactMesh = intactMesh;
    this.shardsGroup = shardsGroup;
    this.physics.reset();

    if (intactMesh) intactMesh.visible = true;
    if (shardsGroup) shardsGroup.visible = false;

    this.renderer.domElement.style.cursor = 'crosshair';
  }
}
