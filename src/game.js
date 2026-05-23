import { judge, chainExplosion } from './core.js';
import { Enemy, Bullet, Laser, Particle, DropItem } from './entities.js';
import { generateStage } from './stage.js';
import {
  ATTR, ALL_ATTRS, ATTR_COLOR, CHAIN_RADIUS, CHAIN_MAX_DEPTH,
  KILL_LINE_Y, CANVAS_W, CANVAS_H, SPAWN_Y,
  DIFFICULTY, DIFFICULTY_CONFIG,
  INITIAL_SCORE, BASE_HIT_PENALTY, BOMBS_PER_STAGE,
  ATTR_COMMON_SKILLS, ATTR_RARE_SKILLS,
  UTIL_COMMON_SKILLS, UTIL_RARE_SKILLS,
  ENEMY_TYPE, LAST_STAGE_IDX, LAST_BOSS_P2_RADIUS,
  MID_BOSS_RADIUS,
  AUDIO,
} from './constants.js';
import { audio } from './audio.js';

const BOSS_ATTR_PERIOD        = 4.0;   // seconds between boss attribute changes
const BOSS_SUMMON_PERIOD      = 1.17;  // seconds between normal-boss minion spawns
const GRAND_BOSS_SKILL_PERIOD = 3.5;   // seconds between grand-boss skill uses

// ── Last boss timers ───────────────────────────────────────────────────────
const LB_MINION_PERIOD    = 0.30;   // constant minion spawn (phase 1)
const LB_P1_SKILL_PERIOD  = 9.0;   // rotating skill interval (phase 1)
const LB_P2_SKILL_PERIOD  = 12.0;  // rotating skill interval (phase 2)
const LB_LINE_CHARGE_CT   = 2.5;   // default CD between line charges

// ── Ultra boss timers ──────────────────────────────────────────────────────
const ULTRA_MINION_PERIOD     = BOSS_SUMMON_PERIOD / 3; // 3× faster than normal boss (≈0.39 s)
const LB_FINAL_MINION_PERIOD  = ULTRA_MINION_PERIOD / 3; // final phase: 3× ultra boss rate (≈0.13 s)
const ULTRA_PHASE_SKILL_PERIOD= 10.0;  // mid-boss + draw-immune spawn interval (HP ≤ 90%)
const ULTRA_RUSH_PERIOD       = 14.0;  // rush attack interval (HP ≤ 50%)
const ULTRA_CHARGE_DURATION   = 2.5;   // charge wind-up before rush boss spawns
const ULTRA_ABSORB_PERIOD     = 12.0;  // time between absorption-barrier activations

export const GameState = Object.freeze({
  TITLE:            'TITLE',
  DIFFICULTY_SELECT:'DIFFICULTY_SELECT',
  PLAYING:          'PLAYING',
  PAUSED:           'PAUSED',
  WAVE_RESULT:      'WAVE_RESULT',
  GAME_OVER:        'GAME_OVER',
  GAME_CLEAR:       'GAME_CLEAR',
});

// ── Skill storage key ──────────────────────────────────────────────────────
// Common skills (com_bullets/speed/power) and per-attribute rares are keyed
// as "${ATTR}_${skillId}" so each column is tracked independently.
// UTIL skills (util_*, rare_shield, rare_power) use the bare skillId.
function skillKey(skill) {
  return skill.category !== 'UTIL' ? `${skill.category}_${skill.id}` : skill.id;
}

export class GameManager {
  constructor() {
    this._reset();
  }

  // ── Public API ───────────────────────────────────────────────────────────

  selectDifficulty() {
    this.state = GameState.DIFFICULTY_SELECT;
  }

  startGame(difficulty = DIFFICULTY.EASY) {
    this._reset();
    this.difficulty      = difficulty;
    const cfg            = DIFFICULTY_CONFIG[difficulty];
    this.speedMultiplier = cfg.speedMult;
    this.scoreMultiplier = cfg.scoreMult;
    this.state           = GameState.PLAYING;
    audio.playSfx(AUDIO.SFX_START);
    this._loadStage(0);
  }

  fireBullet(attribute) {
    if (this.state !== GameState.PLAYING) return;

    const alive = this.enemies.filter(e => e.alive && !e.exploding);
    if (alive.length === 0) return;

    alive.sort((a, b) => b.y - a.y);
    const inbound = new Map(alive.map(e => [e, 0]));
    for (const b of this.bullets) {
      if (b.alive && b.target && inbound.has(b.target)) {
        inbound.set(b.target, inbound.get(b.target) + 1);
      }
    }
    const target = alive.reduce((best, e) =>
      inbound.get(e) < inbound.get(best) ? e : best
    , alive[0]);

    // Per-attribute common skill levels
    const speedKey   = `${attribute}_com_speed`;
    const bulletsKey = `${attribute}_com_bullets`;
    const speedMult  = 1 + 0.4 * (this.skills[speedKey]   || 0);
    const bulletCount = 1 + (this.skills[bulletsKey] || 0);

    const sfxMap = {
      [ATTR.ROCK]:     AUDIO.SFX_ROCK,
      [ATTR.SCISSORS]: AUDIO.SFX_SCISSORS,
      [ATTR.PAPER]:    AUDIO.SFX_PAPER,
    };
    audio.playSfx(sfxMap[attribute]);

    for (let i = 0; i < bulletCount; i++) {
      const offsetX = (i - Math.floor(bulletCount / 2)) * 22;
      const tgt = i === 0 ? target : (alive[i % alive.length] || target);
      this.bullets.push(new Bullet({
        x: CANVAS_W / 2 + offsetX,
        y: KILL_LINE_Y - 10,
        attribute,
        target: tgt,
        speedMult,
      }));
    }

    const sx = CANVAS_W / 2;
    const sy = KILL_LINE_Y - 10;

    // Pierce bullet (rare_pierce) — only fires with ROCK
    if (attribute === ATTR.ROCK) {
      const pierceLevel = this.skills['ROCK_rare_pierce'] || 0;
      if (pierceLevel > 0 && Math.random() < 0.10 + 0.10 * pierceLevel) {
        this.bullets.push(new Bullet({ x: sx, y: sy, attribute, target, speedMult, isPierce: true }));
      }
    }

    // Split bullet (rare_split) — only fires with SCISSORS
    if (attribute === ATTR.SCISSORS) {
      const splitLevel   = this.skills['SCISSORS_rare_split'] || 0;
      if (splitLevel > 0 && Math.random() < 0.10 + 0.10 * splitLevel) {
        const bulletsLv  = this.skills['SCISSORS_com_bullets'] || 0;
        const splitCount = Math.max(1, 2 * bulletsLv); // Lv0=1, Lv1=2, Lv2=4, Lv3=6…
        for (let i = 0; i < splitCount; i++) {
          this.bullets.push(new Bullet({ x: sx, y: sy, attribute, target, speedMult, isSplit: true }));
        }
      }
    }

    // Laser (rare_laser) — only fires with PAPER
    if (attribute === ATTR.PAPER) {
      const laserLevel = this.skills['PAPER_rare_laser'] || 0;
      if (laserLevel > 0 && Math.random() < 0.10 + 0.10 * laserLevel) {
        this._fireLaser(sx, sy, attribute);
      }
    }
  }

  togglePause() {
    if (this.state === GameState.PLAYING) this.state = GameState.PAUSED;
    else if (this.state === GameState.PAUSED) this.state = GameState.PLAYING;
  }

  activateBomb() {
    if (this.state !== GameState.PLAYING) return;
    if (this.score < 100) return;
    if (this.bombsUsed >= this._maxBombs()) return;

    const cost = Math.floor(this.score / 2);
    this.score -= cost;
    this.bombsUsed++;

    audio.playSfx(AUDIO.SFX_BOMB);

    for (const e of this.enemies) {
      if (!e.alive || e.exploding || e.isBoss) continue;
      if (e.isMidBoss) {
        // Each bomb deals half of current HP (rounds down, min 1)
        this._applyDamage(e, Math.max(1, Math.floor(e.hp / 2)), null);
        continue;
      }
      e.triggerExplosion();
      this._spawnExplosionParticles(e.x, e.y, ATTR_COLOR[e.attribute]);
    }

    this.bombFlash = 0.55;
  }

  // ── Drop item spawn ───────────────────────────────────────────────────────
  _spawnDropItem(x, y, kindOverride = null, attrOverride = null, statOverride = null) {
    const _addItem = (k, a, s) => {
      const it = new DropItem(x, y, k, a, s);
      if (this.lbFinalActive) it.vy = 330; // final phase: 3× fall speed
      this.items.push(it);
    };
    if (kindOverride) { _addItem(kindOverride, attrOverride, statOverride); return; }
    const isGeneral = Math.random() < 0.3;
    let kind, attribute = null, stat;
    if (isGeneral) {
      kind = 'general';
      const opts = ['score', 'bomb', 'shield', 'battery'];
      stat = opts[Math.floor(Math.random() * opts.length)];
    } else {
      kind = 'common';
      attribute = ALL_ATTRS[Math.floor(Math.random() * 3)];
      const opts = ['power', 'speed', 'bullets'];
      stat = opts[Math.floor(Math.random() * opts.length)];
    }
    _addItem(kind, attribute, stat);
  }

  // ── Drop item collect ─────────────────────────────────────────────────────
  _collectItem(item) {
    item.alive = false;
    audio.playSfx(AUDIO.SFX_POWERUP);
    if (item.kind === 'common') {
      const key = `${item.attribute}_com_${item.stat}`;
      this.skills[key] = (this.skills[key] || 0) + 1;
    } else {
      switch (item.stat) {
        case 'score':   this.skills['util_score'] = (this.skills['util_score'] || 0) + 1; break;
        case 'bomb':    this.freeBombs++;                                                   break;
        case 'shield':  this.shieldCharges++;                                               break;
        case 'battery': this.shieldCTTimer = 0;                                             break;
      }
    }
  }

  activateShield() {
    if (this.state !== GameState.PLAYING) return;
    if (this.shieldCharges <= 0) return;
    if (this.shieldCTTimer > 0) return;
    if (this.shieldInvincTimer > 0) return;
    this.shieldInvincTimer = 0.8 + 0.2 * this.shieldCharges;
    audio.playSfx(AUDIO.SFX_POWERUP);
  }

  selectSkill(skillId) {
    if (this.state !== GameState.WAVE_RESULT) return false;
    if (this.skillSelected) return false;

    const skill = this.offeredSkills.find(s => s.id === skillId);
    if (!skill) return false;

    const cat  = skill.category;
    const n    = this.columnPurchases[cat] || 0;
    const cost = skill.baseCost * Math.pow(2, n);
    if (this.score < cost) return false;

    this.score -= cost;
    this.columnPurchases[cat] = n + 1;
    const key = skillKey(skill);
    this.skills[key] = (this.skills[key] || 0) + 1;

    if (skillId === 'rare_shield') this.shieldCharges++;

    this.skillSelected = true;
    audio.playSfx(AUDIO.SFX_POWERUP);
    return true;
  }

  advanceFromShop() {
    if (this.state !== GameState.WAVE_RESULT) return;
    audio.playSfx(AUDIO.SFX_START);
    if (this._nextWaveIdx >= 0) {
      this.state = GameState.PLAYING;
      this._loadWave(this._nextWaveIdx);
    } else {
      if (this._checkGameClear()) return;
      this.state = GameState.PLAYING;
      this._loadStage(this.stageIndex + 1);
    }
  }

  goToTitle() {
    this._reset();
  }

  // ── セーブデータから復元 ──────────────────────────────────────────────────
  loadFromSave(saveData) {
    this._reset();
    this.difficulty      = saveData.difficulty;
    const cfg            = DIFFICULTY_CONFIG[this.difficulty];
    this.speedMultiplier = cfg.speedMult;
    this.scoreMultiplier = cfg.scoreMult;
    this.skills          = { ...saveData.skills };
    this.columnPurchases = { ...saveData.columnPurchases };
    this.shieldCharges   = saveData.shieldCharges || 0;
    this.freeBombs       = saveData.freeBombs     || 0;
    this.state           = GameState.PLAYING;
    // _loadStage は INITIAL_SCORE 加算 + bombsUsed リセットをするので、後で上書き
    this._loadStage(saveData.stageIndex);
    this.score     = saveData.score;
    this.bombsUsed = saveData.bombsUsed || 0;
    if (saveData.waveIndex !== 0) {
      this._loadWave(saveData.waveIndex);
    }
    audio.playSfx(AUDIO.SFX_START);
  }

  // ── Debug: skip current wave directly to skill shop ───────────────────────
  debugSkipWave() {
    if (this.state !== GameState.PLAYING) return;

    // Award score as if every remaining enemy was defeated (100% clear rate)
    const mult = this.effectiveScoreMult;
    const awardFor = (def) => {
      let pts = Math.round(100 * mult);
      if      (def.isUltraBoss)                pts = Math.round(pts * 10);
      else if (def.isGrandBoss)                pts = Math.round(pts * 5);
      else if (def.isBoss)                     pts = Math.round(pts * 2);
      else if (def.isRushBoss)                 pts = Math.round(pts * 9);
      else if (def.isMidBoss)                  pts = Math.round(pts * 3);
      this.score += pts;
    };
    for (const def of this.pendingDefs)                   awardFor(def);
    for (const e of this.enemies) { if (e.alive && !e.exploding) awardFor(e); }

    // 期待値ベースでアイテムをランダム付与
    const allDefs = [...this.pendingDefs, ...this.enemies.filter(e => e.alive && !e.exploding)];
    let expected = 0;
    for (const d of allDefs) {
      if (d.isMidBoss)                           expected += 0.5;
      else if (d.enemyType === ENEMY_TYPE.LARGE) expected += 0.05;
    }
    const itemCount = Math.floor(expected) + (Math.random() < (expected % 1) ? 1 : 0);
    for (let i = 0; i < itemCount; i++) this._spawnDropItem(CANVAS_W / 2, 0);

    // Clear everything and jump to skill shop
    this.enemies.forEach(e => { e.alive = false; });
    this.bullets.forEach(b => { b.alive = false; });
    this.lasers.forEach(l  => { l.alive = false; });
    this.pendingDefs = [];
    this.waveCleared = true;
    this._onWaveCleared();  // ← ここで items も強制収集される
  }

  update(dt) {
    if (this.state === GameState.PLAYING) {
      this._updatePlaying(dt);
    }
  }

  // ── Derived stats ────────────────────────────────────────────────────────

  _getAttackPower(attribute) {
    const comPower  = attribute ? (this.skills[`${attribute}_com_power`] || 0) : 0;
    const rarePower = this.skills['rare_power'] || 0;
    return (1 + 0.6 * comPower) * (1 + 0.4 * rarePower);
  }

  _maxBombs() {
    return BOMBS_PER_STAGE + (this.skills['util_bomb'] || 0) + this.freeBombs;
  }

  get bombsRemaining() {
    return this._maxBombs() - this.bombsUsed;
  }

  // WAVE_RESULT 中は「次に開始すべきWave/Stage」を返す（セーブ先計算用）
  get saveTarget() {
    if (this.state === GameState.WAVE_RESULT) {
      if (this._nextWaveIdx >= 0) {
        return { stageIndex: this.stageIndex, waveIndex: this._nextWaveIdx };
      }
      return { stageIndex: this.stageIndex + 1, waveIndex: 0 };
    }
    return { stageIndex: this.stageIndex, waveIndex: this.waveIndex };
  }

  get effectiveScoreMult() {
    return this.scoreMultiplier * Math.pow(1.5, this.skills['util_score'] || 0);
  }

  get lastBossState() {
    const lb = this.enemies.find(e => e.isLastBoss && e.alive && !e.exploding);
    if (!lb) return null;
    if (lb.lbFinalPhase) return 'p3';
    return lb.lastBossPhase === 1 ? 'p1' : 'p2';
  }

  // ── Private: setup ───────────────────────────────────────────────────────

  _reset() {
    this.state           = GameState.TITLE;
    this.score           = 0;
    this.difficulty      = DIFFICULTY.EASY;
    this.speedMultiplier = 1.0;
    this.scoreMultiplier = 1.0;
    this.stageIndex      = 0;
    this.waveIndex       = 0;
    this.enemies         = [];
    this.bullets         = [];
    this.lasers          = [];
    this.particles       = [];
    this.bossDeathRings  = [];
    this.pendingDefs     = [];
    this.spawnTimer      = 0;
    this.spawnInterval   = 1.0;
    this.stageConfig     = null;
    this.damageFlash     = 0;
    this.bombFlash       = 0;
    this.bossDeathFlash  = 0;
    this.bossWarning     = 0;   // grand boss — red WARNING
    this.ultraDanger     = 0;   // ultra boss — crimson DANGER
    this.cautionTimer    = 0;   // normal boss — yellow CAUTION
    this.waveCleared     = false;
    this._nextWaveIdx    = 0;
    this.skills          = {};
    this.columnPurchases = {};   // { ROCK:0, SCISSORS:0, PAPER:0, UTIL:0 } — doubles cost per column
    this.offeredSkills   = [];
    this.skillSelected   = false;
    this.shieldCharges     = 0;
    this.shieldInvincTimer = 0;
    this.shieldCTTimer     = 0;
    this.bombsUsed         = 0;
    this.freeBombs         = 0;
    this.items             = [];
    this.buttonOrder       = [0, 1, 2];  // [0=ROCK,1=SCISSORS,2=PAPER] shuffled by last boss P2
    this.lbFinalActive     = false;      // last boss final phase flag (speeds up items × 3)
  }

  _loadStage(index) {
    this.stageIndex  = index;
    this.stageConfig = generateStage(index, index * 13337 + 54321);
    this.score      += INITIAL_SCORE;
    this.bombsUsed   = 0;
    this._loadWave(0);
  }

  _loadWave(waveIndex) {
    this.waveIndex    = waveIndex;
    this.waveCleared  = false;
    const wave        = this.stageConfig.waves[waveIndex];
    this.pendingDefs  = [...wave.defs];
    this.spawnInterval= wave.spawnInterval;
    this.spawnTimer   = 0;
    this.enemies      = [];
    this.bullets      = [];
    this.lasers       = [];
    this.bossWarning       = 0;
    this.ultraDanger       = 0;
    this.cautionTimer      = 0;
    this.shieldInvincTimer = 0;
    this.shieldCTTimer     = 0;
    this.bossDeathRings    = [];
    this.items             = [];
  }

  // ── Private: skill offer ─────────────────────────────────────────────────

  _generateSkillOffer() {
    const RARE_CHANCE = 0.25;
    const offers = [];

    const shuffledCommons = [...ATTR_COMMON_SKILLS].sort(() => Math.random() - 0.5);
    let commonIdx = 0;

    for (const attr of [ATTR.ROCK, ATTR.SCISSORS, ATTR.PAPER]) {
      if (Math.random() < RARE_CHANCE) {
        offers.push({ ...ATTR_RARE_SKILLS[attr], category: attr });
      } else {
        const skill = shuffledCommons[commonIdx % shuffledCommons.length];
        commonIdx++;
        offers.push({ ...skill, category: attr });
      }
    }

    if (Math.random() < RARE_CHANCE) {
      const rares = [...UTIL_RARE_SKILLS].sort(() => Math.random() - 0.5);
      offers.push({ ...rares[0], category: 'UTIL' });
    } else {
      const utils = [...UTIL_COMMON_SKILLS].sort(() => Math.random() - 0.5);
      offers.push({ ...utils[0], category: 'UTIL' });
    }

    this.offeredSkills = offers;
    this.skillSelected = false;
  }

  // ── Private: laser fire ──────────────────────────────────────────────────

  _fireLaser(sx, sy, attribute) {
    const alive = this.enemies.filter(e => e.alive && !e.exploding);
    if (alive.length === 0) return;

    const nearest = alive.reduce((best, e) =>
      Math.hypot(e.x - sx, e.y - sy) < Math.hypot(best.x - sx, best.y - sy) ? e : best
    , alive[0]);

    const ddx  = nearest.x - sx;
    const ddy  = nearest.y - sy;
    const dist = Math.hypot(ddx, ddy);
    if (dist < 1) return;

    // Laser uses double com_power scaling (+120%/Lv instead of +60%/Lv)
    const comPower   = this.skills[`${attribute}_com_power`] || 0;
    const rarePower  = this.skills['rare_power'] || 0;
    const laserPower = (1 + 1.2 * comPower) * (1 + 0.4 * rarePower);
    this.lasers.push(new Laser({
      x: sx, y: sy,
      dx: ddx / dist, dy: ddy / dist,
      damage: Math.max(1, Math.round(laserPower * 0.5)),
      duration: 0.55,
    }));
  }

  // ── Private: main update ─────────────────────────────────────────────────

  _updatePlaying(dt) {
    if (this.damageFlash    > 0) this.damageFlash    -= dt;
    if (this.bombFlash      > 0) this.bombFlash      -= dt;
    if (this.bossDeathFlash > 0) this.bossDeathFlash -= dt * 1.8;
    if (this.bossWarning    > 0) this.bossWarning    -= dt;
    if (this.ultraDanger   > 0) this.ultraDanger    -= dt;
    if (this.cautionTimer   > 0) this.cautionTimer   -= dt;
    if (this.shieldCTTimer  > 0) this.shieldCTTimer  -= dt;
    if (this.shieldInvincTimer > 0) {
      this.shieldInvincTimer -= dt;
      if (this.shieldInvincTimer <= 0) {
        this.shieldInvincTimer = 0;
        this.shieldCTTimer     = 5.0;
      }
    }

    for (const ring of this.bossDeathRings) ring.life -= dt * 1.4;
    this.bossDeathRings = this.bossDeathRings.filter(r => r.life > 0);

    // Spawn from queue
    this.spawnTimer -= dt;
    if (this.spawnTimer <= 0 && this.pendingDefs.length > 0) {
      const def = this.pendingDefs.shift();
      this.enemies.push(new Enemy({ ...def, speed: def.speed * this.speedMultiplier }));
      this.spawnTimer = this.spawnInterval;

      if (def.isBoss) {
        if (def.isLastBoss) {
          this.ultraDanger = 8.0;
          audio.playSfx(AUDIO.SFX_WARNING);
        } else if (def.isUltraBoss) {
          this.ultraDanger = 4.0;          // distinct DANGER display
          audio.playSfx(AUDIO.SFX_WARNING);
        } else if (def.isGrandBoss) {
          this.bossWarning = 2.5;
          audio.playSfx(AUDIO.SFX_WARNING);
        } else {
          this.cautionTimer = 1.8;
          audio.playSfx(AUDIO.SFX_CAUTION);
        }
      }
    }

    for (const e of this.enemies)   e.update(dt);
    for (const b of this.bullets)   b.update(dt);
    for (const l of this.lasers)    l.update(dt);
    for (const p of this.particles) p.update(dt);

    this._updateBosses(dt);

    // Laser ↔ Enemy collision (laser always bypasses absorption barrier)
    for (const laser of this.lasers) {
      if (!laser.alive) continue;
      for (const enemy of this.enemies) {
        if (!enemy.alive || enemy.exploding) continue;
        if (laser.hitSet.has(enemy)) continue;
        if (this._laserHitsEnemy(laser, enemy)) {
          laser.hitSet.add(enemy);
          this._applyDamage(enemy, laser.damage, null, true);
        }
      }
    }

    // Bullet ↔ Enemy collision
    for (const bullet of this.bullets) {
      if (!bullet.alive) continue;
      for (const enemy of this.enemies) {
        if (!enemy.alive || enemy.exploding) continue;
        if (bullet.isPierce && bullet.pierceHit.has(enemy)) continue;
        if (!enemy.collidesWithBullet(bullet)) continue;

        if (!bullet.isPierce) bullet.alive = false;
        const result = bullet.isPierce ? 'WIN' : judge(bullet.attribute, enemy.attribute);
        this._handleJudgment(result, bullet, enemy);
        if (!bullet.isPierce) break;
        else bullet.pierceHit.add(enemy);
      }
    }

    // Enemies escaping
    for (const enemy of this.enemies) {
      if (!enemy.alive || enemy.exploding) continue;
      if (enemy.y - enemy.radius > KILL_LINE_Y) {
        enemy.alive = false;
        this._onEnemyEscaped(enemy);
        if (this.state === GameState.GAME_OVER) return;
      }
    }

    this.enemies   = this.enemies.filter(e => e.alive);
    this.bullets   = this.bullets.filter(b => b.alive);
    this.lasers    = this.lasers.filter(l => l.alive);
    this.particles = this.particles.filter(p => p.alive);

    // ── ドロップアイテム更新・自動収集 ─────────────────────────────────────
    for (const item of this.items) {
      item.update(dt);
      if (item.alive && item.y >= KILL_LINE_Y) this._collectItem(item);
    }
    this.items = this.items.filter(i => i.alive);

    if (!this.waveCleared && this.pendingDefs.length === 0 && this.enemies.length === 0) {
      this.waveCleared = true;
      this._onWaveCleared();
    }
  }

  _updateBosses(dt) {
    // Shield phase duration grows with stage: 3.5s at stage 0, +0.4s per stage
    const shieldPhaseDur = 3.5 + this.stageIndex * 0.4;

    for (const boss of this.enemies) {
      if (!boss.isBoss || !boss.alive || boss.exploding) continue;

      // ── Last boss: separate update path ──────────────────────────────────
      if (boss.isLastBoss) {
        if (boss.lastBossPhase === 1) this._updateLastBossP1(boss, dt);
        else                          this._updateLastBossP2(boss, dt);
        continue;
      }

      // ── Temp ultra boss spawned by last boss P2 ───────────────────────────
      if (boss.lbTempUltra) {
        boss.lbTempTimer -= dt;
        if (boss.lbTempTimer <= 0) { this._destroyEnemy(boss); }
        else                        { this._updateUltraBoss(boss, dt, shieldPhaseDur); }
        continue;
      }

      // ── Ultra boss: separate update path ─────────────────────────────────
      if (boss.isUltraBoss) {
        this._updateUltraBoss(boss, dt, shieldPhaseDur);
        continue;
      }

      // ── Grand boss / Normal boss ──────────────────────────────────────────
      boss.attrCycleTimer += dt;
      if (boss.attrCycleTimer >= BOSS_ATTR_PERIOD) {
        boss.attrCycleTimer = 0;
        const others = ALL_ATTRS.filter(a => a !== boss.attribute);
        boss.attribute = others[Math.floor(Math.random() * others.length)];
        this._spawnHitParticles(boss.x, boss.y, '#FFFFFF', 10);
      }

      // Shield phase timer — skip for noShield bosses (ultra-init spawns)
      if (!boss.noShield) {
        if (boss.bossShieldTimer === null) boss.bossShieldTimer = shieldPhaseDur;
        boss.bossShieldTimer -= dt;
        if (boss.bossShieldTimer <= 0) {
          boss.bossShieldTimer = shieldPhaseDur;
          if (boss.isGrandBoss) {
            // Grand boss: 0=none → 1=damage shield → 2=draw-immune → 0 …
            boss.bossShieldPhase = (boss.bossShieldPhase + 1) % 3;
          } else {
            // Normal boss: toggle 0↔1
            boss.bossShieldPhase = boss.bossShieldPhase === 0 ? 1 : 0;
          }
        }
      }

      if (boss.isGrandBoss) {
        // Grand boss: periodic skill summons (A→B→C→A→…)
        boss.skillTimer += dt;
        if (boss.skillTimer >= GRAND_BOSS_SKILL_PERIOD) {
          boss.skillTimer = 0;
          this._executeGrandBossSkill(boss, boss.skillPhase);
          boss.skillPhase = (boss.skillPhase + 1) % 3;
        }
      } else {
        // Normal boss: continuous minion spawning
        boss.summonTimer += dt;
        if (boss.summonTimer >= BOSS_SUMMON_PERIOD) {
          boss.summonTimer = 0;
          this._spawnBossMinion(boss);
        }
      }
    }
  }

  // ── Ultra boss update ────────────────────────────────────────────────────

  _updateUltraBoss(boss, dt, shieldPhaseDur) {
    const hpRatio   = boss.hp / boss.maxHp;
    const absorbDur = shieldPhaseDur / 2; // half of normal barrier duration

    // Attribute cycle (crimson flash)
    boss.attrCycleTimer += dt;
    if (boss.attrCycleTimer >= BOSS_ATTR_PERIOD) {
      boss.attrCycleTimer = 0;
      const others = ALL_ATTRS.filter(a => a !== boss.attribute);
      boss.attribute = others[Math.floor(Math.random() * others.length)];
      this._spawnHitParticles(boss.x, boss.y, '#FF4444', 12);
    }

    // ── Initial boss summon at HP ≤ 95% ───────────────────────────────────
    if (!boss.ultraInitDone && hpRatio <= 0.95) {
      boss.ultraInitDone = true;
      this._spawnUltraInitBosses(boss);
    }

    // ── Continuous minion spawning (always active) ─────────────────────────
    boss.ultraMinionTimer -= dt;
    if (boss.ultraMinionTimer <= 0) {
      boss.ultraMinionTimer = ULTRA_MINION_PERIOD;
      this._spawnBossMinion(boss);
    }

    // ── Phase skills: mid-boss + draw-immune wave (HP ≤ 85%) ─────────────
    if (hpRatio <= 0.85 && !boss.ultraCharging) {
      boss.ultraPhaseTimer -= dt;
      if (boss.ultraPhaseTimer <= 0) {
        boss.ultraPhaseTimer = ULTRA_PHASE_SKILL_PERIOD;
        this._executeUltraPhaseSkill(boss, hpRatio);
      }
    }

    // ── Rush attack (HP ≤ 50%) ────────────────────────────────────────────
    if (hpRatio <= 0.50) {
      if (!boss.ultraCharging) {
        boss.ultraRushTimer -= dt;
        if (boss.ultraRushTimer <= 0) {
          boss.ultraRushTimer = ULTRA_RUSH_PERIOD;
          this._startUltraRushCharge(boss);
        }
      } else {
        // Counting down the charge
        boss.ultraChargeTimer -= dt;
        if (boss.ultraChargeTimer <= 0) {
          boss.ultraCharging = false;
          this._spawnUltraRushBoss(boss);
          boss.ultraChargeDamage = 0;
        }
      }

      // ── Absorption barrier (separate cooldown, HP ≤ 50%) ─────────────────
      if (!boss.ultraAbsorbActive) {
        boss.ultraAbsorbCooldown -= dt;
        if (boss.ultraAbsorbCooldown <= 0) {
          boss.ultraAbsorbActive   = true;
          boss.ultraAbsorbTimer    = absorbDur;
          boss.ultraAbsorbCooldown = ULTRA_ABSORB_PERIOD;
        }
      } else {
        boss.ultraAbsorbTimer -= dt;
        if (boss.ultraAbsorbTimer <= 0) {
          boss.ultraAbsorbActive = false;
        }
      }
    }
  }

  // ── Last boss: Phase 1 update ─────────────────────────────────────────────

  _updateLastBossP1(boss, dt) {
    const hpRatio = boss.hp / boss.maxHp;

    // Attribute cycle
    boss.attrCycleTimer += dt;
    if (boss.attrCycleTimer >= BOSS_ATTR_PERIOD) {
      boss.attrCycleTimer = 0;
      const others = ALL_ATTRS.filter(a => a !== boss.attribute);
      boss.attribute = others[Math.floor(Math.random() * others.length)];
      this._spawnHitParticles(boss.x, boss.y, '#FF2200', 16);
    }

    // Fixed: 2 bosses at HP ≤ 90% (once)
    if (!boss.lbP1_90done && hpRatio <= 0.90) {
      boss.lbP1_90done = true;
      this._lbSummon2Bosses(boss);
    }
    // Fixed: 2 bosses at HP ≤ 40% (once)
    if (!boss.lbP1_40done && hpRatio <= 0.40) {
      boss.lbP1_40done = true;
      this._lbSummon2Bosses(boss);
    }

    // Continuous fast minion spawn
    boss.lbMinionTimer -= dt;
    if (boss.lbMinionTimer <= 0) {
      boss.lbMinionTimer = LB_MINION_PERIOD;
      this._spawnBossMinion(boss);
    }

    // Rush charge queue (queued by skill idx=3 at HP≤75%)
    if (boss.lbRushQueue > 0) {
      boss.lbRushCT -= dt;
      if (boss.lbRushCT <= 0) {
        boss.lbRushQueue--;
        boss.lbRushCT = 3.0;
        this._lbSpawnRushMidBoss(boss);
      }
    }

    // Rotating skills
    boss.lbSkillTimer -= dt;
    if (boss.lbSkillTimer <= 0) {
      boss.lbSkillTimer = LB_P1_SKILL_PERIOD;
      this._executeLbP1Skill(boss, hpRatio);
    }

    // Absorb barrier timing: 3s on / 7s off → ~30% uptime
    if (!boss.lbAbsorbActive) {
      boss.lbAbsorbCooldown -= dt;
      if (boss.lbAbsorbCooldown <= 0) {
        boss.lbAbsorbActive = true;
        boss.lbAbsorbTimer  = 3.0;
      }
    } else {
      boss.lbAbsorbTimer -= dt;
      if (boss.lbAbsorbTimer <= 0) {
        boss.lbAbsorbActive   = false;
        boss.lbAbsorbCooldown = 7.0;
      }
    }
  }

  // ── Last boss: Phase 2 update ─────────────────────────────────────────────

  _updateLastBossP2(boss, dt) {
    // Final phase: count down to self-destruct
    if (boss.lbFinalPhase) {
      boss.lbFinalTimer -= dt;
      boss.lbFinalSkillTimer -= dt;
      if (boss.lbFinalSkillTimer <= 0) {
        const shieldDur = 0.8 + 0.2 * this.shieldCharges;
        boss.lbFinalSkillTimer = Math.max(1.5, 5.0 - shieldDur) + 0.5 + Math.random() * 0.5;
        this._lbSpawnLineCharge();
        // Drop battery item (fast fall)
        this._spawnDropItem(boss.x, boss.y + 20, 'general', null, 'battery');
      }
      // Massive minion flood: 3× ultra boss rate
      boss.lbFinalMinionTimer -= dt;
      if (boss.lbFinalMinionTimer <= 0) {
        boss.lbFinalMinionTimer = LB_FINAL_MINION_PERIOD;
        this._spawnBossMinion(boss);
      }
      if (boss.lbFinalTimer <= 0) {
        this._destroyEnemy(boss);
      }
      return;
    }

    const hpRatio = boss.hp / boss.maxHp;

    // Check 5% → final phase
    if (hpRatio <= 0.05) {
      this._lastBossFinalPhase(boss);
      return;
    }

    // Attribute cycle
    boss.attrCycleTimer += dt;
    if (boss.attrCycleTimer >= BOSS_ATTR_PERIOD) {
      boss.attrCycleTimer = 0;
      const others = ALL_ATTRS.filter(a => a !== boss.attribute);
      boss.attribute = others[Math.floor(Math.random() * others.length)];
    }

    // Fixed threshold: mid-boss line charges at 80/60/40/20%
    const th = boss.lbP2_th;
    if (!th.t80 && hpRatio <= 0.80) { th.t80 = true; boss.lbP2_lineQueue += 1; }
    if (!th.t60 && hpRatio <= 0.60) { th.t60 = true; boss.lbP2_lineQueue += 1; }
    if (!th.t40 && hpRatio <= 0.40) { th.t40 = true; boss.lbP2_lineQueue += 2; }
    if (!th.t20 && hpRatio <= 0.20) { th.t20 = true; boss.lbP2_lineQueue += 3; }

    boss.lbP2_lineCT -= dt;
    if (boss.lbP2_lineQueue > 0 && boss.lbP2_lineCT <= 0) {
      boss.lbP2_lineQueue--;
      boss.lbP2_lineCT = th.t20 ? 2.0 : LB_LINE_CHARGE_CT;
      this._lbSpawnLineCharge();
    }

    // Rotating skills (faster at HP≤40%)
    const skillPeriod = hpRatio <= 0.40 ? LB_P2_SKILL_PERIOD * 0.67 : LB_P2_SKILL_PERIOD;
    boss.lbP2_skillTimer -= dt;
    if (boss.lbP2_skillTimer <= 0) {
      boss.lbP2_skillTimer = skillPeriod;
      this._executeLbP2Skill(boss, hpRatio);
    }
  }

  // ── Last boss: Phase 1 → 2 transition ────────────────────────────────────

  _lastBossPhase2Transition(boss) {
    const bossExp  = 5 + (LAST_STAGE_IDX - 5) * 0.6;
    const ultraHpBase = Math.round(20 * Math.pow(2, bossExp) * 9);
    const p2Hp    = Math.round(ultraHpBase * 3);

    boss.lastBossPhase = 2;
    boss.hp            = p2Hp;
    boss.maxHp         = p2Hp;
    boss.radius        = LAST_BOSS_P2_RADIUS;
    boss.lbP2_th         = { t80: false, t60: false, t40: false, t20: false };
    boss.lbP2_lineQueue  = 0;
    boss.lbP2_lineCT     = 0;
    boss.lbP2_skillTimer = 10.0;
    boss.lbP2_skillIdx   = 0;
    boss.attrCycleTimer  = 0;

    // Visual effects
    const cols = ['#FF0000', '#FF8800', '#FFFF00', '#FF00FF', '#FFFFFF'];
    for (const c of cols) {
      for (let i = 0; i < 28; i++) {
        const angle = Math.random() * Math.PI * 2;
        const speed = 280 + Math.random() * 420;
        this.particles.push(new Particle({ x: boss.x, y: boss.y, color: c,
          radius: 7 + Math.random() * 12,
          vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed - 150,
          life: 0.7 + Math.random() * 0.9 }));
      }
    }
    this.bossDeathRings = [
      { x: boss.x, y: boss.y, maxRadius: 480, life: 2.0, maxLife: 2.0, color: '#FF0000' },
      { x: boss.x, y: boss.y, maxRadius: 360, life: 1.6, maxLife: 1.6, color: '#FF8800' },
      { x: boss.x, y: boss.y, maxRadius: 260, life: 1.2, maxLife: 1.2, color: '#FFD700' },
    ];
    this.bossDeathFlash = 2.2;
    audio.playSfx(AUDIO.SFX_BOSS_KILL);

    // Clear non-boss enemies on transition
    for (const e of this.enemies) {
      if (e !== boss && e.alive && !e.exploding && !e.isBoss) {
        e.triggerExplosion();
        this._spawnExplosionParticles(e.x, e.y, ATTR_COLOR[e.attribute]);
      }
    }
  }

  // ── Last boss: Phase 2 → Final Phase ─────────────────────────────────────

  _lastBossFinalPhase(boss) {
    boss.lbFinalPhase = true;
    boss.lbFinalTimer = 40.0;
    boss.hp           = 0;
    const shieldDur   = 0.8 + 0.2 * this.shieldCharges;
    boss.lbFinalSkillTimer = Math.max(1.5, 5.0 - shieldDur) + 0.5 + Math.random() * 0.5;

    this.bossDeathFlash = 1.8;
    this.bossDeathRings = [
      { x: boss.x, y: boss.y, maxRadius: 320, life: 1.4, maxLife: 1.4, color: '#FF0000' },
      { x: boss.x, y: boss.y, maxRadius: 220, life: 1.1, maxLife: 1.1, color: '#FF00FF' },
      { x: boss.x, y: boss.y, maxRadius: 140, life: 0.8, maxLife: 0.8, color: '#FFFFFF' },
    ];
    // Clear all non-boss enemies
    for (const e of this.enemies) {
      if (e !== boss && e.alive && !e.exploding && !e.isBoss) {
        e.triggerExplosion();
        this._spawnExplosionParticles(e.x, e.y, ATTR_COLOR[e.attribute]);
      }
    }

    // Activate final-phase flags: speed up existing items × 3
    this.lbFinalActive = true;
    for (const item of this.items) item.vy = 330;
  }

  // ── Last boss: helpers ────────────────────────────────────────────────────

  _lbSummon2Bosses(boss) {
    const bossExp     = 5 + (LAST_STAGE_IDX - 5) * 0.6;
    const normalBossHp = Math.round(20 * Math.pow(2, bossExp));
    const positions   = [CANVAS_W * 0.22, CANVAS_W * 0.78];
    for (const bx of positions) {
      const e = new Enemy({
        x: bx, y: boss.y + boss.radius + 50,
        attribute: ALL_ATTRS[Math.floor(Math.random() * 3)],
        speed: 0, hp: normalBossHp, isBoss: true,
      });
      e.bossShieldPhase = 0;
      e.noShield        = true;
      e.summonTimer     = 0;
      this.enemies.push(e);
    }
    this.cautionTimer = 1.8;
    audio.playSfx(AUDIO.SFX_CAUTION);
  }

  _lbSpawnRushMidBoss(boss) {
    const bossExp  = 5 + (LAST_STAGE_IDX - 5) * 0.6;
    const midHp    = Math.round(10 * Math.pow(2, bossExp));
    this.enemies.push(new Enemy({
      x: boss.x + (Math.random() - 0.5) * 60,
      y: boss.y + boss.radius + 30,
      attribute: ALL_ATTRS[Math.floor(Math.random() * 3)],
      speed: 190 * this.speedMultiplier,
      hp: Math.max(1, Math.round(midHp * 0.8)),
      isMidBoss: true, isRushBoss: true, drawImmune: true,
    }));
  }

  _lbSpawnLineCharge() {
    const bossExp  = 5 + (LAST_STAGE_IDX - 5) * 0.6;
    const midHp    = Math.round(10 * Math.pow(2, bossExp));
    const count    = 5;
    for (let i = 0; i < count; i++) {
      const x = CANVAS_W * (i + 0.5) / count;
      this.enemies.push(new Enemy({
        x, y: SPAWN_Y,
        attribute: ALL_ATTRS[Math.floor(Math.random() * 3)],
        speed: 220 * this.speedMultiplier,
        hp: Math.max(1, Math.round(midHp * 0.25)),
        isMidBoss: true, drawImmune: true,
      }));
    }
    audio.playSfx(AUDIO.SFX_CAUTION);
  }

  _executeLbP1Skill(boss, hpRatio) {
    const milestones = Math.min(3, Math.floor((1 - hpRatio) / 0.25));
    const stageMult  = LAST_STAGE_IDX / 3 + 1;  // 4
    const speed      = Math.min(1.0 + 0.10 * LAST_STAGE_IDX, 4.5) * 60;
    const yMin = boss.y + 70;
    const yMax = Math.min(CANVAS_H * 0.55, KILL_LINE_Y - 100);

    let idx = boss.lbSkillIdx;
    // Skip rush skill (3) if HP > 75%
    if (idx === 3 && hpRatio > 0.75) { idx = 0; boss.lbSkillIdx = 0; }

    if (idx === 0) {
      const n = 20 + 4 * milestones;
      for (let i = 0; i < n; i++) {
        const x = 36 + Math.random() * (CANVAS_W - 72);
        const y = yMin + Math.random() * Math.max(yMax - yMin, 60);
        this.enemies.push(new Enemy({ x, y,
          attribute: ALL_ATTRS[Math.floor(Math.random() * 3)],
          speed: speed * 0.9 * this.speedMultiplier,
          hp: Math.max(1, Math.round(stageMult)) }));
      }
    } else if (idx === 1) {
      const n = 10 + 2 * milestones;
      for (let i = 0; i < n; i++) {
        const x = 36 + Math.random() * (CANVAS_W - 72);
        const y = yMin + Math.random() * Math.max(yMax - yMin, 60);
        this.enemies.push(new Enemy({ x, y,
          attribute: ALL_ATTRS[Math.floor(Math.random() * 3)],
          speed: speed * 0.75 * this.speedMultiplier,
          hp: Math.max(1, Math.round(stageMult * 2)),
          enemyType: ENEMY_TYPE.MEDIUM }));
      }
    } else if (idx === 2) {
      const n = 5 + milestones;
      for (let i = 0; i < n; i++) {
        const x = 36 + Math.random() * (CANVAS_W - 72);
        const y = yMin + Math.random() * Math.max(yMax - yMin, 60);
        this.enemies.push(new Enemy({ x, y,
          attribute: ALL_ATTRS[Math.floor(Math.random() * 3)],
          speed: speed * 0.6 * this.speedMultiplier,
          hp: Math.max(1, Math.round(stageMult * 5)),
          enemyType: ENEMY_TYPE.LARGE }));
      }
    } else {
      // Skill 3: charging mid-boss (HP≤75%)
      const count = hpRatio <= 0.25 ? 2 : 1;
      boss.lbRushQueue += count;
      boss.lbRushCT     = 0;  // fire first one immediately
    }
    boss.lbSkillIdx = (idx + 1) % 4;
  }

  _executeLbP2Skill(boss, hpRatio) {
    const bossExp   = 5 + (LAST_STAGE_IDX - 5) * 0.6;
    const stageMult = LAST_STAGE_IDX / 3 + 1;
    const speed     = Math.min(1.0 + 0.10 * LAST_STAGE_IDX, 4.5) * 60;
    const yMin = boss.y + 80;
    const yMax = Math.min(CANVAS_H * 0.60, KILL_LINE_Y - 100);

    const idx = boss.lbP2_skillIdx;
    boss.lbP2_skillIdx = (idx + 1) % 6;

    if (idx === 0) {
      // 超ボス召喚（8s後爆死）
      const ultraHp   = Math.round(20 * Math.pow(2, bossExp) * 9);
      const ultraCount = hpRatio <= 0.30 ? 3 : hpRatio <= 0.60 ? 2 : 1;
      for (let i = 0; i < ultraCount; i++) {
        const xOff = (i - Math.floor(ultraCount / 2)) * 100;
        const e = new Enemy({
          x: CANVAS_W / 2 + xOff, y: boss.y + boss.radius + 70,
          attribute: ALL_ATTRS[Math.floor(Math.random() * 3)],
          speed: 0, hp: ultraHp, isBoss: true, isUltraBoss: true,
        });
        e.noShield    = true;
        e.lbTempUltra = true;
        e.lbTempTimer = 8.0;
        this.enemies.push(e);
      }
      this.cautionTimer = 1.8;
      audio.playSfx(AUDIO.SFX_WARNING);

    } else if (idx === 1) {
      // 通常ボス召喚（有限HP）
      const bossHp    = Math.round(20 * Math.pow(2, bossExp));
      const bossCount = hpRatio <= 0.40 ? 2 : 1;
      for (let i = 0; i < bossCount; i++) {
        const xPos = bossCount === 1 ? CANVAS_W / 2 : CANVAS_W * (i === 0 ? 0.3 : 0.7);
        const e = new Enemy({
          x: xPos, y: boss.y + boss.radius + 60,
          attribute: ALL_ATTRS[Math.floor(Math.random() * 3)],
          speed: 0, hp: bossHp, isBoss: true,
        });
        e.noShield = true;
        e.summonTimer = 0;
        this.enemies.push(e);
      }
      audio.playSfx(AUDIO.SFX_CAUTION);

    } else if (idx === 2) {
      // ボタンシャッフル
      const order = [0, 1, 2];
      for (let i = 2; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [order[i], order[j]] = [order[j], order[i]];
      }
      this.buttonOrder = order;
      audio.playSfx(AUDIO.SFX_POWERUP);

    } else if (idx === 3) {
      // 誘爆&あいこ無効雑魚（HP≤40%で中型化）
      const heavy = hpRatio <= 0.40;
      const count = 12;
      const etype = heavy ? ENEMY_TYPE.MEDIUM : ENEMY_TYPE.NORMAL;
      const hp    = Math.max(1, Math.round(stageMult * (heavy ? 2 : 1)));
      for (let i = 0; i < count; i++) {
        const x = 36 + Math.random() * (CANVAS_W - 72);
        const y = yMin + Math.random() * Math.max(yMax - yMin, 60);
        this.enemies.push(new Enemy({ x, y,
          attribute: ALL_ATTRS[Math.floor(Math.random() * 3)],
          speed: (heavy ? 38 : 52) * this.speedMultiplier,
          hp, enemyType: etype, drawImmune: true, chainImmune: true }));
      }

    } else if (idx === 4) {
      // 大型ダミー敵（4体）
      const midHp = Math.round(10 * Math.pow(2, bossExp));
      const count = 4;
      for (let i = 0; i < count; i++) {
        const x = 36 + Math.random() * (CANVAS_W - 72);
        const y = yMin + Math.random() * Math.max(yMax - yMin, 60);
        this.enemies.push(new Enemy({ x, y,
          attribute: ALL_ATTRS[Math.floor(Math.random() * 3)],
          speed: 45 * this.speedMultiplier,
          hp: Math.max(1, Math.round(midHp * 0.15)),
          enemyType: ENEMY_TYPE.LARGE, isDummy: true }));
      }

    } else {
      // 変速軌道雑魚（HP≤40%で中型化）
      const heavy = hpRatio <= 0.40;
      const count = 12;
      const etype = heavy ? ENEMY_TYPE.MEDIUM : ENEMY_TYPE.NORMAL;
      const hp    = Math.max(1, Math.round(stageMult * (heavy ? 2 : 1)));
      for (let i = 0; i < count; i++) {
        const x = 36 + Math.random() * (CANVAS_W - 72);
        const y = yMin + Math.random() * Math.max(yMax - yMin, 60);
        this.enemies.push(new Enemy({ x, y,
          attribute: ALL_ATTRS[Math.floor(Math.random() * 3)],
          speed: (heavy ? 42 : 58) * this.speedMultiplier,
          hp, enemyType: etype, isErratic: true }));
      }
    }
  }

  // ── Ultra boss skill helpers ─────────────────────────────────────────────

  _spawnUltraInitBosses(boss) {
    // Two normal bosses without shield, flanking slightly below the ultra boss
    const normalBossHp = Math.round(20 * Math.pow(2, this.stageIndex));
    const spawnY = boss.y + boss.radius + 50; // just in front of the ultra boss
    const positions = [CANVAS_W * 0.22, CANVAS_W * 0.78];
    for (const bx of positions) {
      const e = new Enemy({
        x: bx, y: spawnY,
        attribute: ALL_ATTRS[Math.floor(Math.random() * 3)],
        speed: 0,
        hp: normalBossHp,
        isBoss: true,
        isGrandBoss: false,
      });
      e.bossShieldPhase = 0;   // no damage shield
      e.noShield        = true; // prevent cycling
      e.summonTimer     = 0;
      this.enemies.push(e);
    }
    this.cautionTimer = 1.8;
    audio.playSfx(AUDIO.SFX_CAUTION);
  }

  _executeUltraPhaseSkill(boss, hpRatio) {
    const stageIdx  = this.stageIndex;
    const stageMult = stageIdx / 3 + 1;

    // HP 消費 25% ごとに段階が上がる（最大 3 段階）
    const milestones = Math.min(3, Math.floor((1.0 - hpRatio) / 0.25));

    const yMin = boss.y + 60;
    const yMax = Math.min(CANVAS_H * 0.60, KILL_LINE_Y - 100);

    if (boss.ultraPhaseSkillIdx === 0) {
      // ── Skill A: 中ボス召喚 — 1体 + 25%減ごとに+1体 ────────────────────
      const midBossCount = 1 + milestones;
      const normalMidBossHp = Math.round(10 * Math.pow(2, stageIdx));
      const midBossSpeed    = Math.min(1.0 + 0.10 * stageIdx, 4.5) * 60 / 3;
      for (let i = 0; i < midBossCount; i++) {
        const x = 36 + Math.random() * (CANVAS_W - 72);
        const y = yMin + Math.random() * Math.max(yMax - yMin, 60);
        this.enemies.push(new Enemy({
          x, y,
          attribute: ALL_ATTRS[Math.floor(Math.random() * 3)],
          speed: midBossSpeed * this.speedMultiplier,
          hp: normalMidBossHp,
          isMidBoss: true,
        }));
      }
    } else {
      // ── Skill B: あいこ無効中型雑魚 — 5体 + 25%減ごとに+2体 ────────────
      const drawImmuneCount = 5 + 2 * milestones;
      for (let i = 0; i < drawImmuneCount; i++) {
        const x = 36 + Math.random() * (CANVAS_W - 72);
        const y = yMin + Math.random() * Math.max(yMax - yMin, 60);
        this.enemies.push(new Enemy({
          x, y,
          attribute: ALL_ATTRS[Math.floor(Math.random() * 3)],
          speed: 42 * this.speedMultiplier,
          hp: Math.max(2, Math.round(stageMult * 2)),
          enemyType: ENEMY_TYPE.MEDIUM,
          drawImmune: true,
        }));
      }
    }

    // A→B→A→B と交互に切り替え
    boss.ultraPhaseSkillIdx = 1 - boss.ultraPhaseSkillIdx;
  }

  _startUltraRushCharge(boss) {
    boss.ultraCharging     = true;
    boss.ultraChargeTimer  = ULTRA_CHARGE_DURATION;
    boss.ultraChargeDamage = 0;
    audio.playSfx(AUDIO.SFX_ULTRA_CHARGE);
  }

  _spawnUltraRushBoss(boss) {
    const stageIdx        = this.stageIndex;
    const normalMidBossHp = Math.round(10 * Math.pow(2, stageIdx));
    const rushHp          = Math.max(1, normalMidBossHp * 3 - boss.ultraChargeDamage);
    this.enemies.push(new Enemy({
      x: boss.x,
      y: boss.y + boss.radius + 30,
      attribute: boss.attribute,
      speed: 160 * this.speedMultiplier,
      hp: rushHp,
      isMidBoss: true,
      isRushBoss: true,
      drawImmune: true,
    }));
  }

  _executeGrandBossSkill(boss, phase) {
    const stageIdx  = this.stageIndex;
    const stageMult = stageIdx / 3 + 1;
    // Spawn in upper half of screen (between boss and screen midpoint)
    const yMin = boss.y + 60;
    const yMax = CANVAS_H / 2;  // screen midpoint ≈ 380px

    const spawnInField = (ctor) => {
      const x = 36 + Math.random() * (CANVAS_W - 72);
      const y = yMin + Math.random() * Math.max(yMax - yMin, 60);
      ctor(x, y);
    };

    if (phase === 0) {
      // A: 15-20 normal enemies of one random attribute, decent HP so they survive chain hits
      const count = Math.min(15 + stageIdx, 20);
      const attr  = ALL_ATTRS[Math.floor(Math.random() * 3)];
      for (let i = 0; i < count; i++) {
        spawnInField((x, y) => this.enemies.push(new Enemy({
          x, y, attribute: attr, speed: 45 * this.speedMultiplier,
          hp: Math.max(3, Math.round(stageMult * 3)),
          enemyType: ENEMY_TYPE.NORMAL,
        })));
      }
    } else if (phase === 1) {
      // B: 7-8 mixed-attribute medium enemies
      const count = Math.min(7 + Math.floor(stageIdx / 2), 8);
      for (let i = 0; i < count; i++) {
        const attr = ALL_ATTRS[Math.floor(Math.random() * 3)];
        spawnInField((x, y) => this.enemies.push(new Enemy({
          x, y, attribute: attr, speed: 38 * this.speedMultiplier,
          hp: Math.max(4, Math.round(stageMult * 4)),
          enemyType: ENEMY_TYPE.MEDIUM,
        })));
      }
    } else {
      // C: 2-3 large draw-immune enemies
      const count = stageIdx >= 3 ? 3 : 2;
      for (let i = 0; i < count; i++) {
        const attr = ALL_ATTRS[i % 3];
        spawnInField((x, y) => this.enemies.push(new Enemy({
          x, y, attribute: attr, speed: 28 * this.speedMultiplier,
          hp: Math.max(8, Math.round(stageMult * 8)),
          enemyType: ENEMY_TYPE.LARGE,
          drawImmune: true,
        })));
      }
    }
  }

  _spawnBossMinion(boss) {
    const attr = ALL_ATTRS[Math.floor(Math.random() * 3)];
    const x    = 36 + Math.random() * (CANVAS_W - 72);
    const yMin = boss.y + 50;
    const yMax = Math.min(boss.y + 180, KILL_LINE_Y - 40);
    if (yMin >= yMax) return;
    const y = yMin + Math.random() * (yMax - yMin);

    let drawImmune = false;
    let enemyType  = ENEMY_TYPE.NORMAL;
    if (this.difficulty === DIFFICULTY.HARD && Math.random() < 0.20) {
      drawImmune = true;
    } else if (this.difficulty === DIFFICULTY.MERCILESS && Math.random() < 0.20) {
      drawImmune = true;
      enemyType  = ENEMY_TYPE.MEDIUM;
    }

    const typeHpMult = enemyType === ENEMY_TYPE.MEDIUM ? 2 : 1;
    const stageMult  = this.stageIndex / 3 + 1;

    this.enemies.push(new Enemy({
      x, y,
      attribute: attr,
      speed: 30 * this.speedMultiplier,
      hp: Math.max(1, Math.round(stageMult * typeHpMult)),
      isBoss: false,
      enemyType,
      drawImmune,
    }));
  }

  // ── Private: judgment & scoring ──────────────────────────────────────────

  _handleJudgment(result, bullet, enemy) {
    const power        = this._getAttackPower(bullet.attribute);
    const bypassAbsorb = bullet.isPierce || bullet.isSplit;

    // Dummy enemies always absorb bullets (always take WIN damage)
    if (enemy.isDummy) {
      this._applyDamage(enemy, Math.max(1, Math.round(2 * power)), bullet.attribute, true);
      return;
    }

    if (bullet.isPierce) {
      // Speed level also boosts pierce damage (+60% per level, same as attack power)
      const speedLv   = this.skills[`${ATTR.ROCK}_com_speed`] || 0;
      const piercePow = power * (1 + 0.6 * speedLv);
      this._applyDamage(enemy, Math.max(1, Math.round(2 * piercePow)), bullet.attribute, true);
    } else if (result === 'WIN') {
      this._applyDamage(enemy, Math.max(1, Math.round(2 * power)), bullet.attribute, bypassAbsorb);
      if (bullet.isSplit && !bullet.isFragment) this._spawnSplitFragments(bullet, enemy);
    } else if (result === 'DRAW') {
      // bossShieldPhase 2 = draw-immune (grand boss only, not ultra boss)
      const drawImmune = enemy.drawImmune ||
        (enemy.isBoss && !enemy.isUltraBoss && !enemy.noShield && enemy.bossShieldPhase === 2);
      if (drawImmune) {
        this._spawnHitParticles(enemy.x, enemy.y, '#888888', 5);
      } else {
        this._applyDamage(enemy, Math.max(1, Math.round(1 * power)), bullet.attribute, bypassAbsorb);
        if (bullet.isSplit && !bullet.isFragment) this._spawnSplitFragments(bullet, enemy);
      }
    } else {
      this._spawnHitParticles(enemy.x, enemy.y, '#FF4444', 5);
    }
  }

  _applyDamage(enemy, dmg, attackAttr, bypassAbsorb = false) {
    // Last boss special handling
    if (enemy.isLastBoss) {
      if (enemy.lbFinalPhase) return; // invincible in final phase
      if (enemy.lbTempUltra)  return; // shouldn't happen, but guard

      if (enemy.lastBossPhase === 1 && enemy.lbAbsorbActive && !bypassAbsorb) {
        // Absorb barrier active: heals instead of taking damage
        const mult = (enemy.hp / enemy.maxHp <= 0.5) ? 2.0 : 1.0;
        enemy.hp = Math.min(enemy.maxHp, enemy.hp + Math.ceil(dmg * mult));
        this._spawnHitParticles(enemy.x, enemy.y, '#00FF88', 7);
        return;
      }
      // Apply damage (pierce/split bypass in p1, or p2)
      enemy.hp -= dmg;
      if (enemy.hp <= 0) {
        if (enemy.lastBossPhase === 1) {
          enemy.hp = 1;
          this._lastBossPhase2Transition(enemy);
        } else {
          enemy.hp = 1;
          this._lastBossFinalPhase(enemy);
        }
        return;
      }
      // Phase 2: 5% check
      if (enemy.lastBossPhase === 2 && !enemy.lbFinalPhase && enemy.hp <= enemy.maxHp * 0.05) {
        this._lastBossFinalPhase(enemy);
        return;
      }
      this._spawnHitParticles(enemy.x, enemy.y, attackAttr ? ATTR_COLOR[attackAttr] : '#FFFFFF', 5);
      return;
    }

    // Temp ultra boss (summoned by last boss P2): infinite HP
    if (enemy.lbTempUltra) {
      this._spawnHitParticles(enemy.x, enemy.y, '#00FF00', 4);
      return;
    }

    if (enemy.isUltraBoss) {
      // Charging: accumulate damage into the rush-boss pre-damage pool
      if (enemy.ultraCharging) {
        enemy.ultraChargeDamage += dmg;
        this._spawnHitParticles(enemy.x, enemy.y, '#FF8800', 5);
        return;
      }
      // Absorption barrier: heal boss instead (pierce/split/laser bypass this)
      if (enemy.ultraAbsorbActive && !bypassAbsorb) {
        enemy.hp = Math.min(enemy.maxHp, enemy.hp + Math.ceil(dmg * 0.5));
        this._spawnHitParticles(enemy.x, enemy.y, '#00FF88', 7);
        return;
      }
      // Otherwise fall through to normal damage (ultra boss has no GUARD shield)
    } else {
      // Normal / Grand boss GUARD shield (not for noShield spawns)
      if (enemy.isBoss && !enemy.noShield && enemy.bossShieldPhase === 1) {
        this._spawnHitParticles(enemy.x, enemy.y, '#00AAFF', 6);
        return;
      }
    }

    enemy.hp -= dmg;
    if (enemy.hp <= 0) {
      this._destroyEnemy(enemy, attackAttr);
    } else {
      this._spawnHitParticles(enemy.x, enemy.y, attackAttr ? ATTR_COLOR[attackAttr] : '#FFFFFF', 5);
    }
  }

  _spawnSplitFragments(sourceBullet, hitEnemy) {
    const alive = this.enemies.filter(e => e.alive && !e.exploding && e !== hitEnemy);
    if (alive.length === 0) return;
    alive.sort((a, b) =>
      Math.hypot(a.x - hitEnemy.x, a.y - hitEnemy.y) -
      Math.hypot(b.x - hitEnemy.x, b.y - hitEnemy.y)
    );
    for (const t of alive.slice(0, 2)) {
      const frag = new Bullet({
        x: hitEnemy.x, y: hitEnemy.y,
        attribute: sourceBullet.attribute,
        target: t,
        speedMult: sourceBullet._speedMult,
      });
      frag.isFragment = true;
      this.bullets.push(frag);
    }
  }

  _destroyEnemy(enemy, attackAttr) {
    enemy.triggerExplosion();
    this._spawnExplosionParticles(enemy.x, enemy.y, ATTR_COLOR[enemy.attribute]);

    if (enemy.isBoss) {
      audio.playSfx(AUDIO.SFX_BOSS_KILL);

      // Clear all remaining enemies — skip for noShield init-bosses so they
      // don't accidentally wipe the ultra boss that summoned them
      if (!enemy.noShield) {
        for (const e of this.enemies) {
          if (e !== enemy && e.alive && !e.exploding) {
            e.triggerExplosion();
            this._spawnExplosionParticles(e.x, e.y, ATTR_COLOR[e.attribute]);
          }
        }
      }

      // Spectacular particle burst
      const burstColors = ['#FFD700', '#FF4500', '#2ECC71', '#3498DB', '#E74C3C', '#FFFFFF', '#E67E22'];
      const burstCount  = enemy.isUltraBoss ? 45 : enemy.isGrandBoss ? 28 : 18;
      for (const color of burstColors) {
        for (let i = 0; i < burstCount; i++) {
          const angle = Math.random() * Math.PI * 2;
          const speed = 180 + Math.random() * (enemy.isUltraBoss ? 550 : 400);
          this.particles.push(new Particle({
            x: enemy.x, y: enemy.y, color,
            radius: 7 + Math.random() * (enemy.isUltraBoss ? 18 : 12),
            vx: Math.cos(angle) * speed,
            vy: Math.sin(angle) * speed - 120,
            life: 0.7 + Math.random() * (enemy.isUltraBoss ? 1.0 : 0.7),
          }));
        }
      }

      // Expanding ring shockwaves
      if (enemy.isUltraBoss) {
        this.bossDeathRings = [
          { x: enemy.x, y: enemy.y, maxRadius: 400, life: 1.6, maxLife: 1.6, color: '#FF0000' },
          { x: enemy.x, y: enemy.y, maxRadius: 320, life: 1.3, maxLife: 1.3, color: '#FF8800' },
          { x: enemy.x, y: enemy.y, maxRadius: 260, life: 1.1, maxLife: 1.1, color: '#FFD700' },
          { x: enemy.x, y: enemy.y, maxRadius: 200, life: 0.9, maxLife: 0.9, color: '#FFFFFF' },
          { x: enemy.x, y: enemy.y, maxRadius: 150, life: 0.7, maxLife: 0.7, color: '#CC0000' },
        ];
      } else {
        this.bossDeathRings = [
          { x: enemy.x, y: enemy.y, maxRadius: 280, life: 1.0, maxLife: 1.0, color: '#FFD700' },
          { x: enemy.x, y: enemy.y, maxRadius: 200, life: 0.8, maxLife: 0.8, color: '#FFFFFF' },
          { x: enemy.x, y: enemy.y, maxRadius: 160, life: 0.6, maxLife: 0.6, color: '#FF4500' },
        ];
        if (enemy.isGrandBoss) {
          this.bossDeathRings.push(
            { x: enemy.x, y: enemy.y, maxRadius: 350, life: 1.2, maxLife: 1.2, color: '#CC00FF' }
          );
        }
      }

      this.bossDeathFlash = enemy.isUltraBoss ? 1.4 : 1.0;
    } else if (enemy.isMidBoss) {
      audio.playSfx(AUDIO.SFX_BOSS_KILL);
      if (Math.random() < 0.5) this._spawnDropItem(enemy.x, enemy.y + 20);  // 中ボス：50%

      // Mid-boss death burst — orange/gold, no enemy clear
      const midColors = ['#FF8C00', '#FFD700', '#FF4500', '#FFFFFF'];
      for (const color of midColors) {
        for (let i = 0; i < 12; i++) {
          const angle = Math.random() * Math.PI * 2;
          const speed = 150 + Math.random() * 320;
          this.particles.push(new Particle({
            x: enemy.x, y: enemy.y, color,
            radius: 5 + Math.random() * 9,
            vx: Math.cos(angle) * speed,
            vy: Math.sin(angle) * speed - 100,
            life: 0.5 + Math.random() * 0.6,
          }));
        }
      }

      this.bossDeathRings = [
        { x: enemy.x, y: enemy.y, maxRadius: 220, life: 0.9, maxLife: 0.9, color: '#FF8C00' },
        { x: enemy.x, y: enemy.y, maxRadius: 160, life: 0.7, maxLife: 0.7, color: '#FFD700' },
      ];
      this.bossDeathFlash = 0.65;
    } else {
      audio.playSfx(AUDIO.SFX_DESTROY);
    }

    // ── 誘爆: 倒した敵のradius×1.5範囲内にいる同ティア以下の全敵を即死 ──────
    // Chain explosion logic is preserved in core.js / constants.js for future reuse.
    // ティア: NORMAL(0) < MEDIUM(1) < LARGE(2) < 中ボス(3) < 通常ボス(4) < 大ボス(5) < 超大ボス(6)
    const blastR    = enemy.radius * 1.5;
    const srcTier   = this._blastTier(enemy);
    for (const t of this.enemies) {
      if (t === enemy || !t.alive || t.exploding) continue;
      if (t.chainImmune) continue;
      if (this._blastTier(t) > srcTier) continue; // 自分より強い敵は安全
      const dx = t.x - enemy.x;
      const dy = t.y - enemy.y;
      if (Math.sqrt(dx * dx + dy * dy) <= blastR) {
        this._destroyEnemy(t);
      }
    }

    // 大型雑魚：5% でドロップ（ボス系は別処理済み）
    if (!enemy.isBoss && !enemy.isMidBoss && enemy.enemyType === ENEMY_TYPE.LARGE && Math.random() < 0.05) {
      this._spawnDropItem(enemy.x, enemy.y);
    }

    let pts = Math.round(100 * this.effectiveScoreMult);
    if (enemy.isLastBoss)      pts = Math.round(pts * (enemy.lastBossPhase === 2 ? 100 : 50));
    else if (enemy.isBoss)     pts = Math.round(pts * (enemy.isUltraBoss ? 10 : enemy.isGrandBoss ? 5 : 2));
    else if (enemy.isRushBoss) pts = Math.round(pts * 9);  // 3× mid-boss score
    else if (enemy.isMidBoss)  pts = Math.round(pts * 3);
    this.score += pts;
  }

  _onEnemyEscaped(enemy) {
    if (enemy.isDummy) return; // ダミー敵は素通りしてもペナルティなし
    const stageMult = this.stageIndex / 3 + 1;
    const diffMult  = DIFFICULTY_CONFIG[this.difficulty].damageMult;
    const typeMult  = enemy.isBoss    ? 3
      : enemy.isRushBoss ? 45  // 3× mid-boss (highly punishing — don't let the rush boss through)
      : enemy.isMidBoss  ? 15
      : enemy.enemyType === ENEMY_TYPE.LARGE  ? 5
      : enemy.enemyType === ENEMY_TYPE.MEDIUM ? 3
      : 1;
    const penalty   = Math.round(BASE_HIT_PENALTY * stageMult * diffMult * typeMult);

    if (!enemy.isBoss) {
      // Already invincible — block for free
      if (this.shieldInvincTimer > 0) {
        this.damageFlash = 0.2;
        return;
      }
      // Shield ready (charges exist and not on CT) — activate invincibility
      if (this.shieldCharges > 0 && this.shieldCTTimer <= 0) {
        // Lv1=1.0s, Lv2=1.2s, Lv3=1.4s …
        this.shieldInvincTimer = 0.8 + 0.2 * this.shieldCharges;
        this.damageFlash = 0.3;
        return;
      }
    }

    this.score      -= penalty;
    this.damageFlash = 0.45;
    if (this.score <= 0) {
      this.score = 0;
      this.state = GameState.GAME_OVER;
    }
  }

  _checkGameClear() {
    const cfg       = DIFFICULTY_CONFIG[this.difficulty];
    const completed = this.stageIndex + 1;
    if (completed < cfg.maxStage) return false;
    this.state = GameState.GAME_CLEAR;
    return true;
  }

  _onWaveCleared() {
    // 画面上の残存アイテムを強制収集
    for (const item of this.items) { if (item.alive) this._collectItem(item); }
    this.items = [];
    this.buttonOrder = [0, 1, 2]; // ボタンシャッフルをリセット

    const nextWave    = this.waveIndex + 1;
    const isLastWave  = nextWave >= this.stageConfig.waveCount;

    // ラストステージの最終Waveクリア → スキルショップをスキップして即クリア画面へ
    if (isLastWave && this._checkGameClear()) return;

    // All 3 waves get a skill select; after wave 3 the shop leads to next stage
    this._generateSkillOffer();
    this.state = GameState.WAVE_RESULT;
    this._nextWaveIdx = isLastWave ? -1 : nextWave;
  }

  // ── Private: laser hit test ──────────────────────────────────────────────

  // 誘爆強さ階層: NORMAL(0) < MEDIUM(1) < LARGE(2) < 中ボス(3) < 通常ボス(4) < 大ボス(5) < 超大ボス(6) < ラストボス(7)
  _blastTier(enemy) {
    if (enemy.isLastBoss)                           return 7;
    if (enemy.isUltraBoss)                          return 6;
    if (enemy.isGrandBoss)                          return 5;
    if (enemy.isBoss)                               return 4;
    if (enemy.isMidBoss)                            return 3;
    if (enemy.enemyType === ENEMY_TYPE.LARGE)       return 2;
    if (enemy.enemyType === ENEMY_TYPE.MEDIUM)      return 1;
    return 0;
  }

  _laserHitsEnemy(laser, enemy) {
    const rx = enemy.x - laser.x;
    const ry = enemy.y - laser.y;
    const t  = rx * laser.dx + ry * laser.dy;
    if (t < 0) return false;
    const perpDist = Math.abs(rx * laser.dy - ry * laser.dx);
    return perpDist <= enemy.radius;
  }

  // ── Private: particles ───────────────────────────────────────────────────

  _spawnHitParticles(x, y, color, count) {
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 80 + Math.random() * 140;
      this.particles.push(new Particle({
        x, y, color,
        radius: 3 + Math.random() * 4,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 60,
        life: 0.25 + Math.random() * 0.2,
      }));
    }
  }

  _spawnExplosionParticles(x, y, color) {
    for (let i = 0; i < 14; i++) {
      const angle = (i / 14) * Math.PI * 2 + Math.random() * 0.3;
      const speed = 100 + Math.random() * 220;
      this.particles.push(new Particle({
        x, y, color,
        radius: 5 + Math.random() * 7,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 80,
        life: 0.35 + Math.random() * 0.3,
      }));
    }
  }
}
