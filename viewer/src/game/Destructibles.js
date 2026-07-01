import * as THREE from 'three';

/**
 * ランタイム・プレフラクチャ破壊オブジェクト生成。
 *
 * Blender パイプラインと同じ「intact（無傷メッシュ）+ shards（事前分割破片）」
 * 構造を JS だけで組み立てる。GLB 不要でその場で遊べるようにするためのモジュール。
 * 破片はすべて凸形状（box / cylinder / icosahedron）なので Rapier の convexHull が必ず通る。
 */

const rand = (min, max) => min + Math.random() * (max - min);

// ---------- マテリアル ----------

function mat(color, { rough = 0.8, metal = 0.0, flat = true, opacity = 1.0, emissive = 0x000000 } = {}) {
  return new THREE.MeshStandardMaterial({
    color,
    roughness: rough,
    metalness: metal,
    flatShading: flat,
    transparent: opacity < 1.0,
    opacity,
    emissive,
  });
}

function goldenMat() {
  return new THREE.MeshStandardMaterial({
    color: 0xffd75e,
    roughness: 0.25,
    metalness: 0.9,
    flatShading: true,
    emissive: 0x553300,
  });
}

// ---------- ジオメトリヘルパー ----------

function box(w, h, d, material, x = 0, y = 0, z = 0, ry = 0, rz = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
  m.position.set(x, y, z);
  m.rotation.set(0, ry, rz);
  m.castShadow = true;
  return m;
}

/** 箱を nx×ny×nz のジッター入りチャンクに分割した破片を返す */
function chunkedBoxShards(w, h, d, n, material, y0 = 0) {
  const shards = [];
  const cw = w / n, ch = h / n, cd = d / n;
  for (let ix = 0; ix < n; ix++) {
    for (let iy = 0; iy < n; iy++) {
      for (let iz = 0; iz < n; iz++) {
        const s = box(
          cw * rand(0.8, 1.05), ch * rand(0.8, 1.05), cd * rand(0.8, 1.05),
          material,
          (ix + 0.5) * cw - w / 2,
          y0 + (iy + 0.5) * ch,
          (iz + 0.5) * cd - d / 2
        );
        shards.push(s);
      }
    }
  }
  return shards;
}

// ---------- 種別ビルダー ----------
// 各ビルダーは { intact: Object3D[], shards: Mesh[], height, radius } を返す。
// ローカル座標系: 底面が y=0。

function buildCrate(materials) {
  const s = 0.34;
  const wood = materials.body;
  const dark = materials.accent;
  const intact = [box(s, s, s, wood, 0, s / 2, 0)];
  // 縁のフレーム（見た目のアクセント）
  const t = 0.035;
  const e = s / 2;
  const edges = [
    // 底・上の4辺
    ...[-e, e].flatMap(y => [
      box(s + t, t, t, dark, 0, e + y, -e), box(s + t, t, t, dark, 0, e + y, e),
      box(t, t, s + t, dark, -e, e + y, 0), box(t, t, s + t, dark, e, e + y, 0),
    ]),
    // 縦4本
    box(t, s, t, dark, -e, e, -e), box(t, s, t, dark, e, e, -e),
    box(t, s, t, dark, -e, e, e), box(t, s, t, dark, e, e, e),
  ];
  intact.push(...edges);
  const shards = chunkedBoxShards(s, s, s, 3, wood, 0);
  return { intact, shards, height: s, radius: s * 0.75 };
}

function buildBarrel(materials) {
  const r = 0.15, h = 0.42, bulge = 1.22;
  const wood = materials.body;
  const iron = materials.accent;
  // intact: 膨らんだ回転体
  const pts = [];
  for (let i = 0; i <= 8; i++) {
    const t = i / 8;
    const rr = r * (1 + (bulge - 1) * Math.sin(Math.PI * t));
    pts.push(new THREE.Vector2(rr, h * t));
  }
  const body = new THREE.Mesh(new THREE.LatheGeometry(pts, 14), wood);
  body.castShadow = true;
  const hoop1 = new THREE.Mesh(new THREE.TorusGeometry(r * 1.13, 0.012, 6, 16), iron);
  hoop1.rotation.x = Math.PI / 2;
  hoop1.position.y = h * 0.25;
  const hoop2 = hoop1.clone();
  hoop2.position.y = h * 0.75;
  const lid = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.95, r * 0.95, 0.02, 12), wood);
  lid.position.y = h - 0.01;
  const intact = [body, hoop1, hoop2, lid];
  // shards: 板（stave）× 上下2段 + 蓋・底
  const shards = [];
  const nStave = 10;
  for (let row = 0; row < 2; row++) {
    for (let i = 0; i < nStave; i++) {
      const a = (i / nStave) * Math.PI * 2;
      const rr = r * (row === 0 ? 1.08 : 1.08);
      const s = box(
        (2 * Math.PI * rr) / nStave * 1.02, h / 2 * rand(0.9, 1.0), 0.035,
        wood,
        Math.cos(a) * rr, h * (0.25 + row * 0.5), Math.sin(a) * rr,
        -a + Math.PI / 2
      );
      shards.push(s);
    }
  }
  for (const y of [0.02, h - 0.02]) {
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.85, r * 0.85, 0.03, 10), wood);
    cap.position.y = y;
    cap.castShadow = true;
    shards.push(cap);
  }
  return { intact, shards, height: h, radius: r * bulge };
}

function buildVase(materials) {
  const ceramic = materials.body;
  const h = 0.4;
  // 壺プロファイル
  const profile = [
    [0.09, 0.0], [0.13, 0.05], [0.16, 0.14], [0.15, 0.24],
    [0.10, 0.32], [0.075, 0.36], [0.09, 0.4],
  ].map(([x, y]) => new THREE.Vector2(x, y));
  const body = new THREE.Mesh(new THREE.LatheGeometry(profile, 16), ceramic);
  body.castShadow = true;
  const intact = [body];
  // shards: プロファイルに沿ったリング × セグメント
  const shards = [];
  const rings = [[0.11, 0.04], [0.155, 0.14], [0.13, 0.26], [0.085, 0.36]];
  for (const [rr, y] of rings) {
    const nSeg = 6;
    for (let i = 0; i < nSeg; i++) {
      const a = (i / nSeg) * Math.PI * 2 + rand(-0.2, 0.2);
      const s = box(
        (2 * Math.PI * rr) / nSeg * rand(0.85, 1.0), h / 4 * rand(0.8, 1.0), 0.03,
        ceramic,
        Math.cos(a) * rr, y + h / 8, Math.sin(a) * rr,
        -a + Math.PI / 2
      );
      shards.push(s);
    }
  }
  return { intact, shards, height: h, radius: 0.17 };
}

function buildRock(materials) {
  const stone = materials.body;
  const r = 0.2;
  const geo = new THREE.IcosahedronGeometry(r, 1);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const k = rand(0.82, 1.18);
    pos.setXYZ(i, pos.getX(i) * k, pos.getY(i) * k * 0.85, pos.getZ(i) * k);
  }
  geo.computeVertexNormals();
  const body = new THREE.Mesh(geo, stone);
  body.position.y = r * 0.8;
  body.castShadow = true;
  const intact = [body];
  const shards = [];
  for (let i = 0; i < 12; i++) {
    const g = new THREE.IcosahedronGeometry(rand(0.045, 0.085), 0);
    const s = new THREE.Mesh(g, stone);
    const a = rand(0, Math.PI * 2);
    const rr = rand(0, r * 0.6);
    s.position.set(Math.cos(a) * rr, r * 0.8 + rand(-r * 0.5, r * 0.5), Math.sin(a) * rr);
    s.rotation.set(rand(0, 3), rand(0, 3), rand(0, 3));
    s.castShadow = true;
    shards.push(s);
  }
  return { intact, shards, height: r * 1.6, radius: r * 1.2 };
}

function buildPillar(materials) {
  const stone = materials.body;
  const r = 0.085, h = 0.62;
  const body = new THREE.Mesh(new THREE.CylinderGeometry(r, r * 1.08, h - 0.08, 10), stone);
  body.position.y = 0.04 + (h - 0.08) / 2;
  body.castShadow = true;
  const base = box(r * 2.6, 0.05, r * 2.6, stone, 0, 0.025, 0);
  const cap = box(r * 2.5, 0.05, r * 2.5, stone, 0, h - 0.025, 0);
  const intact = [body, base, cap];
  const shards = [];
  // ドラム(円柱を輪切り)× 4分割チャンク
  const nDrum = 4;
  for (let d = 0; d < nDrum; d++) {
    const y = 0.05 + (d + 0.5) * ((h - 0.1) / nDrum);
    for (let q = 0; q < 4; q++) {
      const a = (q / 4) * Math.PI * 2 + rand(-0.2, 0.2);
      const s = box(r * 1.15, (h - 0.1) / nDrum * rand(0.85, 1.0), r * 1.15, stone,
        Math.cos(a) * r * 0.45, y, Math.sin(a) * r * 0.45, a);
      shards.push(s);
    }
  }
  shards.push(box(r * 2.4, 0.05, r * 2.4, stone, 0, 0.025, 0, rand(0, 1)));
  shards.push(box(r * 2.3, 0.05, r * 2.3, stone, 0, h - 0.025, 0, rand(0, 1)));
  return { intact, shards, height: h, radius: r * 1.6 };
}

function buildGlass(materials) {
  const glass = materials.body;
  const w = 0.44, h = 0.54, t = 0.02;
  const frame = materials.accent;
  const pane = box(w, h, t, glass, 0, h / 2 + 0.03, 0);
  const stand = box(w * 0.7, 0.03, 0.12, frame, 0, 0.015, 0);
  const intact = [pane, stand];
  // shards: グリッド割り（ジッター入り）
  const shards = [];
  const nx = 5, ny = 6;
  for (let ix = 0; ix < nx; ix++) {
    for (let iy = 0; iy < ny; iy++) {
      const s = box(
        (w / nx) * rand(0.75, 1.0), (h / ny) * rand(0.75, 1.0), t,
        glass,
        (ix + 0.5) * (w / nx) - w / 2,
        0.03 + (iy + 0.5) * (h / ny),
        rand(-0.004, 0.004),
        0, rand(-0.15, 0.15)
      );
      shards.push(s);
    }
  }
  return { intact, shards, height: h + 0.03, radius: w * 0.6 };
}

function buildIce(materials) {
  const ice = materials.body;
  const r = 0.18;
  const geo = new THREE.IcosahedronGeometry(r, 0);
  const body = new THREE.Mesh(geo, ice);
  body.position.y = r * 0.85;
  body.rotation.y = rand(0, Math.PI);
  body.castShadow = true;
  const intact = [body];
  const shards = [];
  for (let i = 0; i < 10; i++) {
    const s = new THREE.Mesh(new THREE.IcosahedronGeometry(rand(0.05, 0.09), 0), ice);
    const a = rand(0, Math.PI * 2);
    const rr = rand(0, r * 0.55);
    s.position.set(Math.cos(a) * rr, r * 0.85 + rand(-r * 0.45, r * 0.45), Math.sin(a) * rr);
    s.rotation.set(rand(0, 3), rand(0, 3), rand(0, 3));
    s.castShadow = true;
    shards.push(s);
  }
  return { intact, shards, height: r * 1.7, radius: r * 1.1 };
}

// ---------- 種別レジストリ ----------
// physics は CLAUDE.md の TYPE_PROFILES に準拠。

export const TYPES = {
  crate: {
    label: '木箱', emoji: '📦', pack: 'standard', score: 100, sound: 'wood',
    particleColor: 0xc89050,
    physics: { weight: 12, fragility: 0.6, friction: 0.7, restitution: 0.2 },
    materials: () => ({ body: mat(0xb07840), accent: mat(0x6b4423) }),
    build: buildCrate,
  },
  barrel: {
    label: '樽', emoji: '🛢️', pack: 'standard', score: 120, sound: 'wood',
    particleColor: 0xa06a35,
    physics: { weight: 18, fragility: 0.55, friction: 0.6, restitution: 0.15 },
    materials: () => ({ body: mat(0x8a5a2b), accent: mat(0x3a3a3f, { rough: 0.4, metal: 0.7 }) }),
    build: buildBarrel,
  },
  vase: {
    label: '壺', emoji: '🏺', pack: 'standard', score: 150, sound: 'ceramic',
    particleColor: 0xcc7755,
    physics: { weight: 4, fragility: 0.95, friction: 0.4, restitution: 0.1 },
    materials: () => ({ body: mat(0xb5643c, { rough: 0.55 }), accent: mat(0x7a4028) }),
    build: buildVase,
  },
  rock: {
    label: '岩', emoji: '🪨', pack: 'ruins', score: 180, sound: 'stone',
    particleColor: 0x999999,
    physics: { weight: 60, fragility: 0.3, friction: 0.85, restitution: 0.05 },
    materials: () => ({ body: mat(0x8d8d92), accent: mat(0x6f6f74) }),
    build: buildRock,
  },
  pillar: {
    label: '石柱', emoji: '🏛️', pack: 'ruins', score: 250, sound: 'stone',
    particleColor: 0xcfcabb,
    physics: { weight: 95, fragility: 0.22, friction: 0.85, restitution: 0.04 },
    materials: () => ({ body: mat(0xd8d2c0, { rough: 0.75 }), accent: mat(0xb9b3a2) }),
    build: buildPillar,
  },
  glass: {
    label: 'ガラス板', emoji: '🪟', pack: 'crystal', score: 200, sound: 'glass',
    particleColor: 0xaaddff,
    physics: { weight: 5, fragility: 1.0, friction: 0.3, restitution: 0.1 },
    materials: () => ({
      body: mat(0x9fd4ee, { rough: 0.1, metal: 0.1, flat: false, opacity: 0.45 }),
      accent: mat(0x445566, { rough: 0.4, metal: 0.6 }),
    }),
    build: buildGlass,
  },
  ice: {
    label: '氷塊', emoji: '🧊', pack: 'crystal', score: 220, sound: 'glass',
    particleColor: 0xcceeff,
    physics: { weight: 18, fragility: 0.85, friction: 0.04, restitution: 0.3 },
    materials: () => ({
      body: mat(0xbfe8ff, { rough: 0.15, metal: 0.05, opacity: 0.6 }),
      accent: mat(0x9fd4ee),
    }),
    build: buildIce,
  },
};

/**
 * 破壊可能オブジェクトを生成する。
 * @returns handle: {
 *   root, intactGroup, shardsGroup, shards, type, def, golden,
 *   meta (物理パラメータ), materials (dispose 用)
 * }
 */
export function createDestructible(typeName, { golden = false, scale = 1.0 } = {}) {
  const def = TYPES[typeName];
  if (!def) throw new Error(`unknown destructible type: ${typeName}`);

  const materials = golden
    ? { body: goldenMat(), accent: goldenMat() }
    : def.materials();

  const { intact, shards, height, radius } = def.build(materials);

  const root = new THREE.Group();
  root.name = `destructible_${typeName}`;
  const intactGroup = new THREE.Group();
  intactGroup.name = 'intact';
  for (const m of intact) intactGroup.add(m);
  const shardsGroup = new THREE.Group();
  shardsGroup.name = 'shards';
  shardsGroup.visible = false;
  for (const s of shards) shardsGroup.add(s);
  root.add(intactGroup, shardsGroup);
  root.scale.setScalar(scale);
  root.rotation.y = rand(0, Math.PI * 2);

  const handle = {
    root,
    intactGroup,
    shardsGroup,
    shards,
    type: typeName,
    def,
    golden,
    height: height * scale,
    radius: radius * scale,
    broken: false,
    meta: { ...def.physics },
    materials: Object.values(materials),
  };
  // レイキャストヒットから handle を引けるように
  intactGroup.traverse(o => { o.userData.destructible = handle; });
  return handle;
}

/** handle のジオメトリ・マテリアルを破棄する（破片は GamePhysics 側で破棄済みの想定） */
export function disposeDestructible(handle) {
  handle.root.traverse(o => {
    if (o.isMesh) o.geometry.dispose();
  });
  for (const m of handle.materials) m.dispose();
}
