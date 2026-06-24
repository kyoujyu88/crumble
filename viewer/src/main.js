import * as THREE from 'three';
import { SceneSetup } from './SceneSetup.js';
import { GLBLoader } from './GLBLoader.js';
import { PhysicsWorld } from './PhysicsWorld.js';
import { DestructionController } from './DestructionController.js';
import { Overlay } from './ui/Overlay.js';
import { ControlPanel } from './ui/ControlPanel.js';

// ---------- 初期化 ----------
const sceneSetup = new SceneSetup(document.getElementById('canvas'));
const physics = new PhysicsWorld();
await physics.init();

const loader = new GLBLoader();

let destruction = null;
let overlay = null;
let controlPanel = null;
let currentModel = null;
let currentSource = null;

// URLパラメータからGLBパスを取得（デフォルト: output/barrel.glb）
const defaultGlb = new URLSearchParams(location.search).get('glb') ?? '/output/barrel.glb';

// ---------- GLB 読み込み ----------
// keepParams: パネルで調整した物理値を引き継ぐ / autoBreak: 読み込み後に自動破壊
async function loadGLB(source, { keepParams = false, autoBreak = false } = {}) {
  // パネルの現在値を退避（再ロードで引き継ぐ場合）
  const carriedParams = keepParams && controlPanel ? controlPanel.getValues() : null;

  // 既存モデルを削除
  if (currentModel) {
    sceneSetup.scene.remove(currentModel);
    physics.reset();
  }

  let loaded;
  try {
    loaded = await loader.load(source);
  } catch (err) {
    showError(`GLB 読み込みエラー: ${err.message}<br><br>
      <small>?glb=path/to/file.glb でパスを指定するか、GLB をドロップしてください</small>`);
    return;
  }

  currentSource = source;
  const { scene: model, metadata, intactMesh, shardsGroup } = loaded;

  // 退避した物理値を上書き反映
  if (carriedParams) Object.assign(metadata, carriedParams);

  currentModel = model;
  sceneSetup.scene.add(model);

  // 地面の高さをオブジェクト底面に合わせる
  if (intactMesh) {
    const box = new THREE.Box3().setFromObject(model);
    const groundY = box.min.y - 0.02;
    sceneSetup.setGroundY(groundY);
    physics.setGroundY(groundY);
  }

  if (destruction) {
    destruction.reset(intactMesh, shardsGroup);
    destruction.metadata = metadata;
  } else {
    destruction = new DestructionController(
      sceneSetup.scene,
      sceneSetup.camera,
      sceneSetup.renderer,
      physics,
      metadata,
      intactMesh,
      shardsGroup
    );
  }

  if (overlay) {
    overlay.updateMetadata(metadata);
  } else {
    overlay = new Overlay(document.getElementById('overlay'), metadata);
  }

  // パラメータ調整パネル
  if (!controlPanel) {
    controlPanel = new ControlPanel(document.getElementById('controls'), {
      onUpdate: () => overlay && overlay.refresh(),
      onRebreak: async () => {
        if (currentSource) await loadGLB(currentSource, { keepParams: true, autoBreak: true });
      },
    });
  }
  controlPanel.bind(metadata);

  if (autoBreak && destruction) destruction.forceBreakFromTop();

  console.log('[main] GLB 読み込み完了:', metadata);
}

// ---------- レンダーループ ----------
sceneSetup.startRenderLoop((deltaMs) => {
  physics.step(deltaMs);
  if (destruction) destruction.syncMeshesToPhysics();
  if (overlay && destruction) overlay.update(destruction.isBroken);
});

// ---------- R キーでリセット ----------
window.addEventListener('keydown', async (e) => {
  if (e.key === 'r' || e.key === 'R') {
    if (currentSource) {
      await loadGLB(currentSource);
    }
  }
});

// ---------- ドラッグ＆ドロップ ----------
const dropzone = document.getElementById('dropzone');

document.addEventListener('dragover', (e) => {
  e.preventDefault();
  dropzone.classList.add('drag-over');
});
document.addEventListener('dragleave', () => {
  dropzone.classList.remove('drag-over');
});
document.addEventListener('drop', async (e) => {
  e.preventDefault();
  dropzone.classList.remove('drag-over');
  const file = e.dataTransfer?.files?.[0];
  if (file?.name.endsWith('.glb') || file?.name.endsWith('.gltf')) {
    await loadGLB(file);
  } else {
    showError('GLB または GLTF ファイルをドロップしてください');
  }
});

// ---------- エラー表示 ----------
function showError(html) {
  const div = document.createElement('div');
  div.className = 'error-banner';
  div.innerHTML = html;
  document.getElementById('app').appendChild(div);
  setTimeout(() => div.remove(), 6000);
}

// ---------- 初回ロード ----------
await loadGLB(defaultGlb);
