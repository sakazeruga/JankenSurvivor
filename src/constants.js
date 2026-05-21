// ── Canvas virtual resolution ──────────────────────────────────────────────
export const CANVAS_W = 390;
export const CANVAS_H = 760;

// ── Attribute definitions ──────────────────────────────────────────────────
export const ATTR = Object.freeze({ ROCK: 'ROCK', SCISSORS: 'SCISSORS', PAPER: 'PAPER' });
export const ALL_ATTRS = [ATTR.ROCK, ATTR.SCISSORS, ATTR.PAPER];

export const BEATS = {
  [ATTR.ROCK]:     ATTR.SCISSORS,
  [ATTR.SCISSORS]: ATTR.PAPER,
  [ATTR.PAPER]:    ATTR.ROCK,
};

export const ATTR_COLOR = {
  [ATTR.ROCK]:     '#E74C3C',
  [ATTR.SCISSORS]: '#2ECC71',
  [ATTR.PAPER]:    '#3498DB',
};

export const ATTR_SYMBOL = {
  [ATTR.ROCK]:     '✊',
  [ATTR.SCISSORS]: '✌',
  [ATTR.PAPER]:    '✋',
};

export const ATTR_LABEL = {
  [ATTR.ROCK]:     'グー',
  [ATTR.SCISSORS]: 'チョキ',
  [ATTR.PAPER]:    'パー',
};

// ── Difficulty ─────────────────────────────────────────────────────────────
export const DIFFICULTY = Object.freeze({
  EASY:     'EASY',
  NORMAL:   'NORMAL',
  HARD:     'HARD',
  MERCILESS:'MERCILESS',
});

export const DIFFICULTY_CONFIG = {
  EASY:      { speedMult: 1.0, scoreMult: 1.0, damageMult: 0.5, label: 'イージー',  color: '#2ECC71' },
  NORMAL:    { speedMult: 1.5, scoreMult: 1.5, damageMult: 1.0, label: 'ノーマル',  color: '#3498DB' },
  HARD:      { speedMult: 2.0, scoreMult: 2.0, damageMult: 2.0, label: 'ハード',    color: '#E67E22' },
  MERCILESS: { speedMult: 3.0, scoreMult: 3.0, damageMult: 3.0, label: '無慈悲',    color: '#E74C3C' },
};

// ── Enemy types ────────────────────────────────────────────────────────────
export const ENEMY_TYPE = Object.freeze({ NORMAL: 'NORMAL', MEDIUM: 'MEDIUM', LARGE: 'LARGE' });
export const ENEMY_TYPE_CONFIG = {
  NORMAL: { hpMult: 1, radiusScale: 1.0  },
  MEDIUM: { hpMult: 2, radiusScale: 1.35 },
  LARGE:  { hpMult: 5, radiusScale: 1.75 },
};

// ── Skills ─────────────────────────────────────────────────────────────────
// Common skills shown in Rock/Scissors/Paper columns (one chosen randomly per column)
export const ATTR_COMMON_SKILLS = [
  { id: 'com_bullets', label: '弾数追加',   desc: '発射弾数+1（累積）',   rarity: 'common', baseCost: 300 },
  { id: 'com_speed',   label: '弾速強化',   desc: '弾速+40%（累積）',     rarity: 'common', baseCost: 300 },
  { id: 'com_power',   label: '攻撃力強化', desc: '攻撃力+60%（累積）',   rarity: 'common', baseCost: 300 },
];

// Rare skill for each attribute column (25% chance to appear instead of common)
export const ATTR_RARE_SKILLS = {
  [ATTR.ROCK]:     { id: 'rare_pierce', label: '貫通弾',   desc: '20%で貫通弾を追加発射\n相性無視・2倍ダメ\n弾速強化で攻撃力も上昇(+60%/Lv)', rarity: 'rare', baseCost: 600 },
  [ATTR.SCISSORS]: { id: 'rare_split',  label: '分裂弾',   desc: '20%で分裂弾を追加発射\n命中時に2方向へ分裂\n弾数強化で発射数×2増加(2,4,6…)', rarity: 'rare', baseCost: 600 },
  [ATTR.PAPER]:    { id: 'rare_laser',  label: 'レーザー', desc: '20%でレーザーを追加発射\n直線全体0.5倍ダメ\n攻撃力強化が2倍適用(+120%/Lv)',  rarity: 'rare', baseCost: 600 },
};

// 汎用 column: common skills
export const UTIL_COMMON_SKILLS = [
  { id: 'util_bomb',   label: '無料ボム',   desc: 'ボム使用可能回数+1',              rarity: 'common', baseCost: 400 },
  { id: 'util_score',  label: 'スコア倍率', desc: 'スコア獲得量×1.1倍',             rarity: 'common', baseCost: 400 },
  { id: 'rare_shield', label: '守護盾',     desc: 'Lv1=1秒/Lv毎+0.2秒の無敵\nCT5秒（累積でLv上昇）', rarity: 'common', baseCost: 400 },
];

// 汎用 column: rare skills (one drawn randomly at 25% chance)
export const UTIL_RARE_SKILLS = [
  { id: 'rare_power', label: '全力強化', desc: '全攻撃力+40%（累積）', rarity: 'rare', baseCost: 600 },
];

// ── Colors ─────────────────────────────────────────────────────────────────
export const COLORS = {
  BG:       '#1A1A2E',
  BG_PANEL: '#16213E',
  UI_TEXT:  '#FFFFFF',
  UI_DIM:   '#AAAAAA',
  RARE:     '#FFD700',
  UTIL:     '#9B59B6',
};

// ── Game constants ─────────────────────────────────────────────────────────
export const ENEMY_RADIUS        = 24;
export const BOSS_RADIUS         = 38;
export const GRAND_BOSS_RADIUS   = 52;
export const MID_BOSS_RADIUS     = 46;
export const BULLET_RADIUS       = 10;
export const BTN_AREA_H     = 130;
export const KILL_LINE_Y    = CANVAS_H - BTN_AREA_H - 10;
export const SPAWN_Y        = -ENEMY_RADIUS - 4;

export const INITIAL_SCORE    = 1000;
export const BASE_HIT_PENALTY = 500;
export const BOMBS_PER_STAGE  = 3;

export const CHAIN_RADIUS    = 90;
export const CHAIN_MAX_DEPTH = 4;

// ── Audio paths ────────────────────────────────────────────────────────────
export const AUDIO = {
  BGM_TITLE:      'assets/audio/TitleBGM.mp3',
  BGM_STAGE:      'assets/audio/StageBGM.mp3',
  BGM_BOSS:       'assets/audio/BossBGM.mp3',
  BGM_GRAND_BOSS: 'assets/audio/GrandBossBGM.mp3',
  SFX_ROCK:       'assets/wav/UseRock.mp3',
  SFX_SCISSORS:   'assets/wav/UseScissor.mp3',
  SFX_PAPER:      'assets/wav/UsePaper.mp3',
  SFX_BOMB:       'assets/wav/UseBomb.mp3',
  SFX_DESTROY:    'assets/wav/DestroyEnemy.mp3',
  SFX_BOSS_KILL:  'assets/wav/BossKill.mp3',
  SFX_POWERUP:    'assets/wav/Powerup.mp3',
  SFX_SELECT:     'assets/wav/SelectDifficulty.mp3',
  SFX_START:      'assets/wav/Start_or_NextStage.mp3',
  SFX_WARNING:    'assets/wav/Warning.mp3',
  SFX_CAUTION:    'assets/wav/Caution.mp3',
};
