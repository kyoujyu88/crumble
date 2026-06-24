import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

export class SceneSetup {
  constructor(canvas) {
    // ----- レンダラー -----
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.2;

    // ----- シーン -----
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x1a1a2e);
    this.scene.fog = new THREE.FogExp2(0x1a1a2e, 0.04);

    // ----- カメラ -----
    this.camera = new THREE.PerspectiveCamera(
      60,
      window.innerWidth / window.innerHeight,
      0.01,
      100
    );
    this.camera.position.set(0, 1.5, 4);
    this.camera.lookAt(0, 0.5, 0);

    // ----- OrbitControls -----
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.target.set(0, 0.5, 0);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.05;
    this.controls.minDistance = 0.5;
    this.controls.maxDistance = 20;

    // ----- ライティング -----
    const ambient = new THREE.AmbientLight(0xffffff, 0.45);
    this.scene.add(ambient);

    const dirLight = new THREE.DirectionalLight(0xfffde7, 2.0);
    dirLight.position.set(5, 9, 4);
    dirLight.castShadow = true;
    dirLight.shadow.mapSize.width = 2048;
    dirLight.shadow.mapSize.height = 2048;
    dirLight.shadow.camera.near = 0.1;
    dirLight.shadow.camera.far = 30;
    dirLight.shadow.camera.left = -6;
    dirLight.shadow.camera.right = 6;
    dirLight.shadow.camera.top = 6;
    dirLight.shadow.camera.bottom = -6;
    dirLight.shadow.bias = -0.0005;
    this.scene.add(dirLight);

    const fillLight = new THREE.DirectionalLight(0x4455aa, 0.5);
    fillLight.position.set(-4, 3, -3);
    this.scene.add(fillLight);

    // ----- 地面 -----
    this._groundMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(40, 40),
      new THREE.MeshStandardMaterial({
        color: 0x252535,
        roughness: 0.95,
        metalness: 0.0,
      })
    );
    this._groundMesh.rotation.x = -Math.PI / 2;
    this._groundMesh.position.y = 0;
    this._groundMesh.receiveShadow = true;
    this.scene.add(this._groundMesh);

    // ----- リサイズ対応 -----
    window.addEventListener('resize', () => {
      this.camera.aspect = window.innerWidth / window.innerHeight;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(window.innerWidth, window.innerHeight);
    });
  }

  setGroundY(y) {
    this._groundMesh.position.y = y;
  }

  startRenderLoop(onFrame) {
    const clock = new THREE.Clock();
    const animate = () => {
      requestAnimationFrame(animate);
      const delta = clock.getDelta();
      this.controls.update();
      onFrame(delta * 1000);
      this.renderer.render(this.scene, this.camera);
    };
    animate();
  }
}
