import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

export class GLBLoader {
  /**
   * GLB ファイルを読み込んでシーングラフを解析する。
   * @param {string|File} source - URL 文字列 または File オブジェクト
   * @returns {{ scene, metadata, intactMesh, shardsGroup }}
   */
  async load(source) {
    const loader = new GLTFLoader();

    let gltf;
    if (source instanceof File) {
      // ドラッグ＆ドロップ: File → ObjectURL
      const url = URL.createObjectURL(source);
      try {
        gltf = await new Promise((resolve, reject) =>
          loader.load(url, resolve, undefined, reject)
        );
      } finally {
        URL.revokeObjectURL(url);
      }
    } else {
      gltf = await new Promise((resolve, reject) =>
        loader.load(source, resolve, undefined, reject)
      );
    }

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
}
