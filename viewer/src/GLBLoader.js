import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

export class GLBLoader {
  /**
   * GLB ファイルを読み込んでシーングラフを解析する。
   * @param {string|File} source - URL 文字列 または File オブジェクト
   * @returns {{ scene, metadata, intactMesh, shardsGroup }}
   */
  async load(source) {
    const loader = new GLTFLoader();

    // 取得データを ArrayBuffer で受け取り、中身が本当に GLB/glTF か検証してから
    // パースする。dev サーバはファイルが無いと index.html を 200 で返すため、
    // そのまま GLTFLoader に渡すと "Unexpected token '<'" になる。ここで弾く。
    let buffer;
    let label;
    if (source instanceof File) {
      buffer = await source.arrayBuffer();
      label = source.name;
    } else {
      label = source;
      const resp = await fetch(source);
      if (!resp.ok) {
        throw new Error(`ファイルを取得できません (HTTP ${resp.status}): ${source}`);
      }
      buffer = await resp.arrayBuffer();
    }

    this._assertGLB(buffer, label);

    const gltf = await new Promise((resolve, reject) =>
      loader.parse(buffer, '', resolve, reject)
    );

    const root = gltf.scene.getObjectByName('destructible_root');
    const intactMesh = gltf.scene.getObjectByName('intact_mesh');
    const shardsGroup = gltf.scene.getObjectByName('shards');

    // カスタムプロパティ（crumble_*）からメタデータを再構築
    const ud = root?.userData ?? {};
    const metadata = {
      type: ud.crumble_type ?? 'unknown',
      pieces: Number(ud.crumble_pieces ?? 0),
      seed: Number(ud.crumble_seed ?? 0),
      weight: parseFloat(ud.crumble_weight ?? 10.0),
      fragility: parseFloat(ud.crumble_fragility ?? 0.5),
      friction: parseFloat(ud.crumble_friction ?? 0.5),
      restitution: parseFloat(ud.crumble_restitution ?? 0.3),
      // 旧バージョンのGLB（crumble_scatter_force 未対応）は fragility から再計算
      scatterForce: ud.crumble_scatter_force != null
        ? parseFloat(ud.crumble_scatter_force)
        : parseFloat(ud.crumble_fragility ?? 0.5) * 15.0,
      version: ud.crumble_version ?? '1.0',
    };

    // 影の設定
    if (intactMesh) {
      intactMesh.traverse(obj => {
        if (obj.isMesh) {
          obj.castShadow = true;
          obj.receiveShadow = true;
        }
      });
    }

    if (shardsGroup) {
      shardsGroup.visible = false; // 最初は非表示
      shardsGroup.traverse(obj => {
        if (obj.isMesh) {
          obj.castShadow = true;
          obj.receiveShadow = true;
        }
      });
    }

    return { scene: gltf.scene, metadata, intactMesh, shardsGroup };
  }

  /**
   * バッファ先頭が GLB バイナリ（マジック 'glTF'）か glTF JSON（'{'）か検証する。
   * dev サーバの index.html フォールバック（先頭 '<'）などを早期に弾く。
   */
  _assertGLB(buffer, label) {
    const head = new Uint8Array(buffer.slice(0, 4));
    // GLB バイナリ: マジック 'glTF' = 0x67 0x6C 0x54 0x46
    const isGLB =
      head[0] === 0x67 && head[1] === 0x6c && head[2] === 0x54 && head[3] === 0x46;
    // glTF(JSON) テキスト: 先頭は '{'（0x7B、前後の空白は許容しない簡易判定）
    const isJSON = head[0] === 0x7b;
    if (isGLB || isJSON) return;

    if (head[0] === 0x3c) {
      // '<' で始まる = HTML が返ってきた（ファイルが存在しない等）
      throw new Error(`GLB が見つかりません: ${label}`);
    }
    throw new Error(`GLB/glTF として認識できません: ${label}`);
  }
}
