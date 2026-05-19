import { ENEMY_RADIUS, BOSS_RADIUS, GRAND_BOSS_RADIUS, BULLET_RADIUS, CANVAS_W, ENEMY_TYPE_CONFIG } from './constants.js';

export class Enemy {
  constructor({ x, y, attribute, speed, hp = 1, isBoss = false, isGrandBoss = false, enemyType = 'NORMAL', drawImmune = false }) {
    this.x          = x;
    this.y          = y;
    this.attribute  = attribute;
    this.speed      = speed;
    this.hp         = hp;
    this.maxHp      = hp;
    this.isBoss     = isBoss;
    this.isGrandBoss = isGrandBoss;
    this.enemyType  = enemyType;
    this.drawImmune = drawImmune;

    if (isBoss) {
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

    this.vx = 0;
    this.vy = -460 * speedMult;
  }

  update(dt) {
    if (this.target && this.target.alive && !this.target.exploding) {
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
