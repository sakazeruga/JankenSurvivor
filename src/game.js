import { judge, chainExplosion } from './core.js';
import { Enemy, Bullet, Laser, Particle } from './entities.js';
import { generateStage } from './stage.js';
import {
  ATTR, ALL_ATTRS, ATTR_COLOR, CHAIN_RADIUS, CHAIN_MAX_DEPTH,
  KILL_LINE_Y, CANVAS_W, CANVAS_H,
  DIFFICULTY, DIFFICULTY_CONFIG,
  INITIAL_SCORE, BASE_HIT_PENALTY, BOMBS_PER_STAGE,
  ATTR_COMMON_SKILLS, ATTR_RARE_SKILLS,
  UTIL_COMMON_SKILLS, UTIL_RARE_SKILLS,
  ENEMY_TYPE,
  AUDIO,
} from './constants.js';
import { audio } from './audio.js';

const BOSS_ATTR_PERIOD        = 4.0;   // seconds between boss attribute changes
const BOSS_SUMMON_PERIOD      = 1.17;  // seconds between normal-boss minion spawns
const GRAND_BOSS_SKILL_PERIOD = 3.5;   // seconds between grand-boss skill uses

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

  startNextCycle() {
    if (this.state !== GameState.GAME_CLEAR || !this.canContinue) return;
    audio.playSfx(AUDIO.SFX_START);
    this.state = GameState.PLAYING;
    this._loadStage(this.stageIndex + 1);
  }

  goToTitle() {
    this._reset();
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
    return BOMBS_PER_STAGE + (this.skills['util_bomb'] || 0);
  }

  get bombsRemaining() {
    return this._maxBombs() - this.bombsUsed;
  }

  get effectiveScoreMult() {
    return this.scoreMultiplier * Math.pow(1.1, this.skills['util_score'] || 0);
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
    this.clearCycles       = 0;
    this.canContinue       = false;
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
    this.cautionTimer      = 0;
    this.shieldInvincTimer = 0;
    this.shieldCTTimer     = 0;
    this.bossDeathRings    = [];
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
        if (def.isGrandBoss) {
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

    // Laser ↔ Enemy collision
    for (const laser of this.lasers) {
      if (!laser.alive) continue;
      for (const enemy of this.enemies) {
        if (!enemy.alive || enemy.exploding) continue;
        if (laser.hitSet.has(enemy)) continue;
        if (this._laserHitsEnemy(laser, enemy)) {
          laser.hitSet.add(enemy);
          this._applyDamage(enemy, laser.damage, null);
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

      boss.attrCycleTimer += dt;
      if (boss.attrCycleTimer >= BOSS_ATTR_PERIOD) {
        boss.attrCycleTimer = 0;
        const others = ALL_ATTRS.filter(a => a !== boss.attribute);
        boss.attribute = others[Math.floor(Math.random() * others.length)];
        this._spawnHitParticles(boss.x, boss.y, '#FFFFFF', 10);
      }

      // Shield phase timer (both boss types)
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
    const power = this._getAttackPower(bullet.attribute);

    if (bullet.isPierce) {
      // Speed level also boosts pierce damage (+60% per level, same as attack power)
      const speedLv    = this.skills[`${ATTR.ROCK}_com_speed`] || 0;
      const piercePow  = power * (1 + 0.6 * speedLv);
      this._applyDamage(enemy, Math.max(1, Math.round(2 * piercePow)), bullet.attribute);
    } else if (result === 'WIN') {
      this._applyDamage(enemy, Math.max(1, Math.round(2 * power)), bullet.attribute);
      if (bullet.isSplit && !bullet.isFragment) this._spawnSplitFragments(bullet, enemy);
    } else if (result === 'DRAW') {
      const drawImmune = enemy.drawImmune || (enemy.isBoss && enemy.bossShieldPhase === 2);
      if (drawImmune) {
        this._spawnHitParticles(enemy.x, enemy.y, '#888888', 5);
      } else {
        this._applyDamage(enemy, Math.max(1, Math.round(1 * power)), bullet.attribute);
        if (bullet.isSplit && !bullet.isFragment) this._spawnSplitFragments(bullet, enemy);
      }
    } else {
      this._spawnHitParticles(enemy.x, enemy.y, '#FF4444', 5);
    }
  }

  _applyDamage(enemy, dmg, attackAttr) {
    // Damage shield: block all damage
    if (enemy.isBoss && enemy.bossShieldPhase === 1) {
      this._spawnHitParticles(enemy.x, enemy.y, '#00AAFF', 6);
      return;
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

      // Clear all remaining enemies
      for (const e of this.enemies) {
        if (e !== enemy && e.alive && !e.exploding) {
          e.triggerExplosion();
          this._spawnExplosionParticles(e.x, e.y, ATTR_COLOR[e.attribute]);
        }
      }

      // Spectacular particle burst
      const burstColors = ['#FFD700', '#FF4500', '#2ECC71', '#3498DB', '#E74C3C', '#FFFFFF', '#E67E22'];
      const burstCount  = enemy.isGrandBoss ? 28 : 18;
      for (const color of burstColors) {
        for (let i = 0; i < burstCount; i++) {
          const angle = Math.random() * Math.PI * 2;
          const speed = 180 + Math.random() * 400;
          this.particles.push(new Particle({
            x: enemy.x, y: enemy.y, color,
            radius: 7 + Math.random() * 12,
            vx: Math.cos(angle) * speed,
            vy: Math.sin(angle) * speed - 120,
            life: 0.7 + Math.random() * 0.7,
          }));
        }
      }

      // Expanding ring shockwaves (grand boss gets extra ring)
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

      this.bossDeathFlash = 1.0;
    } else if (enemy.isMidBoss) {
      audio.playSfx(AUDIO.SFX_BOSS_KILL);

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

    // Mid-boss neither triggers chain nor can be chain-targeted
    const chainTargets = this.enemies.filter(e => !e.isMidBoss);
    const chained = (enemy.isBoss || enemy.isMidBoss) ? [] : chainExplosion(enemy, chainTargets, CHAIN_RADIUS, CHAIN_MAX_DEPTH);
    for (const c of chained) {
      c.triggerExplosion();
      this._spawnExplosionParticles(c.x, c.y, ATTR_COLOR[c.attribute]);
    }

    const multiplier = 1 + 0.5 * chained.length;
    let pts = Math.round(100 * multiplier * this.effectiveScoreMult);
    if (enemy.isBoss)    pts = Math.round(pts * (enemy.isGrandBoss ? 5 : 2));
    else if (enemy.isMidBoss) pts = Math.round(pts * 3);
    this.score += pts;
  }

  _onEnemyEscaped(enemy) {
    const stageMult = this.stageIndex / 3 + 1;
    const diffMult  = DIFFICULTY_CONFIG[this.difficulty].damageMult;
    const typeMult  = enemy.isBoss ? 3
      : enemy.isMidBoss ? 15
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
    const completed = this.stageIndex + 1; // 1-indexed completed stage count
    const isMilestone = cfg.clearEvery && completed % cfg.clearEvery === 0;
    const isMaxStage  = cfg.maxStage !== null && completed >= cfg.maxStage;
    if (!isMilestone && !isMaxStage) return false;

    const canContinue = !!cfg.clearEvery && (cfg.maxStage === null || completed < cfg.maxStage);
    this.clearCycles++;
    this.canContinue = canContinue;
    this.state = GameState.GAME_CLEAR;
    return true;
  }

  _onWaveCleared() {
    // All 3 waves get a skill select; after wave 3 the shop leads to next stage
    this._generateSkillOffer();
    this.state = GameState.WAVE_RESULT;
    const nextWave = this.waveIndex + 1;
    this._nextWaveIdx = nextWave < this.stageConfig.waveCount ? nextWave : -1;
  }

  // ── Private: laser hit test ──────────────────────────────────────────────

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
