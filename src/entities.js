import { ENEMY_RADIUS, BOSS_RADIUS, GRAND_BOSS_RADIUS, MID_BOSS_RADIUS, ULTRA_BOSS_RADIUS, LAST_BOSS_RADIUS, LAST_BOSS_P2_RADIUS, BULLET_RADIUS, CANVAS_W, ENEMY_TYPE_CONFIG } from './constants.js';

export class Enemy {
  constructor({ x, y, attribute, speed, hp = 1, isBoss = false, isGrandBoss = false, isMidBoss = false, isUltraBoss = false, isRushBoss = false, isLastBoss = false, enemyType = 'NORMAL', drawImmune = false, chainImmune = false, isDummy = false, isErratic = false }) {
    this.x           = x;
    this.y           = y;
    this.attribute   = attribute;
    this.speed       = speed;
    this.hp          = hp;
    this.maxHp       = hp;
    this.isBoss      = isBoss;
    this.isGrandBoss = isGrandBoss;
    this.isMidBoss   = isMidBoss;
    this.isUltraBoss = isUltraBoss;
    this.isRushBoss   = isRushBoss;
    this.isLastBoss   = isLastBoss;
    this.enemyType    = enemyType;
    this.drawImmune   = drawImmune;
    this.chainImmune  = chainImmune;
    this.isDummy      = isDummy;
    this.isErratic    = isErratic;
    this.erraticPhase = isErratic ? Math.random() * Math.PI * 2 : 0;
    this.erraticTimer = 0;
    this.lbTempUltra  = false;
    this.lbTempTimer  = 0;
    this.noShield     = false;  // when true, shield phase never cycles

    if (isBoss) {
      if (isUltraBoss) {
        // ── Ultra boss ────────────────────────────────────────────────────
        this.radius          = ULTRA_BOSS_RADIUS;
        this.attrCycleTimer  = 0;
        this.bossShieldPhase = 0;    // no normal shield
        this.bossShieldTimer = null;
        // Ultra-specific state
        this.ultraInitDone       = false;
        this.ultraMinionTimer    = 0;
        this.ultraPhaseTimer     = 10.0;  // first phase skill at 10 s
        this.ultraPhaseSkillIdx  = 0;     // 0=中ボス召喚, 1=あいこ無効中型雑魚（交互発動）
        this.ultraRushTimer      = 14.0;  // first rush attack at 14 s
        this.ultraAbsorbActive   = false;
        this.ultraAbsorbTimer    = 0;
        this.ultraAbsorbCooldown = 10.0;  // first absorb fires 10 s after HP <= 50%
        this.ultraCharging       = false;
        this.ultraChargeTimer    = 0;
        this.ultraChargeDamage   = 0;
      } else if (isLastBoss) {
        // ── Last boss ─────────────────────────────────────────────────────
        this.radius        = LAST_BOSS_RADIUS;
        this.attrCycleTimer= 0;
        this.lastBossPhase = 1;
        // Phase 1 state
        this.lbP1_90done   = false;
        this.lbP1_40done   = false;
        this.lbMinionTimer = 0;
        this.lbSkillTimer  = 12.0;
        this.lbSkillIdx    = 0;
        this.lbRushQueue   = 0;
        this.lbRushCT      = 0;
        // Absorb barrier (Phase 1): ~30% uptime (3s on / 7s off)
        this.lbAbsorbActive   = false;
        this.lbAbsorbTimer    = 0;
        this.lbAbsorbCooldown = 5.0;  // first activation 5s after spawn
        // Phase 2 state (initialized on transition)
        this.lbP2_th         = null;
        this.lbP2_lineQueue  = 0;
        this.lbP2_lineCT     = 0;
        this.lbP2_skillTimer = 0;
        this.lbP2_skillIdx   = 0;
        // Final phase
        this.lbFinalPhase       = false;
        this.lbFinalTimer       = 0;
        this.lbFinalSkillTimer  = 0;
        this.lbFinalMinionTimer = 0;
      } else {
        // ── Grand boss / Normal boss ──────────────────────────────────────
        this.radius           = isGrandBoss ? GRAND_BOSS_RADIUS : BOSS_RADIUS;
        this.attrCycleTimer   = 0;
        // Shield phases: 0=none, 1=damage shield, 2=draw-immune (grand boss only)
        this.bossShieldPhase  = 1;    // start shielded
        this.bossShieldTimer  = null; // null = needs initialization in game.js
        if (isGrandBoss) {
          this.skillTimer = 0;
          this.skillPhase = 0;  // 0=A 1=B 2=C
        } else {
          this.summonTimer = 0;
        }
      }
    } else if (isMidBoss) {
      this.radius = MID_BOSS_RADIUS;
    } else {
      const cfg   = ENEMY_TYPE_CONFIG[enemyType] || ENEMY_TYPE_CONFIG.NORMAL;
      this.radius = Math.round(ENEMY_RADIUS * cfg.radiusScale);
    }

    this.alive        = true;
    this.exploding    = false;
    this.explodeTimer = 0;
    this.scale        = 1.0;
    this.alpha        = 1.0;
  }

  update(dt) {
    if (this.exploding) {
      this.explodeTimer += dt;
      this.scale = 1.0 + this.explodeTimer * 4;
      this.alpha = Math.max(0, 1.0 - this.explodeTimer * 2.5);
      if (this.explodeTimer > 0.45) this.alive = false;
      return;
    }
    if (!this.isBoss) {
      this.y += this.speed * dt;
      if (this.isErratic) {
        this.erraticTimer += dt;
        const dx = Math.sin(this.erraticTimer * 4.5 + this.erraticPhase) * this.speed * 0.5;
        this.x = Math.max(20, Math.min(CANVAS_W - 20, this.x + dx * dt));
      }
    }
    // Bosses are stationary — no y movement
  }

  triggerExplosion() {
    this.exploding    = true;
    this.explodeTimer = 0;
  }

  collidesWithBullet(bullet) {
    const dx = this.x - bullet.x;
    const dy = this.y - bullet.y;
    return (dx * dx + dy * dy) < (this.radius + bullet.radius) ** 2;
  }
}

export class Bullet {
  constructor({ x, y, attribute, target = null, speedMult = 1.0, isPierce = false, isSplit = false }) {
    this.x          = x;
    this.y          = y;
    this.attribute  = attribute;
    this.radius     = BULLET_RADIUS;
    this.alive      = true;
    this.target     = target;
    this._speedMult = speedMult;
    this.isPierce   = isPierce;
    this.isSplit    = isSplit;
    this.isFragment = false;
    this.pierceHit  = new Set();
    this._life      = isPierce ? 6.0 : 4.0;  // 時限消滅（秒）

    this.vx = 0;
    this.vy = -460 * speedMult;
  }

  update(dt) {
    // 時限消滅
    this._life -= dt;
    if (this._life <= 0) { this.alive = false; return; }

    if (this.target && this.target.alive && !this.target.exploding && !this.pierceHit.has(this.target)) {
      const dx   = this.target.x - this.x;
      const dy   = this.target.y - this.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist > 1) {
        const spd = 460 * this._speedMult;
        const t   = Math.min(dt * 12, 1);
        this.vx  += (dx / dist * spd - this.vx) * t;
        this.vy  += (dy / dist * spd - this.vy) * t;
      }
    }

    this.x += this.vx * dt;
    this.y += this.vy * dt;

    if (this.y < -30 || this.y > 900 || this.x < -30 || this.x > CANVAS_W + 30) {
      this.alive = false;
    }
  }
}

export class Laser {
  constructor({ x, y, dx, dy, damage, duration = 0.55 }) {
    this.x       = x;
    this.y       = y;
    this.dx      = dx;
    this.dy      = dy;
    this.damage  = damage;
    this.life    = duration;
    this.maxLife = duration;
    this.alive   = true;
    this.hitSet  = new Set();
  }

  update(dt) {
    this.life -= dt;
    if (this.life <= 0) this.alive = false;
  }
}

export class Particle {
  constructor({ x, y, color, radius, vx = 0, vy = 0, life = 0.5 }) {
    this.x       = x;
    this.y       = y;
    this.color   = color;
    this.radius  = radius;
    this.vx      = vx;
    this.vy      = vy;
    this.life    = life;
    this.maxLife = life;
    this.alive   = true;
  }

  update(dt) {
    this.x    += this.vx * dt;
    this.y    += this.vy * dt;
    this.vy   += 200 * dt;
    this.life -= dt;
    if (this.life <= 0) this.alive = false;
  }
}

// ── Drop Item ─────────────────────────────────────────────────────────────────
// kind      : 'common' | 'general'
// attribute : ATTR.ROCK / SCISSORS / PAPER  (common のみ)
// stat      : 'power'|'speed'|'bullets'     (common)
//           : 'score'|'bomb'|'shield'|'battery' (general)
export class DropItem {
  constructor(x, y, kind, attribute, stat) {
    this.x         = x;
    this.y         = y;
    this.kind      = kind;
    this.attribute = attribute;
    this.stat      = stat;
    this.alive     = true;
    this.vy        = 110;                         // 落下速度 px/sec
    this.bobTimer  = Math.random() * Math.PI * 2; // ふわふわ位相
  }

  update(dt) {
    if (!this.alive) return;
    this.y        += this.vy * dt;
    this.bobTimer += dt * 2.5;
  }
}
