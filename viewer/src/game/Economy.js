/**
 * ゲーム内経済・進行状況の管理（localStorage 永続化）。
 *
 * 課金（IAP）は「スタブ」実装: purchaseIAP() が決済プロバイダ
 * （Stripe / App Store / Google Play Billing 等）への統合ポイント。
 * 現状は確認ダイアログ→即時成功のデモ動作で、課金フローの UX と
 * アイテム付与ロジックだけを本実装している。
 */

const STORAGE_KEY = 'crumble_smash_save_v1';

/** ショップカタログ */
export const SHOP_ITEMS = [
  {
    id: 'pack_ruins', kind: 'coins', price: 1200,
    name: '石の遺跡パック', desc: '岩と石柱が出現するようになる。重量級の破壊音は爽快感バツグン。',
    emoji: '🏛️', grants: { pack: 'ruins' },
  },
  {
    id: 'pack_crystal', kind: 'coins', price: 2000,
    name: 'クリスタルパック', desc: 'ガラス板と氷塊が出現。パリーン！という破砕音とキラキラ破片。',
    emoji: '💎', grants: { pack: 'crystal' },
  },
  {
    id: 'premium', kind: 'iap', priceLabel: '¥480',
    name: 'プレミアムパス', desc: '全パック解放＋ゴールデン出現率2.4倍＋獲得コイン1.5倍。買い切り。',
    emoji: '👑', grants: { premium: true },
  },
  {
    id: 'coins_s', kind: 'iap', priceLabel: '¥160',
    name: 'コイン 2,000枚', desc: 'すぐにパックを解放したい人向けのコインパック。',
    emoji: '🪙', grants: { coins: 2000 },
  },
  {
    id: 'coins_l', kind: 'iap', priceLabel: '¥480',
    name: 'コイン 8,000枚', desc: 'たっぷりコイン。1枚あたり33%おトク。',
    emoji: '💰', grants: { coins: 8000 },
  },
];

const DEFAULT_STATE = {
  coins: 300,            // 初回ボーナス
  premium: false,
  packs: ['standard'],
  levels: {},            // { [levelId]: { best, stars } }
  sound: true,
  lastDaily: '',         // 'YYYY-MM-DD'
  streak: 0,
};

export class Economy {
  constructor() {
    this.state = this._load();
  }

  _load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) return { ...DEFAULT_STATE, ...JSON.parse(raw) };
    } catch { /* 破損時は初期化 */ }
    return { ...DEFAULT_STATE };
  }

  save() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(this.state)); } catch { /* noop */ }
  }

  // ---------- コイン ----------

  get coins() { return this.state.coins; }

  addCoins(n) {
    this.state.coins += n;
    this.save();
  }

  /** ラウンド報酬の計算（プレミアムは1.5倍） */
  roundReward(score, goldenCount) {
    let coins = Math.floor(score / 100) + goldenCount * 25;
    if (this.state.premium) coins = Math.floor(coins * 1.5);
    return coins;
  }

  // ---------- パック / 出現プール ----------

  hasPack(id) { return this.state.premium || this.state.packs.includes(id); }
  get premium() { return this.state.premium; }

  /** ゴールデンオブジェクト出現率 */
  get goldenRate() { return this.state.premium ? 0.12 : 0.05; }

  /** 解放済みパックでフィルタした出現可能種別 */
  availableTypes(allTypes) {
    return Object.entries(allTypes)
      .filter(([, def]) => this.hasPack(def.pack))
      .map(([name]) => name);
  }

  // ---------- レベル進行 ----------

  levelResult(levelId) { return this.state.levels[levelId] ?? { best: 0, stars: 0 }; }

  isLevelUnlocked(levelId, levels) {
    const idx = levels.findIndex(l => l.id === levelId);
    if (idx <= 0) return true;
    return this.levelResult(levels[idx - 1].id).stars >= 1;
  }

  /** 結果を記録して { newBest, prevStars } を返す */
  recordResult(levelId, score, stars) {
    const prev = this.levelResult(levelId);
    const newBest = score > prev.best;
    this.state.levels[levelId] = {
      best: Math.max(prev.best, score),
      stars: Math.max(prev.stars, stars),
    };
    this.save();
    return { newBest, prevStars: prev.stars };
  }

  // ---------- 設定 ----------

  get sound() { return this.state.sound; }
  setSound(v) { this.state.sound = v; this.save(); }

  // ---------- デイリーボーナス ----------

  /** 当日初回起動なら { coins, streak } を返して付与。それ以外は null。 */
  claimDaily() {
    const today = new Date().toISOString().slice(0, 10);
    if (this.state.lastDaily === today) return null;
    const yesterday = new Date(Date.now() - 86400e3).toISOString().slice(0, 10);
    this.state.streak = this.state.lastDaily === yesterday
      ? Math.min(this.state.streak + 1, 5)
      : 1;
    this.state.lastDaily = today;
    const coins = 100 * this.state.streak;
    this.state.coins += coins;
    this.save();
    return { coins, streak: this.state.streak };
  }

  // ---------- 購入 ----------

  /** コイン購入。成功なら true。 */
  buyWithCoins(item) {
    if (this.state.coins < item.price) return false;
    this.state.coins -= item.price;
    this._grant(item.grants);
    this.save();
    return true;
  }

  /**
   * IAP 購入（スタブ）。
   *
   * 【本番統合ポイント】ここを決済プロバイダに差し替える:
   *   - Web:        Stripe Checkout / Payment Links
   *   - iOS PWA:    StoreKit (ラッパーアプリ経由)
   *   - Android:    Google Play Billing (TWA + Digital Goods API)
   * レシート検証はサーバサイドで行い、成功後に _grant() を呼ぶこと。
   */
  async purchaseIAP(item) {
    // デモ動作: 少し待ってから成功を返す（決済シートを開く演出はUI側）
    await new Promise(r => setTimeout(r, 600));
    this._grant(item.grants);
    this.save();
    return { ok: true, demo: true };
  }

  _grant(grants) {
    if (grants.coins) this.state.coins += grants.coins;
    if (grants.pack && !this.state.packs.includes(grants.pack)) this.state.packs.push(grants.pack);
    if (grants.premium) this.state.premium = true;
  }

  /** 購入済み判定（パック/プレミアムなど買い切りアイテム用） */
  isOwned(item) {
    if (item.grants.premium) return this.state.premium;
    if (item.grants.pack) return this.hasPack(item.grants.pack);
    return false; // コインは何度でも買える
  }
}
