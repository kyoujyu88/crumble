/**
 * ビューア内の物理パラメータ調整パネル。
 * 読み込んだ GLB の metadata（weight / fragility / friction / restitution）を
 * リアルタイムに書き換え、破壊挙動に反映する。
 *
 * - 破壊前にスライダーを動かすと、次の破壊で新しい値が使われる。
 * - 「壊し直す」ボタンで現在の設定のままモデルを再ロードして破壊し直せる。
 */
const FIELDS = [
  { key: 'weight', label: '質量 (kg)', min: 0.1, max: 100, step: 0.1, fmt: (v) => v.toFixed(1) },
  { key: 'fragility', label: '壊れやすさ', min: 0, max: 1, step: 0.01, fmt: (v) => v.toFixed(2) },
  { key: 'friction', label: '摩擦', min: 0, max: 1, step: 0.01, fmt: (v) => v.toFixed(2) },
  { key: 'restitution', label: '反発', min: 0, max: 1, step: 0.01, fmt: (v) => v.toFixed(2) },
];

export class ControlPanel {
  /**
   * @param {HTMLElement} container
   * @param {{ onUpdate?: function, onRebreak?: function }} handlers
   */
  constructor(container, { onUpdate, onRebreak } = {}) {
    this.container = container;
    this.onUpdate = onUpdate ?? (() => {});
    this.onRebreak = onRebreak ?? (() => {});
    this.metadata = null;
    this._inputs = {};
    this._collapsed = false;
    this._render();
  }

  _render() {
    this.container.innerHTML = `
      <div class="ctrl-panel">
        <div class="ctrl-header">
          <span class="ctrl-title">パラメータ調整</span>
          <button class="ctrl-toggle" type="button">▾</button>
        </div>
        <div class="ctrl-body">
          ${FIELDS.map(f => `
            <div class="ctrl-row">
              <label>${f.label}</label>
              <input type="range" data-key="${f.key}"
                     min="${f.min}" max="${f.max}" step="${f.step}" />
              <span class="ctrl-val" data-val="${f.key}"></span>
            </div>`).join('')}
          <button class="ctrl-rebreak" type="button">💥 この設定で壊し直す</button>
          <div class="ctrl-hint">スライダー → 破壊で反映 / 破壊後は「壊し直す」</div>
        </div>
      </div>
    `;

    this._body = this.container.querySelector('.ctrl-body');
    this.container.querySelector('.ctrl-toggle').addEventListener('click', () => this._toggle());
    this.container.querySelector('.ctrl-rebreak').addEventListener('click', () => this.onRebreak());

    for (const f of FIELDS) {
      const input = this.container.querySelector(`input[data-key="${f.key}"]`);
      const valEl = this.container.querySelector(`span[data-val="${f.key}"]`);
      this._inputs[f.key] = { input, valEl, fmt: f.fmt };
      input.addEventListener('input', () => {
        const v = parseFloat(input.value);
        if (this.metadata) this.metadata[f.key] = v;
        valEl.textContent = f.fmt(v);
        this.onUpdate();
      });
    }
  }

  _toggle() {
    this._collapsed = !this._collapsed;
    this._body.style.display = this._collapsed ? 'none' : '';
    this.container.querySelector('.ctrl-toggle').textContent = this._collapsed ? '▸' : '▾';
  }

  /** 新しい metadata にバインドしてスライダー値を同期する。 */
  bind(metadata) {
    this.metadata = metadata;
    for (const f of FIELDS) {
      const { input, valEl, fmt } = this._inputs[f.key];
      const v = Number(metadata[f.key] ?? input.value);
      input.value = v;
      valEl.textContent = fmt(v);
    }
  }

  /** 現在のスライダー値を取り出す（再ロード時に引き継ぐ用）。 */
  getValues() {
    const out = {};
    for (const f of FIELDS) out[f.key] = parseFloat(this._inputs[f.key].input.value);
    return out;
  }
}
