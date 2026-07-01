import * as THREE from 'three';
import { GamePhysics } from './GamePhysics.js';
import { Effects } from './Effects.js';
import { Sfx } from './Sfx.js';
import { Economy } from './Economy.js';
import { Game, LEVELS } from './Game.js';
import { GameUI } from './ui/GameUI.js';
import { ARSession } from './ARSession.js';

// ================= 基盤セットアップ =================

const canvas = document.getElementById('canvas');
const uiRoot = document.getElementById('ui');
const fxLayer = document.getElementById('fx-layer');

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.15;

const scene = new THREE.Scene();
const BG_COLOR = new THREE.Color(0x141425);

const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.01, 60);
camera.position.set(0, 1.45, 2.15);
camera.lookAt(0, 0.3, 0);

// ライト
scene.add(new THREE.AmbientLight(0xffffff, 0.55));
const dirLight = new THREE.DirectionalLight(0xfff3e0, 2.2);
dirLight.position.set(2.5, 5, 2);
dirLight.castShadow = true;
dirLight.shadow.mapSize.set(1024, 1024);
dirLight.shadow.camera.near = 0.1;
dirLight.shadow.camera.far = 15;
dirLight.shadow.camera.left = -3;
dirLight.shadow.camera.right = 3;
dirLight.shadow.camera.top = 3;
dirLight.shadow.camera.bottom = -3;
dirLight.shadow.bias = -0.0004;
scene.add(dirLight);
const fillLight = new THREE.DirectionalLight(0x5566cc, 0.5);
fillLight.position.set(-3, 2, -2);
scene.add(fillLight);

// ---- 3D モード用ステージ ----
const stage = new THREE.Group();
{
  const floor = new THREE.Mesh(
    new THREE.CircleGeometry(1.7, 48).rotateX(-Math.PI / 2),
    new THREE.MeshStandardMaterial({ color: 0x2a2a40, roughness: 0.9 })
  );
  floor.receiveShadow = true;
  const rim = new THREE.Mesh(
    new THREE.RingGeometry(1.7, 1.78, 48).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: 0xff6b35, transparent: true, opacity: 0.55 })
  );
  rim.position.y = 0.002;
  stage.add(floor, rim);
}
scene.add(stage);

// ---- AR 用シャドウキャッチャー ----
const shadowCatcher = new THREE.Mesh(
  new THREE.CircleGeometry(1.3, 40).rotateX(-Math.PI / 2),
  new THREE.ShadowMaterial({ opacity: 0.32 })
);
shadowCatcher.receiveShadow = true;
shadowCatcher.visible = false;
scene.add(shadowCatcher);

// ================= サブシステム =================

const physics = new GamePhysics();
await physics.init();

const economy = new Economy();
const sfx = new Sfx();
sfx.setEnabled(economy.sound);
const effects = new Effects(scene, fxLayer);

let game = null;      // 後で生成（ui が先に必要）
let arSession = null;
let paused = false;
let pendingLevel = null; // AR 配置待ちのレベル

// ================= UI コールバック =================

const ui = new GameUI(uiRoot, economy, {
  onUiTap: () => { sfx.unlock(); sfx.uiTap(); },

  onPlay: (level, mode) => {
    sfx.unlock();
    if (mode === 'ar') startAR(level);
    else startFallback(level);
  },

  onRetry: (level) => { sfx.unlock(); startRound(level); },

  onNext: (level) => {
    const idx = LEVELS.findIndex(l => l.id === level.id);
    const next = LEVELS[idx + 1];
    if (next) startRound(next);
  },

  onHome: () => {
    game.quit();
    if (arSession?.active) arSession.end(); // end ハンドラでタイトルに戻る
    else backToTitle();
  },

  onPauseToggle: () => {
    if (!game.inRound) return;
    paused = !paused;
    if (paused) ui.showPause();
    else ui.hidePause();
  },

  onQuitRound: () => {
    paused = false;
    game.quit();
    if (arSession?.active) arSession.end();
    else backToTitle();
  },

  onBuy: async (item, btnEl) => {
    sfx.unlock();
    if (item.kind === 'coins') {
      if (economy.buyWithCoins(item)) {
        sfx.buy();
        ui.toast(`${item.emoji} ${item.name} を解放！`);
        ui.showShop();
      } else {
        sfx.deny();
        ui.toast('🪙 コインが足りない… プレイして貯めよう！');
      }
    } else {
      // IAP デモ決済（Economy.purchaseIAP が本番決済への統合ポイント）
      btnEl.disabled = true;
      btnEl.textContent = '処理中…';
      const res = await economy.purchaseIAP(item);
      if (res.ok) {
        sfx.buy();
        ui.toast(`${item.emoji} ${item.name} 購入完了！${res.demo ? '（デモ決済）' : ''}`);
        ui.showShop();
      }
    }
  },

  onSoundToggle: (v) => {
    economy.setSound(v);
    sfx.setEnabled(v);
    if (v) { sfx.unlock(); sfx.uiTap(); }
  },
});

game = new Game({ scene, physics, effects, sfx, economy, ui });

game.onRoundEnd = (result) => {
  const idx = LEVELS.findIndex(l => l.id === result.level.id);
  const next = LEVELS[idx + 1];
  const hasNext = !!next && economy.isLevelUnlocked(next.id, LEVELS);
  ui.showResults(result, { hasNext });
};

// ================= モード開始 =================

let playOrigin = new THREE.Vector3(0, 0, 0);
let playRadius = 1.0;

function startRound(level) {
  game.startLevel(level, { origin: playOrigin, radius: playRadius });
}

function startFallback(level) {
  stage.visible = true;
  shadowCatcher.visible = false;
  scene.background = BG_COLOR;
  playOrigin.set(0, 0, 0);
  playRadius = 1.05;
  physics.setGroundY(0);
  startRound(level);
}

async function startAR(level) {
  if (!arSession) arSession = new ARSession(renderer, scene);
  pendingLevel = level;
  try {
    await arSession.start({
      uiRoot,
      onPlaced: (pos) => {
        ui.hidePlacementHint();
        playOrigin.copy(pos);
        playRadius = 0.85;
        physics.setGroundY(pos.y);
        shadowCatcher.position.copy(pos).y += 0.005;
        shadowCatcher.visible = true;
        sfx.haptic(25);
        startRound(pendingLevel);
      },
      onSelect: (ray) => { game.trySmash(ray); },
      onEnd: () => backToTitle(),
    });
    // AR 中は仮想背景・ステージを消す
    stage.visible = false;
    scene.background = null;
    ui.showPlacementHint();
  } catch (err) {
    console.warn('[AR] セッション開始失敗:', err);
    ui.toast('⚠️ ARを開始できませんでした。3Dモードで起動します');
    startFallback(level);
  }
}

function backToTitle() {
  paused = false;
  game.quit();
  stage.visible = true;
  shadowCatcher.visible = false;
  scene.background = BG_COLOR;
  ui.showTitle();
}

// ================= 入力（3D モード: タップ/クリックで破壊） =================

const pointer = new THREE.Vector2();
const raycaster = new THREE.Raycaster();

canvas.addEventListener('pointerdown', (e) => {
  if (arSession?.active || paused) return;
  pointer.x = (e.clientX / window.innerWidth) * 2 - 1;
  pointer.y = -(e.clientY / window.innerHeight) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);
  game.trySmash(raycaster.ray);
});

// ================= リサイズ =================

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ================= レンダーループ =================

let lastT = 0;
renderer.setAnimationLoop((t, frame) => {
  const dt = Math.min((t - lastT) / 1000, 0.05) || 0.016;
  lastT = t;

  if (frame && arSession?.active) arSession.update(frame);

  if (!paused) {
    game.update(dt);
    physics.step(dt * 1000);
    physics.update(scene);
  }

  // 3D モードではカメラをゆるく揺らして臨場感を出す
  if (!arSession?.active) {
    camera.position.x = Math.sin(t * 0.0003) * 0.09;
    camera.lookAt(0, 0.3, 0);
  }

  const activeCamera = arSession?.active ? renderer.xr.getCamera() : camera;
  effects.update(paused ? 0 : dt, activeCamera);

  renderer.render(scene, camera);
});

// ================= 起動 =================

scene.background = BG_COLOR;
ui.arSupported = await ARSession.isSupported();
ui.mode = ui.arSupported ? 'ar' : '3d';
ui.showTitle();

// デイリーボーナス
const daily = economy.claimDaily();
if (daily) {
  setTimeout(() => {
    ui.toast(`🎁 デイリーボーナス +${daily.coins}🪙（${daily.streak}日連続）`);
    ui.showTitle(); // コイン表示を更新
  }, 700);
}

console.log('[CrumbleSmash] 起動完了 / AR対応:', ui.arSupported);
