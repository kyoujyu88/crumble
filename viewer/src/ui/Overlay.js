const TYPE_LABEL = { barrel: '樽', rock: '岩', glass: 'ガラス板' };

export class Overlay {
  constructor(container, metadata) {
    this.container = container;
    this.metadata = metadata;
    this._broken = false;
    this._render();
  }

  _render() {
    const { type, pieces, weight, fragility, friction, restitution } = this.metadata;
    const label = TYPE_LABEL[type] ?? type;
    const fragPct = ((fragility ?? 0.5) * 100).toFixed(0);
    const weightStr = (weight ?? 10).toFixed(1);

    this.container.innerHTML = `
      <div class="info-panel">
        <div class="title">CRUMBLE</div>
        <div class="divider"></div>
        <div class="stat">
          <span class="stat-label">種別</span>
          <span class="stat-value">${label}</span>
        </div>
        <div class="stat">
          <span class="stat-label">破片数</span>
          <span class="stat-value">${pieces}</span>
        </div>
        <div class="stat">
          <span class="stat-label">質量</span>
          <span class="stat-value">${weightStr} kg</span>
        </div>
        <div class="stat">
          <span class="stat-label">壊れやすさ</span>
          <span class="stat-value">${fragPct}%</span>
        </div>
        <div class="stat">
          <span class="stat-label">摩擦 / 反発</span>
          <span class="stat-value">${(friction ?? 0.5).toFixed(2)} / ${(restitution ?? 0.3).toFixed(2)}</span>
        </div>
        <div class="divider"></div>
        <div class="hint" id="hint-text">${this._broken ? '💥 崩壊！' : 'クリックして破壊'}</div>
        <div class="controls">R: リセット &nbsp;|&nbsp; ドラッグ: 視点回転</div>
      </div>
    `;
  }

  update(isBroken) {
    if (isBroken !== this._broken) {
      this._broken = isBroken;
      const hint = this.container.querySelector('#hint-text');
      if (hint) hint.textContent = isBroken ? '💥 崩壊！' : 'クリックして破壊';
    }
  }

  updateMetadata(metadata) {
    this.metadata = metadata;
    this._broken = false;
    this._render();
  }
}
