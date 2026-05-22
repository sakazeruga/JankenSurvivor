import { ALL_ATTRS, CANVAS_W, SPAWN_Y, ENEMY_TYPE, LAST_STAGE_IDX } from './constants.js';

// ── Seeded PRNG (mulberry32) ───────────────────────────────────────────────
function makeRNG(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ── Parameter formulas ─────────────────────────────────────────────────────
function enemySpeed(x)    { return Math.min(1.0 + 0.10 * x, 4.5) * 60; }
function hpMultiplier(x)  { return x / 3 + 1; }
function spawnInterval(x) { return Math.max(0.5 - 0.01 * x, 0.15); }
function enemyCount(x)    { return Math.floor(6 + 0.8 * x + 0.02 * x * x) * 3; }

// ── Enemy type selection — later waves have more medium/large ──────────────
// waveIdx 0: large 5%, medium 15%, normal 80%
// waveIdx 1: large 10%, medium 25%, normal 65%
// waveIdx 2: large 20%, medium 30%, normal 50%
function pickEnemyType(roll, waveIdx) {
  const largeCut  = [0.05, 0.10, 0.20][waveIdx] ?? 0.20;
  const mediumCut = [0.20, 0.35, 0.50][waveIdx] ?? 0.50;
  if (roll < largeCut)  return ENEMY_TYPE.LARGE;
  if (roll < mediumCut) return ENEMY_TYPE.MEDIUM;
  return ENEMY_TYPE.NORMAL;
}

// ── Attribute distribution ─────────────────────────────────────────────────
function distributeAttributes(total, rng) {
  const shuffled = [...ALL_ATTRS].sort(() => rng() - 0.5);
  const base = Math.floor(total / 3);
  const rem  = total - base * 3;
  return shuffled.map((a, i) => ({ attribute: a, n: base + (i === 0 ? rem : 0) }));
}

// ── Wave builder ───────────────────────────────────────────────────────────
function buildWave(stageIdx, waveIdx, rng) {
  // Stages 3, 6, 9 … (0-indexed 2, 5, 8 …) get the ultra boss on wave 3
  const isUltraBossStage = stageIdx % 3 === 2;
  const isGrandBossWave  = waveIdx === 2 && !isUltraBossStage;
  const isUltraBossWave  = waveIdx === 2 && isUltraBossStage;
  const isMidBossWave    = waveIdx === 1;
  // Wave 2 (waveIdx=1) is twice as long
  const count  = enemyCount(stageIdx) * (isMidBossWave ? 2 : 1);
  const speed  = enemySpeed(stageIdx);
  const hpMult = hpMultiplier(stageIdx);
  const dist   = distributeAttributes(count, rng);

  const defs = [];
  for (const { attribute, n } of dist) {
    for (let i = 0; i < n; i++) {
      const typeRoll   = rng();
      const etype      = pickEnemyType(typeRoll, waveIdx);
      const typeHpMult = etype === ENEMY_TYPE.LARGE ? 5 : etype === ENEMY_TYPE.MEDIUM ? 2 : 1;
      defs.push({
        attribute,
        enemyType: etype,
        speed: speed * (0.80 + rng() * 0.40),
        hp: Math.max(1, Math.round(hpMult * typeHpMult)),
        x: 36 + rng() * (CANVAS_W - 72),
        y: SPAWN_Y,
      });
    }
  }

  // Shuffle normal enemies
  for (let i = defs.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [defs[i], defs[j]] = [defs[j], defs[i]];
  }

  // Stage 6 (stageIdx=5) まで 2^stageIdx、それ以降は指数の伸びを 60% に抑える
  const bossExp      = stageIdx <= 5 ? stageIdx : 5 + (stageIdx - 5) * 0.6;

  // Mid-boss at exact midpoint of Wave 2
  if (isMidBossWave) {
    const midBossAttr = ALL_ATTRS[Math.floor(rng() * 3)];
    defs.splice(Math.floor(defs.length / 2), 0, {
      attribute: midBossAttr,
      isMidBoss: true,
      speed: speed / 3,
      hp: Math.round(10 * Math.pow(2, bossExp)),
      x: CANVAS_W / 2,
      y: SPAWN_Y,
    });
  }

  // Boss at end of every wave
  const bossAttr     = ALL_ATTRS[Math.floor(rng() * 3)];
  const normalBossHp = Math.round(20 * Math.pow(2, bossExp));

  if (isUltraBossWave) {
    // Ultra boss: 9× normal HP (3× grand boss), massive, continuous spawns + special skills
    defs.push({
      attribute: bossAttr,
      speed: 0,
      hp: normalBossHp * 9,
      x: CANVAS_W / 2,
      y: 112,
      isBoss: true,
      isGrandBoss: false,
      isUltraBoss: true,
    });
  } else if (isGrandBossWave) {
    // Grand boss: 3× HP, larger, has skill summons
    defs.push({
      attribute: bossAttr,
      speed: 0,
      hp: normalBossHp * 3,
      x: CANVAS_W / 2,
      y: 112,
      isBoss: true,
      isGrandBoss: true,
    });
  } else {
    // Normal boss
    defs.push({
      attribute: bossAttr,
      speed: 0,
      hp: normalBossHp,
      x: CANVAS_W / 2,
      y: 92,
      isBoss: true,
      isGrandBoss: false,
    });
  }

  return defs;
}

// ── Last Stage wave builder ────────────────────────────────────────────────
function buildLastStageWave(waveIdx, rng) {
  const stageIdx = LAST_STAGE_IDX;
  const speed    = enemySpeed(stageIdx);
  const hpMult   = hpMultiplier(stageIdx);
  const bossExp  = 5 + (stageIdx - 5) * 0.6;  // 7.4

  // Wave 4 is 3× length; others are normal length (NOT doubled like wave 2)
  const isLastWave = waveIdx === 4;
  const count  = enemyCount(stageIdx) * (isLastWave ? 3 : 1);
  const dist   = distributeAttributes(count, rng);

  const defs = [];
  for (const { attribute, n } of dist) {
    for (let i = 0; i < n; i++) {
      const typeRoll   = rng();
      const etype      = pickEnemyType(typeRoll, Math.min(waveIdx, 2));
      const typeHpMult = etype === ENEMY_TYPE.LARGE ? 5 : etype === ENEMY_TYPE.MEDIUM ? 2 : 1;
      defs.push({
        attribute, enemyType: etype,
        speed: speed * (0.80 + rng() * 0.40),
        hp: Math.max(1, Math.round(hpMult * typeHpMult)),
        x: 36 + rng() * (CANVAS_W - 72), y: SPAWN_Y,
      });
    }
  }
  for (let i = defs.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [defs[i], defs[j]] = [defs[j], defs[i]];
  }

  const midBossHp    = Math.round(10 * Math.pow(2, bossExp));
  const midSpeed     = speed / 3;

  if (isLastWave) {
    // Wave 4: 2 mid-bosses at 1/3 and 2/3, then last boss
    const i1 = Math.floor(defs.length / 3);
    const i2 = Math.floor(2 * defs.length / 3);
    defs.splice(i1, 0, {
      attribute: ALL_ATTRS[Math.floor(rng() * 3)], isMidBoss: true,
      speed: midSpeed, hp: midBossHp, x: CANVAS_W / 2, y: SPAWN_Y,
    });
    defs.splice(i2 + 1, 0, {
      attribute: ALL_ATTRS[Math.floor(rng() * 3)], isMidBoss: true,
      speed: midSpeed, hp: midBossHp, x: CANVAS_W / 2, y: SPAWN_Y,
    });
    const ultraHpBase = Math.round(20 * Math.pow(2, bossExp) * 9);
    defs.push({
      attribute: ALL_ATTRS[Math.floor(rng() * 3)],
      speed: 0, hp: Math.round(ultraHpBase * 1.5),
      x: CANVAS_W / 2, y: 112,
      isBoss: true, isLastBoss: true,
    });
  } else {
    // Waves 0-3: 1 mid-boss at midpoint
    defs.splice(Math.floor(defs.length / 2), 0, {
      attribute: ALL_ATTRS[Math.floor(rng() * 3)], isMidBoss: true,
      speed: midSpeed, hp: midBossHp, x: CANVAS_W / 2, y: SPAWN_Y,
    });
    const normalBossHp = Math.round(20 * Math.pow(2, bossExp));
    const bossAttr     = ALL_ATTRS[Math.floor(rng() * 3)];
    if (waveIdx <= 1) {
      defs.push({ attribute: bossAttr, speed: 0, hp: normalBossHp, x: CANVAS_W / 2, y: 92, isBoss: true });
    } else if (waveIdx === 2) {
      defs.push({ attribute: bossAttr, speed: 0, hp: normalBossHp * 3, x: CANVAS_W / 2, y: 112, isBoss: true, isGrandBoss: true });
    } else {
      defs.push({ attribute: bossAttr, speed: 0, hp: normalBossHp * 9, x: CANVAS_W / 2, y: 112, isBoss: true, isUltraBoss: true });
    }
  }
  return defs;
}

// ── Public API ─────────────────────────────────────────────────────────────
export function generateStage(stageIdx, seed) {
  const rng = makeRNG(seed);
  const si  = spawnInterval(stageIdx);

  if (stageIdx === LAST_STAGE_IDX) {
    const waves = [];
    for (let w = 0; w < 5; w++) {
      waves.push({ waveIndex: w, defs: buildLastStageWave(w, rng), spawnInterval: si });
    }
    return { stageIndex: stageIdx, waveCount: 5, waves };
  }

  const waves = [];
  for (let w = 0; w < 3; w++) {
    waves.push({ waveIndex: w, defs: buildWave(stageIdx, w, rng), spawnInterval: si });
  }
  return { stageIndex: stageIdx, waveCount: 3, waves };
}
