import { LEVELS } from '../Game.js';
import { SHOP_ITEMS } from '../Economy.js';

/**
 * ゲーム UI（DOM）。AR モードでは dom-overlay としてそのまま表示される。
 *
 * 画面: タイトル / レベル選択 / ショップ / HUD / リザルト / ポーズ / AR配置ガイド
 */
export class GameUI {
  /**
   * @param {HTMLElement} root #ui 要素
   * @param {Economy} economy
   * @param {object} cb コールバック集
   */
  constructor(root, economy, cb) {
    this.root = root;
    this.economy = economy;
    this.cb = cb;
    this.mode = '3d'; // '3d' | 'ar'
    this.arSupported = false;

    this.screen = root.querySelector('#screen');
    this.hud = root.querySelector('#hud');
    this._hudCache = {};
    this._buildHUD();
  }

  _tap() { this.cb.onUiTap?.(); }

  // ============ タイトル ============

  showTitle() {
    this.hideHUD();
    const eco = this.economy;
    const arDisabled = !this.arSupported;
    this.screen.innerHTML = `
      <div class="panel panel-title">
        <div class="logo">
          <span class="logo-crumble">CRUMBLE</span>
          <span class="logo-smash">SMASH</span>
        </div>
        <p class="tagline">現実の部屋が、破壊ステージになる。</p>
        <div class="coin-chip">🪙 <b id="title-coins">${eco.coins.toLocaleString()}</b></div>
        ${eco.premium ? '<div class="premium-badge">👑 プレミアムパス有効</div>' : ''}
        <div class="mode-toggle">
          <button class="mode-btn ${this.mode === 'ar' ? 'active' : ''}" data-mode="ar" ${arDisabled ? 'disabled' : ''}>
            📱 AR<span class="mode-sub">${arDisabled ? '非対応端末' : '現実の床で遊ぶ'}</span>
          </button>
          <button class="mode-btn ${this.mode === '3d' ? 'active' : ''}" data-mode="3d">
            🖥️ 3D<span class="mode-sub">どこでも遊べる</span>
          </button>
        </div>
        <button class="btn btn-primary btn-big" id="btn-play">あそぶ</button>
        <button class="btn btn-secondary" id="btn-shop">🛒 ショップ</button>
        <button class="btn btn-ghost" id="btn-sound">${eco.sound ? '🔊 サウンド ON' : '🔇 サウンド OFF'}</button>
        <p class="footnote">タップ（クリック）でオブジェクトを破壊！ 連続破壊でコンボ、<br>チェインをつなげてフィーバーを狙え。</p>
      </div>`;

    this.screen.querySelectorAll('.mode-btn').forEach(b =>
      b.addEventListener('click', () => {
        if (b.disabled) return;
        this._tap();
        this.mode = b.dataset.mode;
        this.showTitle();
      }));
    this.screen.querySelector('#btn-play').addEventListener('click', () => { this._tap(); this.showLevelSelect(); });
    this.screen.querySelector('#btn-shop').addEventListener('click', () => { this._tap(); this.showShop(); });
    this.screen.querySelector('#btn-sound').addEventListener('click', () => {
      this.cb.onSoundToggle(!this.economy.sound);
      this.showTitle();
    });
  }

  // ============ レベル選択 ============

  showLevelSelect() {
    const eco = this.economy;
    const cards = LEVELS.map(level => {
      const unlocked = eco.isLevelUnlocked(level.id, LEVELS);
      const res = eco.levelResult(level.id);
      const stars = '★'.repeat(res.stars) + '<span class="star-off">' + '★'.repeat(3 - res.stars) + '</span>';
      if (!unlocked) {
        return `<div class="level-card locked">
          <div class="level-num">🔒</div>
          <div class="level-name">${level.name}</div>
          <div class="level-lock-hint">前のレベルで★1</div>
        </div>`;
      }
      return `<button class="level-card" data-level="${level.id}">
        <div class="level-num">${level.id}</div>
        <div class="level-name">${level.name}</div>
        <div class="level-stars">${stars}</div>
        <div class="level-best">${res.best > 0 ? 'BEST ' + res.best.toLocaleString() : level.duration + '秒'}</div>
      </button>`;
    }).join('');

    this.screen.innerHTML = `
      <div class="panel panel-levels">
        <div class="panel-header">
          <button class="btn btn-back" id="btn-back">←</button>
          <h2>レベルをえらぶ</h2>
          <div class="coin-chip small">🪙 ${eco.coins.toLocaleString()}</div>
        </div>
        <div class="level-grid">${cards}</div>
        <p class="footnote">モード: ${this.mode === 'ar' ? '📱 AR — 床にカメラを向けて配置' : '🖥️ 3D'}</p>
      </div>`;

    this.screen.querySelector('#btn-back').addEventListener('click', () => { this._tap(); this.showTitle(); });
    this.screen.querySelectorAll('.level-card[data-level]').forEach(b =>
      b.addEventListener('click', () => {
        this._tap();
        const level = LEVELS.find(l => l.id === Number(b.dataset.level));
        this.cb.onPlay(level, this.mode);
      }));
  }

  // ============ ショップ ============

  showShop() {
    const eco = this.economy;
    const rows = SHOP_ITEMS.map((item, i) => {
      const owned = eco.isOwned(item);
      let btn;
      if (owned) {
        btn = '<span class="shop-owned">✓ 解放済み</span>';
      } else if (item.kind === 'coins') {
        const afford = eco.coins >= item.price;
        btn = `<button class="btn btn-buy ${afford ? '' : 'poor'}" data-item="${i}">🪙 ${item.price.toLocaleString()}</button>`;
      } else {
        btn = `<button class="btn btn-buy iap" data-item="${i}">${item.priceLabel}</button>`;
      }
      return `<div class="shop-item ${owned ? 'owned' : ''}">
        <div class="shop-emoji">${item.emoji}</div>
        <div class="shop-info">
          <div class="shop-name">${item.name}</div>
          <div class="shop-desc">${item.desc}</div>
        </div>
        <div class="shop-action">${btn}</div>
      </div>`;
    }).join('');

    this.screen.innerHTML = `
      <div class="panel panel-shop">
        <div class="panel-header">
          <button class="btn btn-back" id="btn-back">←</button>
          <h2>ショップ</h2>
          <div class="coin-chip small">🪙 ${eco.coins.toLocaleString()}</div>
        </div>
        <div class="shop-list">${rows}</div>
        <p class="footnote">「¥」表記のアイテムはアプリ内課金（このビルドでは決済デモ）。</p>
      </div>`;

    this.screen.querySelector('#btn-back').addEventListener('click', () => { this._tap(); this.showTitle(); });
    this.screen.querySelectorAll('.btn-buy').forEach(b =>
      b.addEventListener('click', () => {
        const item = SHOP_ITEMS[Number(b.dataset.item)];
        this.cb.onBuy(item, b);
      }));
  }

  // ============ HUD ============

  _buildHUD() {
    this.hud.innerHTML = `
      <div class="hud-top">
        <div class="hud-time"><span id="hud-time">0</span><small>秒</small></div>
        <div class="hud-score" id="hud-score">0</div>
        <button class="btn btn-pause" id="hud-pause">⏸</button>
      </div>
      <div class="hud-combo hidden" id="hud-combo">
        <div class="combo-label"><b id="hud-chain">0</b> CHAIN <span class="combo-mult" id="hud-mult">×1</span></div>
        <div class="combo-meter"><div class="combo-meter-fill" id="hud-combo-fill"></div></div>
      </div>
      <div class="hud-fever hidden" id="hud-fever">🔥 FEVER!! 🔥</div>
      <div class="hud-countdown" id="hud-countdown"></div>`;
    this.hud.querySelector('#hud-pause').addEventListener('click', () => this.cb.onPauseToggle());
    this._h = {
      time: this.hud.querySelector('#hud-time'),
      score: this.hud.querySelector('#hud-score'),
      combo: this.hud.querySelector('#hud-combo'),
      chain: this.hud.querySelector('#hud-chain'),
      mult: this.hud.querySelector('#hud-mult'),
      fill: this.hud.querySelector('#hud-combo-fill'),
      fever: this.hud.querySelector('#hud-fever'),
      countdown: this.hud.querySelector('#hud-countdown'),
    };
  }

  showHUD() {
    this.screen.innerHTML = '';
    this.hud.classList.remove('hidden');
    this._hudCache = {};
  }

  hideHUD() {
    this.hud.classList.add('hidden');
    this._h.fever.classList.add('hidden');
    this._h.combo.classList.add('hidden');
  }

  updateHUD(s) {
    const c = this._hudCache;
    if (c.time !== s.time) { c.time = s.time; this._h.time.textContent = s.time; this._h.time.parentElement.classList.toggle('warn', s.time <= 5); }
    if (c.score !== s.score) { c.score = s.score; this._h.score.textContent = s.score.toLocaleString(); }
    const showCombo = s.chain >= 2;
    if (c.showCombo !== showCombo) { c.showCombo = showCombo; this._h.combo.classList.toggle('hidden', !showCombo); }
    if (showCombo) {
      if (c.chain !== s.chain) { c.chain = s.chain; this._h.chain.textContent = s.chain; }
      if (c.mult !== s.mult) { c.mult = s.mult; this._h.mult.textContent = `×${s.mult}`; }
      this._h.fill.style.transform = `scaleX(${Math.max(s.comboRatio, 0)})`;
    }
    if (c.fever !== s.fever) { c.fever = s.fever; this._h.fever.classList.toggle('hidden', !s.fever); }
  }

  showCountdown(text) {
    const el = this._h.countdown;
    el.textContent = text;
    el.classList.remove('pop');
    void el.offsetWidth; // アニメーション再トリガー
    el.classList.add('pop');
  }

  showFeverBanner() { this.showCountdown('🔥 FEVER TIME 🔥'); }

  // ============ リザルト ============

  showResults(result, { hasNext }) {
    this.hideHUD();
    const starEls = [1, 2, 3].map(i =>
      `<span class="result-star ${result.stars >= i ? 'on' : ''}" style="animation-delay:${i * 0.25}s">★</span>`
    ).join('');
    this.screen.innerHTML = `
      <div class="panel panel-result">
        <h2 class="result-title">${result.stars >= 3 ? 'PERFECT!' : result.stars >= 1 ? 'CLEAR!' : 'TIME UP'}</h2>
        <div class="result-level">Lv.${result.level.id} ${result.level.name}</div>
        <div class="result-stars">${starEls}</div>
        <div class="result-score">${result.score.toLocaleString()}<small> 点</small>
          ${result.newBest ? '<span class="new-best">NEW BEST!</span>' : ''}</div>
        <div class="result-rows">
          <div class="result-row"><span>破壊数</span><b>${result.broken}</b></div>
          <div class="result-row"><span>ゴールデン</span><b>${result.golden}</b></div>
          <div class="result-row"><span>ベストスコア</span><b>${result.best.toLocaleString()}</b></div>
          <div class="result-row reward"><span>獲得コイン</span><b>🪙 +${result.coins.toLocaleString()}</b></div>
        </div>
        <div class="result-buttons">
          <button class="btn btn-secondary" id="btn-retry">もう一度</button>
          ${hasNext ? '<button class="btn btn-primary" id="btn-next">次のレベル →</button>' : ''}
        </div>
        <button class="btn btn-ghost" id="btn-home">ホームへ</button>
      </div>`;
    this.screen.querySelector('#btn-retry').addEventListener('click', () => { this._tap(); this.cb.onRetry(result.level); });
    this.screen.querySelector('#btn-next')?.addEventListener('click', () => { this._tap(); this.cb.onNext(result.level); });
    this.screen.querySelector('#btn-home').addEventListener('click', () => { this._tap(); this.cb.onHome(); });
  }

  // ============ ポーズ ============

  showPause() {
    this.screen.innerHTML = `
      <div class="panel panel-pause">
        <h2>ポーズ中</h2>
        <button class="btn btn-primary" id="btn-resume">つづける</button>
        <button class="btn btn-ghost" id="btn-quit">ラウンドをやめる</button>
      </div>`;
    this.screen.querySelector('#btn-resume').addEventListener('click', () => { this._tap(); this.cb.onPauseToggle(); });
    this.screen.querySelector('#btn-quit').addEventListener('click', () => { this._tap(); this.cb.onQuitRound(); });
  }

  hidePause() { this.screen.innerHTML = ''; }

  // ============ AR 配置ガイド ============

  showPlacementHint() {
    this.hideHUD();
    this.screen.innerHTML = `
      <div class="ar-hint">
        <div class="ar-hint-icon">📱→🟢</div>
        床にカメラをゆっくり向けて、<br>緑のリングが出たら <b>タップして配置</b>
      </div>`;
  }

  hidePlacementHint() { this.screen.innerHTML = ''; }

  // ============ 汎用 ============

  toast(html) {
    const el = document.createElement('div');
    el.className = 'toast';
    el.innerHTML = html;
    this.root.appendChild(el);
    setTimeout(() => el.classList.add('show'), 20);
    setTimeout(() => { el.classList.remove('show'); setTimeout(() => el.remove(), 400); }, 2600);
  }
}
