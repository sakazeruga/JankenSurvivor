import {
  CANVAS_W, CANVAS_H, BTN_AREA_H, KILL_LINE_Y,
  ATTR, ALL_ATTRS, ATTR_COLOR, ATTR_SYMBOL, ATTR_LABEL,
  COLORS, ENEMY_RADIUS,
  DIFFICULTY, DIFFICULTY_CONFIG,
  BASE_HIT_PENALTY, VERSION,
} from './constants.js';
import { GameState } from './game.js';
import { auth }      from './auth.js';
import { savedata }  from './savedata.js';

// Polyfill for CanvasRenderingContext2D.roundRect (Safari < 15.4, older Chrome)
if (!CanvasRenderingContext2D.prototype.roundRect) {
  CanvasRenderingContext2D.prototype.roundRect = function (x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    this.beginPath();
    this.moveTo(x + r, y);
    this.arcTo(x + w, y,     x + w, y + h, r);
    this.arcTo(x + w, y + h, x,     y + h, r);
    this.arcTo(x,     y + h, x,     y,     r);
    this.arcTo(x,     y,     x + w, y,     r);
    this.closePath();
  };
}

// Category metadata for skill columns
const CAT_META = {
  [ATTR.ROCK]:     { label: 'グー',   symbol: '✊', color: '#E74C3C' },
  [ATTR.SCISSORS]: { label: 'チョキ', symbol: '✌', color: '#2ECC71' },
  [ATTR.PAPER]:    { label: 'パー',   symbol: '✋', color: '#3498DB' },
  UTIL:            { label: '汎用',   symbol: '⚙',  color: '#9B59B6' },
};

// Skill storage key — matches game.js skillKey()
function skillKey(skill) {
  return skill.category !== 'UTIL' ? `${skill.category}_${skill.id}` : skill.id;
}

// Label and color for a storage key (used in the in-game skill panel)
function skillKeyMeta(key) {
  const attrMap = {
    ROCK:     { sym: '✊', color: '#E74C3C' },
    SCISSORS: { sym: '✌', color: '#2ECC71' },
    PAPER:    { sym: '✋', color: '#3498DB' },
  };
  for (const [attr, meta] of Object.entries(attrMap)) {
    if (key.startsWith(attr + '_')) {
      const rest = key.slice(attr.length + 1);
      const abbrev = {
        com_bullets: '弾+', com_speed: '速+', com_power: '攻+',
        rare_pierce: '貫通', rare_split: '分裂', rare_laser: 'レーザー',
      };
      return { label: meta.sym + (abbrev[rest] || rest), color: meta.color };
    }
  }
  const utilMap = {
    util_bomb:    { label: '💣ボム',  color: '#E67E22' },
    util_score:   { label: '×スコア', color: '#9B59B6' },
    rare_shield:  { label: '🛡守護',  color: '#3498DB' },
    rare_power:   { label: '⚡全力',  color: '#FFD700' },
  };
  return utilMap[key] || { label: key, color: '#AAAAAA' };
}

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx    = canvas.getContext('2d');
    canvas.width  = CANVAS_W;
    canvas.height = CANVAS_H;
    this._fitToWindow();
    window.addEventListener('resize', () => this._fitToWindow());
  }

  _fitToWindow() {
    // Use innerHeight directly so the body flexbox always matches the actual visible area
    const h     = window.innerHeight;
    const w     = window.innerWidth;
    document.body.style.height = h + 'px';
    const ratio = Math.min(w / CANVAS_W, h / CANVAS_H);
    this.canvas.style.width  = Math.floor(CANVAS_W * ratio) + 'px';
    this.canvas.style.height = Math.floor(CANVAS_H * ratio) + 'px';
  }

  // ── Top-level render dispatch ────────────────────────────────────────────

  render(gm) {
    const { ctx } = this;
    ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);

    if (gm.state === GameState.TITLE) { this._drawTitle(gm); return; }
    if (gm.state === GameState.DIFFICULTY_SELECT) { this._drawDifficultySelect(); return; }

    const isPaused = gm.state === GameState.PAUSED;
    if (isPaused) ctx.filter = 'blur(5px)';
    this._drawPlayField(gm);
    ctx.filter = 'none';

    if (isPaused)                           { this._drawPauseOverlay(); return; }
    if (gm.state === GameState.WAVE_RESULT)   this._drawSkillShop(gm);
    if (gm.state === GameState.GAME_OVER)     this._drawGameOver(gm);
    if (gm.state === GameState.GAME_CLEAR)    this._drawGameClear(gm);
  }

  // ── Play field ───────────────────────────────────────────────────────────

  _drawPlayField(gm) {
    const { ctx } = this;

    ctx.fillStyle = COLORS.BG;
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

    // Grid
    ctx.strokeStyle = 'rgba(255,255,255,0.025)';
    ctx.lineWidth   = 1;
    for (let x = 0; x <= CANVAS_W; x += 39) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, KILL_LINE_Y); ctx.stroke();
    }
    for (let y = 0; y <= KILL_LINE_Y; y += 40) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(CANVAS_W, y); ctx.stroke();
    }

    // Kill line
    ctx.strokeStyle = 'rgba(255,255,255,0.18)';
    ctx.lineWidth   = 2;
    ctx.setLineDash([10, 7]);
    ctx.beginPath(); ctx.moveTo(0, KILL_LINE_Y); ctx.lineTo(CANVAS_W, KILL_LINE_Y); ctx.stroke();
    ctx.setLineDash([]);

    // Boss death rings (behind enemies)
    for (const ring of (gm.bossDeathRings || [])) {
      const progress = 1 - ring.life / ring.maxLife;
      const radius   = ring.maxRadius * progress;
      const alpha    = (ring.life / ring.maxLife) * 0.8;
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.strokeStyle = ring.color;
      ctx.lineWidth   = 4 * (ring.life / ring.maxLife);
      ctx.shadowColor = ring.color;
      ctx.shadowBlur  = 20;
      ctx.beginPath(); ctx.arc(ring.x, ring.y, Math.max(1, radius), 0, Math.PI * 2); ctx.stroke();
      ctx.restore();
    }

    for (const p of gm.particles) this._drawParticle(p);
    for (const l of gm.lasers)    this._drawLaser(l);
    for (const b of gm.bullets)   this._drawBullet(b);
    for (const e of gm.enemies)   this._drawEnemy(e);

    this._drawHUD(gm);
    this._drawActiveSkillPanel(gm);
    this._drawButtons(gm);

    // Boss death flash (gold)
    if ((gm.bossDeathFlash || 0) > 0) {
      ctx.fillStyle = `rgba(255,215,0,${Math.min(0.75, gm.bossDeathFlash * 0.7)})`;
      ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
    }

    // Bomb flash (yellow)
    if (gm.bombFlash > 0) {
      ctx.fillStyle = `rgba(255,200,0,${Math.min(0.65, gm.bombFlash * 0.9)})`;
      ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
    }

    // Shield invincibility overlay (blue)
    if ((gm.shieldInvincTimer || 0) > 0) {
      const pulse = 0.5 + 0.5 * Math.abs(Math.sin(Date.now() / 120));
      ctx.fillStyle = `rgba(30,120,255,${0.12 + 0.06 * pulse})`;
      ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
    }

    // Damage flash (red)
    if (gm.damageFlash > 0) {
      ctx.fillStyle = `rgba(231,76,60,${Math.min(0.45, gm.damageFlash)})`;
      ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
    }

    // ── CAUTION overlay (normal boss) — yellow, short ─────────────────────
    if ((gm.cautionTimer || 0) > 0) {
      const t     = Date.now() / 80;
      const pulse = 0.4 + 0.6 * Math.abs(Math.sin(t));
      const alpha = Math.min(1, gm.cautionTimer) * pulse;

      ctx.save();
      ctx.fillStyle = `rgba(255,200,0,${alpha * 0.12})`;
      ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

      ctx.strokeStyle = `rgba(255,210,0,${alpha * 0.85})`;
      ctx.lineWidth   = 6;
      ctx.strokeRect(3, 3, CANVAS_W - 6, CANVAS_H - 6);

      ctx.textAlign    = 'center';
      ctx.textBaseline = 'middle';
      ctx.shadowColor  = '#FFD700';
      ctx.shadowBlur   = 18;

      ctx.fillStyle = `rgba(255,220,0,${alpha})`;
      ctx.font      = 'bold 52px sans-serif';
      ctx.fillText('⚠ CAUTION', CANVAS_W / 2, CANVAS_H / 2 - 30);

      ctx.fillStyle = `rgba(255,240,180,${alpha * 0.85})`;
      ctx.font      = 'bold 18px sans-serif';
      ctx.fillText('BOSS APPROACHING', CANVAS_W / 2, CANVAS_H / 2 + 16);

      ctx.shadowBlur = 0;
      ctx.restore();
    }

    // ── WARNING overlay (grand boss) — red ───────────────────────────────
    if ((gm.bossWarning || 0) > 0) {
      const t     = Date.now() / 120;
      const pulse = 0.55 + 0.45 * Math.abs(Math.sin(t));
      const alpha = Math.min(1, gm.bossWarning) * pulse;

      ctx.save();
      ctx.fillStyle = `rgba(200,0,0,${alpha * 0.22})`;
      ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

      ctx.strokeStyle = `rgba(255,40,40,${alpha * 0.9})`;
      ctx.lineWidth   = 8;
      ctx.strokeRect(4, 4, CANVAS_W - 8, CANVAS_H - 8);

      ctx.textAlign    = 'center';
      ctx.textBaseline = 'middle';
      ctx.shadowColor  = '#FF0000';
      ctx.shadowBlur   = 24;

      ctx.fillStyle = `rgba(255,60,60,${alpha})`;
      ctx.font      = 'bold 58px sans-serif';
      ctx.fillText('⚠ WARNING', CANVAS_W / 2, CANVAS_H / 2 - 40);

      ctx.fillStyle = `rgba(255,200,200,${alpha * 0.9})`;
      ctx.font      = 'bold 20px sans-serif';
      ctx.fillText('GRAND BOSS APPROACHING', CANVAS_W / 2, CANVAS_H / 2 + 14);

      ctx.shadowBlur = 0;
      ctx.restore();
    }

    // ── DANGER overlay (ultra boss) — deep crimson, bolder ───────────────
    if ((gm.ultraDanger || 0) > 0) {
      const t     = Date.now() / 65;
      const pulse = 0.5 + 0.5 * Math.abs(Math.sin(t));
      const alpha = Math.min(1, gm.ultraDanger) * pulse;

      ctx.save();
      // Heavy red tint
      ctx.fillStyle = `rgba(160,0,0,${alpha * 0.42})`;
      ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

      // Double border — outer thin white, inner thick red
      ctx.strokeStyle = `rgba(255,255,255,${alpha * 0.6})`;
      ctx.lineWidth   = 2;
      ctx.strokeRect(2, 2, CANVAS_W - 4, CANVAS_H - 4);
      ctx.strokeStyle = `rgba(255,0,0,${alpha})`;
      ctx.lineWidth   = 14;
      ctx.strokeRect(8, 8, CANVAS_W - 16, CANVAS_H - 16);

      ctx.textAlign    = 'center';
      ctx.textBaseline = 'middle';

      // Bold DANGER title
      ctx.shadowColor = '#FF0000';
      ctx.shadowBlur  = 44;
      ctx.fillStyle   = `rgba(255,20,20,${alpha})`;
      ctx.font        = 'bold 68px sans-serif';
      ctx.fillText('💀 DANGER 💀', CANVAS_W / 2, CANVAS_H / 2 - 50);

      // Sub-text
      ctx.shadowBlur  = 18;
      ctx.fillStyle   = `rgba(255,140,140,${alpha * 0.95})`;
      ctx.font        = 'bold 18px sans-serif';
      ctx.fillText('ULTRA BOSS APPROACHING', CANVAS_W / 2, CANVAS_H / 2 + 10);

      ctx.shadowBlur  = 0;
      ctx.fillStyle   = `rgba(255,80,80,${alpha * 0.7})`;
      ctx.font        = '13px sans-serif';
      ctx.fillText('全力で迎え撃て！', CANVAS_W / 2, CANVAS_H / 2 + 38);

      ctx.shadowBlur = 0;
      ctx.restore();
    }
  }

  // ── In-game active skill panel (top-right floating) ──────────────────────

  _drawActiveSkillPanel(gm) {
    const entries = Object.entries(gm.skills || {}).filter(([, v]) => v > 0);
    if (entries.length === 0) return;

    const { ctx } = this;
    const rowH    = 15;
    const panelW  = 90;
    const px      = CANVAS_W - 4;
    const py      = 76;
    const panelH  = entries.length * rowH + 6;

    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.beginPath();
    ctx.roundRect(px - panelW, py, panelW, panelH, 4);
    ctx.fill();

    ctx.textAlign    = 'right';
    ctx.textBaseline = 'top';
    ctx.font         = '9px sans-serif';

    for (let i = 0; i < entries.length; i++) {
      const [key, level] = entries[i];
      const meta = skillKeyMeta(key);
      ctx.fillStyle = meta.color;
      ctx.fillText(`${meta.label} Lv.${level}`, px - 4, py + 3 + i * rowH);
    }
    ctx.restore();
  }

  // ── Laser ────────────────────────────────────────────────────────────────

  _drawLaser(laser) {
    if (!laser.alive) return;
    const { ctx } = this;
    const alpha  = laser.life / laser.maxLife;
    const length = 900;
    const ex = laser.x + laser.dx * length;
    const ey = laser.y + laser.dy * length;

    ctx.save();
    ctx.globalAlpha = alpha * 0.85;
    ctx.strokeStyle = '#88CCFF';
    ctx.lineWidth   = 4;
    ctx.shadowColor = '#3498DB';
    ctx.shadowBlur  = 18;
    ctx.lineCap     = 'round';
    ctx.beginPath(); ctx.moveTo(laser.x, laser.y); ctx.lineTo(ex, ey); ctx.stroke();

    ctx.strokeStyle = '#FFFFFF';
    ctx.lineWidth   = 1.5;
    ctx.shadowBlur  = 0;
    ctx.globalAlpha = alpha * 0.5;
    ctx.beginPath(); ctx.moveTo(laser.x, laser.y); ctx.lineTo(ex, ey); ctx.stroke();
    ctx.restore();
  }

  // ── Enemy ────────────────────────────────────────────────────────────────

  _drawEnemy(enemy) {
    const { ctx } = this;
    const { x, y, radius, attribute, scale, alpha, exploding, hp, maxHp,
            isBoss, isGrandBoss, isUltraBoss, isMidBoss, isRushBoss,
            enemyType, drawImmune } = enemy;
    const color = ATTR_COLOR[attribute];

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(x, y);
    ctx.scale(scale, scale);

    // ── Aura ──────────────────────────────────────────────────────────────
    if (isBoss) {
      const speed = isUltraBoss ? 250 : isGrandBoss ? 400 : 600;
      const t     = Date.now() / speed;
      const pulse = 0.7 + 0.3 * Math.sin(t);
      const auraR = radius * (isUltraBoss ? 3.8 : isGrandBoss ? 3.2 : 2.8);
      const grad2 = ctx.createRadialGradient(0, 0, radius * 0.3, 0, 0, auraR);

      let auraColor;
      if (isUltraBoss) {
        auraColor = enemy.ultraCharging   ? '#FF8800'
                  : enemy.ultraAbsorbActive ? '#00CC55'
                  : '#AA0000';
      } else {
        auraColor = isGrandBoss ? '#CC00FF' : color;
      }
      grad2.addColorStop(0, auraColor + '99'); grad2.addColorStop(1, 'transparent');
      ctx.globalAlpha = alpha * pulse;
      ctx.fillStyle = grad2;
      ctx.beginPath(); ctx.arc(0, 0, auraR, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = alpha;
    }

    if (isMidBoss) {
      const auraColor = isRushBoss ? '#FF0000' : '#FF8C00';
      const t     = Date.now() / (isRushBoss ? 250 : 500);
      const pulse = 0.65 + 0.35 * Math.sin(t);
      const auraR = radius * (isRushBoss ? 3.0 : 2.6);
      const grad2 = ctx.createRadialGradient(0, 0, radius * 0.3, 0, 0, auraR);
      grad2.addColorStop(0, auraColor + '99'); grad2.addColorStop(1, 'transparent');
      ctx.globalAlpha = alpha * pulse;
      ctx.fillStyle = grad2;
      ctx.beginPath(); ctx.arc(0, 0, auraR, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = alpha;
    }

    if (!isBoss && !isMidBoss && enemyType === 'LARGE') {
      ctx.strokeStyle = color;
      ctx.lineWidth   = 3;
      ctx.globalAlpha = alpha * 0.5;
      ctx.beginPath(); ctx.arc(0, 0, radius + 6, 0, Math.PI * 2); ctx.stroke();
      ctx.globalAlpha = alpha;
    }

    if (drawImmune) {
      ctx.strokeStyle = '#888';
      ctx.lineWidth   = 2;
      ctx.setLineDash([4, 3]);
      ctx.beginPath(); ctx.arc(0, 0, radius + 4, 0, Math.PI * 2); ctx.stroke();
      ctx.setLineDash([]);
    }

    // ── Body ──────────────────────────────────────────────────────────────
    const grad = ctx.createRadialGradient(0, 0, radius * 0.2, 0, 0, radius * 1.8);
    grad.addColorStop(0, color + '55'); grad.addColorStop(1, 'transparent');
    ctx.fillStyle = grad;
    ctx.beginPath(); ctx.arc(0, 0, radius * 1.8, 0, Math.PI * 2); ctx.fill();

    ctx.fillStyle = color;
    ctx.beginPath(); ctx.arc(0, 0, radius, 0, Math.PI * 2); ctx.fill();

    // ── Rings & shields ───────────────────────────────────────────────────
    if (isBoss && isUltraBoss) {
      // Ultra boss: triple crimson ring
      const ringColors = ['#FF0000', '#CC0000', '#880000'];
      for (let r = 0; r < 3; r++) {
        ctx.strokeStyle = ringColors[r];
        ctx.lineWidth   = 5 - r;
        ctx.beginPath(); ctx.arc(0, 0, radius + 5 + r * 10, 0, Math.PI * 2); ctx.stroke();
      }

      if (!exploding) {
        const t     = Date.now() / 130;
        const pulse = 0.55 + 0.45 * Math.abs(Math.sin(t));
        const sr    = radius + 36;

        if (enemy.ultraCharging) {
          // Charge: orange pulsing ring, faster
          const ct = Date.now() / 80;
          const cp = 0.6 + 0.4 * Math.abs(Math.sin(ct));
          ctx.strokeStyle = `rgba(255,160,0,${cp})`;
          ctx.lineWidth   = 9;
          ctx.beginPath(); ctx.arc(0, 0, sr, 0, Math.PI * 2); ctx.stroke();
          ctx.strokeStyle = `rgba(255,220,80,${cp * 0.5})`;
          ctx.lineWidth   = 18;
          ctx.beginPath(); ctx.arc(0, 0, sr + 6, 0, Math.PI * 2); ctx.stroke();
        } else if (enemy.ultraAbsorbActive) {
          // Absorption barrier: green pulsing ring
          ctx.strokeStyle = `rgba(0,220,80,${pulse})`;
          ctx.lineWidth   = 8;
          ctx.beginPath(); ctx.arc(0, 0, sr, 0, Math.PI * 2); ctx.stroke();
          ctx.strokeStyle = `rgba(100,255,150,${pulse * 0.45})`;
          ctx.lineWidth   = 18;
          ctx.beginPath(); ctx.arc(0, 0, sr + 6, 0, Math.PI * 2); ctx.stroke();
        }
      }
    } else if (isBoss) {
      const ringColor = isGrandBoss ? '#CC00FF' : '#FFD700';
      const rings     = isGrandBoss ? 2 : 1;
      for (let r = 0; r < rings; r++) {
        ctx.strokeStyle = ringColor;
        ctx.lineWidth   = isGrandBoss ? 4 - r : 3;
        ctx.beginPath(); ctx.arc(0, 0, radius + 4 + r * 8, 0, Math.PI * 2); ctx.stroke();
      }

      // Normal/Grand boss shield visual
      const sp = enemy.bossShieldPhase;
      if (!exploding && (sp === 1 || sp === 2)) {
        const t     = Date.now() / 160;
        const pulse = 0.55 + 0.45 * Math.abs(Math.sin(t));
        const sr    = radius + (isGrandBoss ? 26 : 20);
        if (sp === 1) {
          ctx.strokeStyle = `rgba(0,200,255,${pulse})`;
          ctx.lineWidth   = 6;
          ctx.beginPath(); ctx.arc(0, 0, sr, 0, Math.PI * 2); ctx.stroke();
          ctx.strokeStyle = `rgba(100,230,255,${pulse * 0.4})`;
          ctx.lineWidth   = 14;
          ctx.beginPath(); ctx.arc(0, 0, sr + 4, 0, Math.PI * 2); ctx.stroke();
        } else {
          ctx.strokeStyle = `rgba(220,220,255,${pulse})`;
          ctx.lineWidth   = 6;
          ctx.setLineDash([8, 5]);
          ctx.beginPath(); ctx.arc(0, 0, sr, 0, Math.PI * 2); ctx.stroke();
          ctx.setLineDash([]);
          ctx.strokeStyle = `rgba(180,180,255,${pulse * 0.4})`;
          ctx.lineWidth   = 14;
          ctx.beginPath(); ctx.arc(0, 0, sr + 4, 0, Math.PI * 2); ctx.stroke();
        }
      }
    } else if (isMidBoss) {
      const ringA = isRushBoss ? '#FF2200' : '#FF8C00';
      const ringB = isRushBoss ? '#FF6600' : '#FFD700';
      ctx.strokeStyle = ringA;
      ctx.lineWidth   = 3;
      ctx.beginPath(); ctx.arc(0, 0, radius + 4, 0, Math.PI * 2); ctx.stroke();
      ctx.strokeStyle = ringB;
      ctx.lineWidth   = 2;
      ctx.beginPath(); ctx.arc(0, 0, radius + 10, 0, Math.PI * 2); ctx.stroke();
    } else if (enemyType === 'MEDIUM') {
      ctx.strokeStyle = 'rgba(255,255,255,0.4)';
      ctx.lineWidth   = 2;
      ctx.beginPath(); ctx.arc(0, 0, radius, 0, Math.PI * 2); ctx.stroke();
    }

    // ── Specular highlight ────────────────────────────────────────────────
    ctx.fillStyle = 'rgba(255,255,255,0.18)';
    ctx.beginPath(); ctx.arc(-radius * 0.2, -radius * 0.25, radius * 0.55, 0, Math.PI * 2); ctx.fill();

    // ── Attribute symbol ──────────────────────────────────────────────────
    ctx.fillStyle    = '#FFF';
    ctx.font         = `bold ${radius}px sans-serif`;
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(ATTR_SYMBOL[attribute], 0, 2);

    // ── Crown / badge ─────────────────────────────────────────────────────
    if (isBoss && !exploding) {
      const crownCount = isUltraBoss ? 3 : isGrandBoss ? 2 : 1;
      ctx.font = `${radius * (isUltraBoss ? 0.52 : 0.65)}px sans-serif`;
      ctx.fillText('👑'.repeat(crownCount), 0, -radius - (isUltraBoss ? 18 : 14));
    }

    if (isMidBoss && !exploding) {
      ctx.fillStyle = isRushBoss ? '#FF4400' : '#FFD700';
      ctx.font      = `${radius * 0.6}px sans-serif`;
      ctx.fillText(isRushBoss ? '⚡' : '★', 0, -radius - 14);
    }

    if (drawImmune && !exploding) {
      ctx.fillStyle = '#AAA'; ctx.font = `${radius * 0.45}px sans-serif`;
      ctx.fillText('⊘', radius * 0.6, -radius * 0.6);
    }

    // ── Status text ───────────────────────────────────────────────────────
    if (isBoss && !exploding) {
      const statusY = radius + (isUltraBoss ? 40 : isGrandBoss ? 30 : 24);
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      if (isUltraBoss) {
        if (enemy.ultraCharging) {
          ctx.fillStyle = '#FFB020'; ctx.font = 'bold 12px sans-serif';
          ctx.fillText('⚡ CHARGE', 0, statusY);
          if (enemy.ultraChargeDamage > 0) {
            ctx.fillStyle = '#FFD700'; ctx.font = 'bold 10px sans-serif';
            ctx.fillText(`蓄積 -${enemy.ultraChargeDamage}`, 0, statusY + 15);
          }
        } else if (enemy.ultraAbsorbActive) {
          ctx.fillStyle = '#00EE66'; ctx.font = 'bold 12px sans-serif';
          ctx.fillText('⊕ ABSORB', 0, statusY);
        }
      } else {
        const sp = enemy.bossShieldPhase;
        if (sp === 1) {
          ctx.fillStyle = '#00DDFF'; ctx.font = 'bold 11px sans-serif';
          ctx.fillText('🛡 GUARD', 0, statusY);
        } else if (sp === 2) {
          ctx.fillStyle = '#CCCCFF'; ctx.font = 'bold 11px sans-serif';
          ctx.fillText('⊘ BARRIER', 0, statusY);
        }
      }
    }

    // ── HP bar ────────────────────────────────────────────────────────────
    if (!exploding && maxHp > 1) {
      const bw = radius * (isBoss ? 2.4 : isMidBoss ? 2.0 : 1.8);
      const bh = (isBoss || isMidBoss) ? 7 : 5;
      const bx = -bw / 2;
      const by = radius + (isBoss && isUltraBoss ? 24 : 8);
      ctx.fillStyle = '#222'; ctx.fillRect(bx, by, bw, bh);
      const barColor = isUltraBoss ? '#CC0000'
        : isBoss ? (isGrandBoss ? '#CC00FF' : '#FFD700')
        : isMidBoss ? (isRushBoss ? '#FF3300' : '#FF8C00')
        : color;
      ctx.fillStyle = barColor;
      ctx.fillRect(bx, by, bw * (hp / maxHp), bh);
      if (isBoss || isMidBoss) {
        ctx.fillStyle = '#FFF'; ctx.font = '10px sans-serif';
        ctx.textAlign = 'center'; ctx.textBaseline = 'top';
        ctx.fillText(`${hp} / ${maxHp}`, 0, by + bh + 2);
      }
    }

    ctx.restore();
  }

  // ── Bullet ───────────────────────────────────────────────────────────────

  _drawBullet(bullet) {
    const { ctx } = this;
    const { x, y, vx, vy, radius, attribute, isPierce, isSplit } = bullet;
    const color = ATTR_COLOR[attribute];

    ctx.save();

    if (isPierce) {
      // Pierce: elongated golden diamond in direction of travel
      const angle = Math.atan2(vy, vx);
      ctx.translate(x, y);
      ctx.rotate(angle);
      ctx.shadowColor = '#FFD700';
      ctx.shadowBlur  = 16;
      // Outer glow trail
      ctx.fillStyle = 'rgba(255,215,0,0.3)';
      ctx.beginPath();
      ctx.ellipse(-radius * 1.5, 0, radius * 3, radius * 0.9, 0, 0, Math.PI * 2);
      ctx.fill();
      // Diamond body
      ctx.fillStyle = '#FFD700';
      ctx.beginPath();
      ctx.moveTo(radius * 2.2, 0);
      ctx.lineTo(0, radius * 0.9);
      ctx.lineTo(-radius * 1.0, 0);
      ctx.lineTo(0, -radius * 0.9);
      ctx.closePath();
      ctx.fill();
      // White core
      ctx.shadowBlur  = 0;
      ctx.fillStyle   = 'rgba(255,255,255,0.85)';
      ctx.beginPath(); ctx.arc(radius * 0.3, 0, radius * 0.38, 0, Math.PI * 2); ctx.fill();
    } else if (isSplit) {
      // Split: vivid orange orb — clearly distinct from SCISSORS green
      ctx.shadowColor = '#FF5500';
      ctx.shadowBlur  = 14;
      // Outer glow ring
      ctx.strokeStyle = 'rgba(255,120,0,0.45)';
      ctx.lineWidth   = 4;
      ctx.beginPath(); ctx.arc(x, y, radius * 1.7, 0, Math.PI * 2); ctx.stroke();
      // Main body
      ctx.fillStyle = '#FF7700';
      ctx.beginPath(); ctx.arc(x, y, radius * 1.1, 0, Math.PI * 2); ctx.fill();
      // Inner white highlight
      ctx.shadowBlur = 0;
      ctx.fillStyle  = 'rgba(255,255,255,0.75)';
      ctx.beginPath(); ctx.arc(x - radius * 0.28, y - radius * 0.28, radius * 0.4, 0, Math.PI * 2); ctx.fill();
      // "Split" indicator: two small dots flanking the bullet (perpendicular to travel)
      const perp = Math.atan2(vy, vx) + Math.PI / 2;
      const dotR = radius * 0.32;
      for (const side of [-1, 1]) {
        ctx.fillStyle = 'rgba(255,200,80,0.9)';
        ctx.beginPath();
        ctx.arc(x + Math.cos(perp) * side * radius * 1.6, y + Math.sin(perp) * side * radius * 1.6, dotR, 0, Math.PI * 2);
        ctx.fill();
      }
    } else {
      // Normal bullet: colored sphere with trail
      const tx = x - vx * 0.035, ty = y - vy * 0.035;
      ctx.strokeStyle = color + '70';
      ctx.lineWidth   = radius * 2.2;
      ctx.lineCap     = 'round';
      ctx.beginPath(); ctx.moveTo(tx, ty); ctx.lineTo(x, y); ctx.stroke();
      ctx.fillStyle   = color;
      ctx.beginPath(); ctx.arc(x, y, radius, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle  = 'rgba(255,255,255,0.7)';
      ctx.beginPath(); ctx.arc(x - radius * 0.25, y - radius * 0.25, radius * 0.45, 0, Math.PI * 2); ctx.fill();
    }

    ctx.restore();
  }

  // ── Particle ─────────────────────────────────────────────────────────────

  _drawParticle(p) {
    const { ctx } = this;
    const progress = p.life / p.maxLife;
    ctx.save();
    ctx.globalAlpha = progress;
    ctx.fillStyle   = p.color;
    ctx.beginPath(); ctx.arc(p.x, p.y, Math.max(1, p.radius * progress), 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }

  // ── HUD ──────────────────────────────────────────────────────────────────

  _drawHUD(gm) {
    const { ctx } = this;

    ctx.fillStyle = COLORS.BG_PANEL;
    ctx.fillRect(0, 0, CANVAS_W, 72);
    ctx.strokeStyle = 'rgba(255,255,255,0.07)';
    ctx.lineWidth   = 1;
    ctx.beginPath(); ctx.moveTo(0, 72); ctx.lineTo(CANVAS_W, 72); ctx.stroke();

    const stageMult  = gm.stageIndex / 3 + 1;
    const diffMult   = DIFFICULTY_CONFIG[gm.difficulty]?.damageMult ?? 1;
    const penalty    = Math.round(BASE_HIT_PENALTY * stageMult * diffMult);
    const danger     = gm.score < penalty * 2;
    const scoreColor = danger ? '#FF6B6B' : COLORS.UI_TEXT;

    ctx.fillStyle    = scoreColor;
    ctx.font         = 'bold 30px sans-serif';
    ctx.textAlign    = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(gm.score.toLocaleString(), 16, 28);

    ctx.fillStyle = danger ? '#FF6B6B' : COLORS.UI_DIM;
    ctx.font      = '12px sans-serif';
    ctx.fillText('SCORE / LIFE', 16, 52);

    ctx.fillStyle    = COLORS.UI_TEXT;
    ctx.font         = 'bold 18px sans-serif';
    ctx.textAlign    = 'center';
    ctx.fillText(`WAVE  ${gm.waveIndex + 1} / ${gm.stageConfig?.waveCount ?? '?'}`, CANVAS_W / 2, 25);
    ctx.fillStyle = COLORS.UI_DIM;
    ctx.font      = '12px sans-serif';
    ctx.fillText(`STAGE ${gm.stageIndex + 1}`, CANVAS_W / 2, 50);

    // Pause button (top-right of HUD)
    const pbx = CANVAS_W - 40, pby = 4, pbw = 34, pbh = 34;
    ctx.fillStyle = 'rgba(255,255,255,0.13)';
    ctx.beginPath(); ctx.roundRect(pbx, pby, pbw, pbh, 6); ctx.fill();
    ctx.fillStyle    = '#FFF';
    ctx.font         = '20px sans-serif';
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(gm.state === GameState.PAUSED ? '▶' : '⏸', pbx + pbw / 2, pby + pbh / 2);

    const diffCfg = DIFFICULTY_CONFIG[gm.difficulty] ?? DIFFICULTY_CONFIG[DIFFICULTY.EASY];
    ctx.fillStyle    = diffCfg.color;
    ctx.font         = 'bold 14px sans-serif';
    ctx.textAlign    = 'right';
    ctx.textBaseline = 'middle';
    ctx.fillText(diffCfg.label, pbx - 6, 28);

    if ((gm.shieldCharges || 0) > 0) {
      ctx.font = '13px sans-serif';
      const inv = gm.shieldInvincTimer || 0;
      const ct  = gm.shieldCTTimer    || 0;
      if (inv > 0) {
        ctx.fillStyle = '#00DDFF';
        ctx.fillText(`🛡 Lv.${gm.shieldCharges} ▶${inv.toFixed(1)}s`, pbx - 6, 52);
      } else if (ct > 0) {
        ctx.fillStyle = '#7799BB';
        ctx.fillText(`🛡 Lv.${gm.shieldCharges} CT${ct.toFixed(1)}s`, pbx - 6, 52);
      } else {
        ctx.fillStyle = '#3498DB';
        ctx.fillText(`🛡 Lv.${gm.shieldCharges} 待機中`, pbx - 6, 52);
      }
    }
  }

  // ── Button area ──────────────────────────────────────────────────────────

  _drawButtons(gm) {
    const { ctx }  = this;
    const btnY     = CANVAS_H - BTN_AREA_H;
    const btnW     = CANVAS_W / 3;
    const BOMB_H   = 38;

    ctx.fillStyle = COLORS.BG_PANEL;
    ctx.fillRect(0, btnY, CANVAS_W, BTN_AREA_H);
    ctx.strokeStyle = 'rgba(255,255,255,0.1)';
    ctx.lineWidth   = 1;
    ctx.beginPath(); ctx.moveTo(0, btnY); ctx.lineTo(CANVAS_W, btnY); ctx.stroke();

    const half      = CANVAS_W / 2;
    const pad       = 4;
    const bh        = BOMB_H - 6;   // button height = 32
    const bmid      = btnY + 4 + bh / 2;

    // ── 左：ボムボタン ───────────────────────────────────────────────────────
    const remaining = gm.bombsRemaining;
    const canBomb   = gm.score >= 100 && remaining > 0;
    const bombCost  = Math.floor(gm.score / 2);
    ctx.save();
    ctx.globalAlpha = canBomb ? 1.0 : 0.35;
    ctx.fillStyle   = canBomb ? '#E67E22' : '#555';
    ctx.beginPath(); ctx.roundRect(pad, btnY + 4, half - pad * 2, bh, 10); ctx.fill();
    ctx.fillStyle = '#FFF'; ctx.font = 'bold 12px sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(
      remaining > 0 ? `💣 ×${remaining}  -${bombCost.toLocaleString()}pt` : '💣 使用回数0',
      half / 2, bmid
    );
    ctx.restore();

    // ── 右：守護盾ボタン ─────────────────────────────────────────────────────
    const sc  = gm.shieldCharges;
    const siv = gm.shieldInvincTimer;
    const sct = gm.shieldCTTimer;
    let shieldBg, shieldAlpha, shieldLabel;
    if (sc === 0) {
      shieldBg = '#555'; shieldAlpha = 0.35; shieldLabel = '🛡 なし';
    } else if (siv > 0) {
      shieldBg = '#1E78FF'; shieldAlpha = 1.0; shieldLabel = `🛡 無敵 ${siv.toFixed(1)}s`;
    } else if (sct > 0) {
      shieldBg = '#555'; shieldAlpha = 0.7; shieldLabel = `🛡 CT ${sct.toFixed(1)}s`;
    } else {
      shieldBg = '#2980B9'; shieldAlpha = 1.0; shieldLabel = `🛡 Lv.${sc} 発動`;
    }
    ctx.save();
    ctx.globalAlpha = shieldAlpha;
    ctx.fillStyle   = shieldBg;
    ctx.beginPath(); ctx.roundRect(half + pad, btnY + 4, half - pad * 2, bh, 10); ctx.fill();
    ctx.fillStyle = '#FFF'; ctx.font = 'bold 12px sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.globalAlpha = Math.max(shieldAlpha, 0.6);
    ctx.fillText(shieldLabel, half + half / 2, bmid);
    ctx.restore();

    ctx.strokeStyle = 'rgba(255,255,255,0.07)';
    ctx.lineWidth   = 1;
    ctx.beginPath(); ctx.moveTo(0, btnY + BOMB_H); ctx.lineTo(CANVAS_W, btnY + BOMB_H); ctx.stroke();

    const attrAreaY = btnY + BOMB_H;
    const attrAreaH = BTN_AREA_H - BOMB_H;
    const attrs = [ATTR.ROCK, ATTR.SCISSORS, ATTR.PAPER];
    for (let i = 0; i < 3; i++) {
      const x = i * btnW, attr = attrs[i], color = ATTR_COLOR[attr];
      const cx = x + btnW / 2, cy = attrAreaY + attrAreaH / 2;
      if (i > 0) {
        ctx.strokeStyle = 'rgba(255,255,255,0.1)'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(x, attrAreaY); ctx.lineTo(x, CANVAS_H); ctx.stroke();
      }
      ctx.fillStyle    = color;
      ctx.font         = `${attrAreaH * 0.43}px sans-serif`;
      ctx.textAlign    = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(ATTR_SYMBOL[attr], cx, cy - 8);
      ctx.fillStyle = COLORS.UI_DIM; ctx.font = 'bold 13px sans-serif';
      ctx.fillText(ATTR_LABEL[attr], cx, cy + 26);
    }
  }

  // ── Skill shop (WAVE_RESULT) — 4-column layout ────────────────────────────

  _drawSkillShop(gm) {
    const { ctx } = this;

    ctx.fillStyle = 'rgba(10,12,30,0.96)';
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

    ctx.fillStyle    = '#2ECC71';
    ctx.font         = 'bold 34px sans-serif';
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('WAVE CLEAR!', CANVAS_W / 2, 40);

    ctx.fillStyle = COLORS.UI_TEXT;
    ctx.font      = 'bold 17px sans-serif';
    ctx.fillText(`スコア / ライフ: ${gm.score.toLocaleString()}`, CANVAS_W / 2, 70);

    ctx.fillStyle = COLORS.UI_DIM;
    ctx.font      = '12px sans-serif';
    ctx.fillText('スキルを1つ選択（スキップ可）', CANVAS_W / 2, 92);

    // ── セーブ状態インジケータ ─────────────────────────────────────────────
    if (auth.isLoggedIn) {
      const ind = savedata.isSaving ? '💾 保存中...' : '💾 保存済み ✓';
      ctx.fillStyle = savedata.isSaving ? COLORS.UI_DIM : '#2ECC71';
      ctx.font      = '11px sans-serif';
      ctx.textAlign = 'right';
      ctx.fillText(ind, CANVAS_W - 10, 14);
      ctx.textAlign = 'center';
    } else {
      ctx.fillStyle = '#5B9BD5'; ctx.font = 'bold 11px sans-serif';
      ctx.textAlign = 'right';
      ctx.fillText('🔑 ログインでセーブ ▶', CANVAS_W - 10, 14);
      ctx.textAlign = 'center';
    }

    const numCols  = 4;
    const pad      = 6;
    const gapX     = 5;
    const colW     = Math.floor((CANVAS_W - pad * 2 - gapX * (numCols - 1)) / numCols);
    const cardH    = 200;
    const gridY    = 108;
    const catOrder = [ATTR.ROCK, ATTR.SCISSORS, ATTR.PAPER, 'UTIL'];

    for (let i = 0; i < 4 && i < gm.offeredSkills.length; i++) {
      const skill  = gm.offeredSkills[i];
      const bx     = pad + i * (colW + gapX);
      const cat    = catOrder[i];
      const meta   = CAT_META[cat];
      const isRare = skill.rarity === 'rare';
      const key    = skillKey(skill);
      const level  = gm.skills[key] || 0;
      const n      = (gm.columnPurchases || {})[cat] || 0;
      const cost   = skill.baseCost * Math.pow(2, n);
      const canBuy = gm.score >= cost && !gm.skillSelected;

      this._drawSkillColumn(bx, gridY, colW, cardH, skill, meta, isRare, level, cost, canBuy, gm.skillSelected);
    }

    const botY = gridY + cardH + 12;
    if (gm.skillSelected) {
      ctx.fillStyle    = '#2ECC71';
      ctx.font         = 'bold 14px sans-serif';
      ctx.textAlign    = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('✓ スキル取得！', CANVAS_W / 2, botY);
    }

    // Next Wave / Next Stage button
    const isLastWave = gm._nextWaveIdx === -1;
    const nby = botY + 26;
    const nbx = CANVAS_W / 2 - 120;
    ctx.fillStyle = isLastWave ? '#E67E22' : '#2ECC71';
    ctx.beginPath(); ctx.roundRect(nbx, nby, 240, 56, 14); ctx.fill();
    ctx.fillStyle    = '#FFF';
    ctx.font         = 'bold 19px sans-serif';
    ctx.textAlign    = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(isLastWave ? '次のSTAGEへ →' : '次のWAVEへ →', CANVAS_W / 2, nby + 28);
    ctx.fillStyle = COLORS.UI_DIM; ctx.font = '12px sans-serif';
    if (isLastWave) {
      ctx.fillText(`STAGE ${gm.stageIndex + 2}`, CANVAS_W / 2, nby + 68);
    } else {
      ctx.fillText(`WAVE ${gm.waveIndex + 1} → ${(gm._nextWaveIdx || 0) + 1}`, CANVAS_W / 2, nby + 68);
    }

    // Share button
    const sby = nby + 56 + 18;
    ctx.fillStyle = '#1A5276';
    ctx.beginPath(); ctx.roundRect(CANVAS_W / 2 - 100, sby, 200, 44, 12); ctx.fill();
    ctx.strokeStyle = '#2E86C1';
    ctx.lineWidth   = 1.5;
    ctx.beginPath(); ctx.roundRect(CANVAS_W / 2 - 100, sby, 200, 44, 12); ctx.stroke();
    ctx.fillStyle    = '#FFF';
    ctx.font         = 'bold 15px sans-serif';
    ctx.textAlign    = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('📤 結果をシェア', CANVAS_W / 2, sby + 22);
  }

  _drawSkillColumn(cx, cy, w, h, skill, catMeta, isRare, level, cost, canBuy, shopDone) {
    const { ctx } = this;

    ctx.fillStyle = catMeta.color;
    ctx.beginPath(); ctx.roundRect(cx, cy, w, 28, [8, 8, 0, 0]); ctx.fill();
    ctx.fillStyle    = '#FFF';
    ctx.font         = 'bold 11px sans-serif';
    ctx.textAlign    = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(`${catMeta.symbol} ${catMeta.label}`, cx + w / 2, cy + 14);

    const cardY = cy + 28;
    const cardH = h - 28;
    ctx.fillStyle = shopDone && !canBuy ? '#0e1020' : (canBuy ? '#1a2540' : '#111825');
    ctx.beginPath(); ctx.roundRect(cx, cardY, w, cardH, [0, 0, 8, 8]); ctx.fill();

    if (isRare) {
      ctx.save();
      ctx.shadowColor = '#FFD700'; ctx.shadowBlur = 10;
      ctx.strokeStyle = '#FFD700'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.roundRect(cx, cardY, w, cardH, [0, 0, 8, 8]); ctx.stroke();
      ctx.restore();
    } else {
      ctx.strokeStyle = canBuy ? catMeta.color + '66' : '#2a2a3a';
      ctx.lineWidth   = 1;
      ctx.beginPath(); ctx.roundRect(cx, cardY, w, cardH, [0, 0, 8, 8]); ctx.stroke();
    }

    const midX = cx + w / 2;
    let   iy   = cardY + 10;

    if (isRare) {
      ctx.save();
      ctx.fillStyle = '#FFD700';
      ctx.beginPath(); ctx.roundRect(midX - 22, iy, 44, 16, 5); ctx.fill();
      ctx.fillStyle    = '#000';
      ctx.font         = 'bold 9px sans-serif';
      ctx.textAlign    = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('★ RARE', midX, iy + 8);
      ctx.restore();
      iy += 20;
    }

    ctx.fillStyle    = canBuy ? '#FFF' : '#555';
    ctx.font         = 'bold 11px sans-serif';
    ctx.textAlign    = 'center'; ctx.textBaseline = 'top';
    this._wrapTextTop(skill.label, midX, iy, w - 6, 13);
    iy += 16;

    if (level > 0) {
      for (let l = 0; l < Math.min(level, 5); l++) {
        ctx.fillStyle = isRare ? '#FFD700' : catMeta.color;
        ctx.beginPath();
        ctx.arc(midX - (Math.min(level, 5) - 1) * 4 + l * 8, iy + 4, 3, 0, Math.PI * 2);
        ctx.fill();
      }
      iy += 14;
    }

    ctx.fillStyle    = canBuy ? '#999' : '#444';
    ctx.font         = '9px sans-serif';
    ctx.textAlign    = 'center'; ctx.textBaseline = 'top';
    for (const line of skill.desc.split('\n')) {
      this._wrapTextTop(line, midX, iy, w - 6, 11);
      iy += 11;
    }

    ctx.fillStyle    = canBuy ? '#FFD700' : '#444';
    ctx.font         = `bold ${isRare ? 11 : 10}px sans-serif`;
    ctx.textAlign    = 'center'; ctx.textBaseline = 'bottom';
    ctx.fillText(`${cost.toLocaleString()}pt`, midX, cardY + cardH - 5);
  }

  _wrapTextTop(text, cx, y, maxWidth, lineH) {
    const { ctx } = this;
    let line = '';
    for (const ch of text) {
      const test = line + ch;
      if (ctx.measureText(test).width > maxWidth && line !== '') {
        ctx.fillText(line, cx, y); line = ch; y += lineH;
      } else { line = test; }
    }
    ctx.fillText(line, cx, y);
  }

  // ── Game clear ────────────────────────────────────────────────────────────

  _gameClearLayout(gm) {
    const base = 248, btnH = 52, gap = 14;
    let y = base;
    const shareY = y; y += btnH + gap;
    const nextY  = gm.canContinue ? y : null;
    if (gm.canContinue) y += btnH + gap;
    const titleY = y;
    return { shareY, nextY, titleY };
  }

  _drawGameClear(gm) {
    const { ctx } = this;
    const diffCfg = DIFFICULTY_CONFIG[gm.difficulty];

    ctx.fillStyle = 'rgba(10,8,20,0.97)';
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

    // Gold top bar
    const grad = ctx.createLinearGradient(0, 0, CANVAS_W, 0);
    grad.addColorStop(0, 'transparent');
    grad.addColorStop(0.5, 'rgba(255,215,0,0.5)');
    grad.addColorStop(1, 'transparent');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, CANVAS_W, 5);

    // Title
    ctx.save();
    ctx.shadowColor = '#FFD700';
    ctx.shadowBlur  = 22;
    ctx.fillStyle   = '#FFD700';
    ctx.font        = 'bold 42px sans-serif';
    ctx.textAlign   = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('🎉 GAME CLEAR!', CANVAS_W / 2, 62);
    ctx.restore();

    // Cycle label
    ctx.fillStyle    = COLORS.UI_TEXT;
    ctx.font         = 'bold 20px sans-serif';
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(`${gm.clearCycles}周目クリア！`, CANVAS_W / 2, 108);

    // Difficulty + stage badge
    ctx.fillStyle = diffCfg.color;
    ctx.font      = 'bold 14px sans-serif';
    ctx.fillText(`${diffCfg.label}  STAGE ${gm.stageIndex + 1}`, CANVAS_W / 2, 136);

    // Score
    ctx.fillStyle = '#FFD700';
    ctx.font      = 'bold 42px sans-serif';
    ctx.fillText(gm.score.toLocaleString(), CANVAS_W / 2, 188);
    ctx.fillStyle = COLORS.UI_DIM;
    ctx.font      = '14px sans-serif';
    ctx.fillText('FINAL SCORE', CANVAS_W / 2, 216);

    const layout = this._gameClearLayout(gm);
    const bx = CANVAS_W / 2 - 120;
    const bw = 240;

    // Share button
    ctx.fillStyle = '#1A5276';
    ctx.beginPath(); ctx.roundRect(bx, layout.shareY, bw, 52, 14); ctx.fill();
    ctx.strokeStyle = '#2E86C1'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.roundRect(bx, layout.shareY, bw, 52, 14); ctx.stroke();
    ctx.fillStyle = '#FFF'; ctx.font = 'bold 17px sans-serif'; ctx.textBaseline = 'middle';
    ctx.fillText('📤 結果をシェア', CANVAS_W / 2, layout.shareY + 26);

    // N周目へ button
    if (gm.canContinue) {
      ctx.fillStyle = '#E67E22';
      ctx.beginPath(); ctx.roundRect(bx, layout.nextY, bw, 52, 14); ctx.fill();
      ctx.fillStyle = '#FFF'; ctx.font = 'bold 17px sans-serif';
      ctx.fillText(`${gm.clearCycles + 1}周目へ →`, CANVAS_W / 2, layout.nextY + 26);
    }

    // Title button
    ctx.fillStyle = '#2C3E50';
    ctx.beginPath(); ctx.roundRect(bx, layout.titleY, bw, 52, 14); ctx.fill();
    ctx.fillStyle = '#FFF'; ctx.font = 'bold 17px sans-serif';
    ctx.fillText('タイトルに戻る', CANVAS_W / 2, layout.titleY + 26);
  }

  // ── Pause overlay ────────────────────────────────────────────────────────

  _drawPauseOverlay() {
    const { ctx } = this;
    ctx.fillStyle = 'rgba(0,0,0,0.58)';
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

    ctx.textAlign    = 'center';
    ctx.textBaseline = 'middle';

    ctx.fillStyle = 'rgba(255,255,255,0.90)';
    ctx.font      = '72px sans-serif';
    ctx.fillText('⏸', CANVAS_W / 2, CANVAS_H / 2 - 44);

    ctx.font      = 'bold 38px sans-serif';
    ctx.fillText('PAUSE', CANVAS_W / 2, CANVAS_H / 2 + 18);

    ctx.fillStyle = 'rgba(255,255,255,0.45)';
    ctx.font      = '16px sans-serif';
    ctx.fillText('タップして再開', CANVAS_W / 2, CANVAS_H / 2 + 64);

    // タイトルへボタン
    const tbx = CANVAS_W / 2 - 90, tby = CANVAS_H / 2 + 100;
    ctx.save();
    ctx.globalAlpha = 0.82;
    ctx.fillStyle   = '#444';
    ctx.beginPath(); ctx.roundRect(tbx, tby, 180, 44, 12); ctx.fill();
    ctx.restore();
    ctx.fillStyle = 'rgba(255,255,255,0.80)';
    ctx.font      = 'bold 16px sans-serif';
    ctx.fillText('タイトルへ', CANVAS_W / 2, tby + 22);
  }

  // ── Difficulty select ─────────────────────────────────────────────────────

  _drawDifficultySelect() {
    const { ctx } = this;
    ctx.fillStyle = COLORS.BG;
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

    const t = Date.now() / 1000;
    const orbAttrs = [ATTR.ROCK, ATTR.SCISSORS, ATTR.PAPER];
    const orbPos   = [60, CANVAS_W / 2, CANVAS_W - 60];
    for (let i = 0; i < 3; i++) {
      const ox = orbPos[i], oy = 90 + Math.sin(t * 1.4 + i * 2) * 10, r = 22;
      const g  = ctx.createRadialGradient(ox, oy, r * 0.1, ox, oy, r * 2);
      g.addColorStop(0, ATTR_COLOR[orbAttrs[i]] + '40'); g.addColorStop(1, 'transparent');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(ox, oy, r * 2, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = ATTR_COLOR[orbAttrs[i]] + '80'; ctx.beginPath(); ctx.arc(ox, oy, r, 0, Math.PI * 2); ctx.fill();
    }

    ctx.fillStyle = '#FFF'; ctx.font = 'bold 28px sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('難易度を選択', CANVAS_W / 2, 140);
    ctx.fillStyle = COLORS.UI_DIM; ctx.font = '13px sans-serif';
    ctx.fillText('ゲームスピード & スコア倍率', CANVAS_W / 2, 170);

    const diffs  = [DIFFICULTY.EASY, DIFFICULTY.NORMAL, DIFFICULTY.HARD, DIFFICULTY.MERCILESS];
    const mults  = ['×1.0', '×1.5', '×2.0', '×3.0'];
    const btnW   = 280, btnH = 68, gap = 14;
    const startX = (CANVAS_W - btnW) / 2, startY = 200;

    for (let i = 0; i < 4; i++) {
      const cfg = DIFFICULTY_CONFIG[diffs[i]];
      const bx  = startX, by = startY + i * (btnH + gap);
      ctx.save(); ctx.globalAlpha = 0.92; ctx.fillStyle = cfg.color;
      ctx.beginPath(); ctx.roundRect(bx, by, btnW, btnH, 14); ctx.fill(); ctx.restore();
      ctx.fillStyle = '#FFF'; ctx.font = 'bold 22px sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(cfg.label, CANVAS_W / 2, by + btnH / 2 - 9);
      ctx.fillStyle = 'rgba(255,255,255,0.7)'; ctx.font = '14px sans-serif';
      ctx.fillText(mults[i], CANVAS_W / 2, by + btnH / 2 + 15);
    }

    ctx.fillStyle = COLORS.UI_DIM; ctx.font = '12px sans-serif';
    ctx.fillText('被弾するとスコアが減少。0以下でゲームオーバー', CANVAS_W / 2, CANVAS_H - 30);
  }

  // ── Game over ─────────────────────────────────────────────────────────────

  _drawGameOver(gm) {
    const { ctx } = this;
    ctx.fillStyle = 'rgba(0,0,0,0.80)'; ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
    const cy = CANVAS_H / 2;
    ctx.fillStyle = '#E74C3C'; ctx.font = 'bold 50px sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('GAME OVER', CANVAS_W / 2, cy - 70);
    ctx.fillStyle = COLORS.UI_TEXT; ctx.font = 'bold 38px sans-serif';
    ctx.fillText(gm.score.toLocaleString(), CANVAS_W / 2, cy);
    ctx.fillStyle = COLORS.UI_DIM; ctx.font = '16px sans-serif';
    ctx.fillText('FINAL SCORE', CANVAS_W / 2, cy + 34);
    ctx.fillStyle = '#3498DB';
    ctx.beginPath(); ctx.roundRect(CANVAS_W / 2 - 110, cy + 72, 220, 58, 29); ctx.fill();
    ctx.fillStyle = '#FFF'; ctx.font = 'bold 22px sans-serif';
    ctx.fillText('難易度選択へ戻る', CANVAS_W / 2, cy + 101);
  }

  // ── Title screen ──────────────────────────────────────────────────────────

  _drawTitle(gm) {
    const { ctx } = this;
    const t = Date.now() / 1000;
    ctx.fillStyle = COLORS.BG; ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

    // ── ボールアニメーション ──────────────────────────────────────────────────
    const positions = [CANVAS_W / 2 - 90, CANVAS_W / 2, CANVAS_W / 2 + 90];
    const attrs     = [ATTR.ROCK, ATTR.SCISSORS, ATTR.PAPER];
    for (let i = 0; i < 3; i++) {
      const ox = positions[i], oy = CANVAS_H / 2 - 40 + Math.sin(t * 1.6 + i * 2.1) * 16;
      const color = ATTR_COLOR[attrs[i]], r = 36;
      const g = ctx.createRadialGradient(ox, oy, r * 0.1, ox, oy, r * 2);
      g.addColorStop(0, color + '50'); g.addColorStop(1, 'transparent');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(ox, oy, r * 2, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = color; ctx.beginPath(); ctx.arc(ox, oy, r, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#FFF'; ctx.font = `${r}px sans-serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(ATTR_SYMBOL[attrs[i]], ox, oy + 2);
    }

    // ── タイトルロゴ ──────────────────────────────────────────────────────────
    ctx.fillStyle = '#FFF'; ctx.font = 'bold 32px sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('じゃんけんサバイバー', CANVAS_W / 2, CANVAS_H / 2 - 130);
    ctx.fillStyle = COLORS.UI_DIM; ctx.font = '14px sans-serif';
    ctx.fillText('JMP: Janken Match Puzzle', CANVAS_W / 2, CANVAS_H / 2 - 100);

    // ── Auth UI ───────────────────────────────────────────────────────────────
    const pulse = 0.85 + 0.15 * Math.sin(t * 3);

    if (!auth.isLoggedIn) {
      // 未ログイン: スタートボタン + ログインボタン
      const sbx = CANVAS_W / 2 - 130, sby = CANVAS_H / 2 + 40;
      ctx.save(); ctx.globalAlpha = pulse; ctx.fillStyle = '#2ECC71';
      ctx.beginPath(); ctx.roundRect(sbx, sby, 260, 60, 30); ctx.fill(); ctx.restore();
      ctx.fillStyle = '#FFF'; ctx.font = 'bold 24px sans-serif';
      ctx.fillText('タップしてはじめる', CANVAS_W / 2, sby + 30);

      // ログインボタン
      const lbx = CANVAS_W / 2 - 110, lby = sby + 72;
      ctx.fillStyle = 'rgba(255,255,255,0.12)';
      ctx.beginPath(); ctx.roundRect(lbx, lby, 220, 46, 23); ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.roundRect(lbx, lby, 220, 46, 23); ctx.stroke();
      ctx.fillStyle = '#FFF'; ctx.font = 'bold 15px sans-serif';
      ctx.fillText('🔑 Googleでログイン', CANVAS_W / 2, lby + 23);

      ctx.fillStyle = COLORS.UI_DIM; ctx.font = '11px sans-serif';
      ctx.fillText('ログインするとセーブ機能が使えます', CANVAS_W / 2, lby + 56);

    } else if (savedata.isLoading) {
      // ログイン済み・セーブ確認中
      const sbx = CANVAS_W / 2 - 130, sby = CANVAS_H / 2 + 40;
      ctx.fillStyle = 'rgba(255,255,255,0.15)';
      ctx.beginPath(); ctx.roundRect(sbx, sby, 260, 60, 30); ctx.fill();
      ctx.fillStyle = COLORS.UI_DIM; ctx.font = '16px sans-serif';
      ctx.fillText('セーブデータを確認中...', CANVAS_W / 2, sby + 30);
      this._drawTitleUserChip(sby + 80);

    } else if (savedata.hasSave) {
      // ログイン済み・セーブあり: 続きから / 最初から
      const cby = CANVAS_H / 2 + 35;
      ctx.save(); ctx.globalAlpha = pulse; ctx.fillStyle = '#2ECC71';
      ctx.beginPath(); ctx.roundRect(CANVAS_W / 2 - 130, cby, 260, 62, 31); ctx.fill(); ctx.restore();
      ctx.fillStyle = '#FFF'; ctx.font = 'bold 24px sans-serif';
      ctx.fillText('続きから', CANVAS_W / 2, cby + 31);

      const save = savedata.current;
      const diffCfg = DIFFICULTY_CONFIG[save.difficulty];
      ctx.fillStyle = diffCfg?.color ?? '#AAA'; ctx.font = '12px sans-serif';
      ctx.fillText(`${diffCfg?.label ?? save.difficulty}  STAGE ${save.stageIndex + 1} WAVE ${save.waveIndex + 1}  ${save.score.toLocaleString()}pt`, CANVAS_W / 2, cby + 52);

      const nby = cby + 68;
      ctx.fillStyle = 'rgba(255,255,255,0.13)';
      ctx.beginPath(); ctx.roundRect(CANVAS_W / 2 - 110, nby, 220, 44, 22); ctx.fill();
      ctx.fillStyle = COLORS.UI_DIM; ctx.font = 'bold 15px sans-serif';
      ctx.fillText('最初から', CANVAS_W / 2, nby + 22);

      this._drawTitleUserChip(nby + 62);

    } else {
      // ログイン済み・セーブなし
      const sbx = CANVAS_W / 2 - 130, sby = CANVAS_H / 2 + 40;
      ctx.save(); ctx.globalAlpha = pulse; ctx.fillStyle = '#2ECC71';
      ctx.beginPath(); ctx.roundRect(sbx, sby, 260, 60, 30); ctx.fill(); ctx.restore();
      ctx.fillStyle = '#FFF'; ctx.font = 'bold 24px sans-serif';
      ctx.fillText('タップしてはじめる', CANVAS_W / 2, sby + 30);
      this._drawTitleUserChip(sby + 72);
    }

    ctx.fillStyle = COLORS.UI_DIM; ctx.font = '13px sans-serif';
    ctx.fillText('Rock · Scissors · Paper — Survive!', CANVAS_W / 2, CANVAS_H - 46);
    ctx.fillStyle = 'rgba(255,255,255,0.25)'; ctx.font = '11px sans-serif';
    ctx.fillText(VERSION, CANVAS_W / 2, CANVAS_H - 24);
  }

  // ── ユーザーチップ（ログイン名 + ログアウトボタン）────────────────────────
  _drawTitleUserChip(y) {
    const { ctx } = this;
    const name = auth.displayName;
    ctx.fillStyle = COLORS.UI_DIM; ctx.font = '12px sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(`✅ ${name}`, CANVAS_W / 2 - 28, y);
    // ログアウトボタン
    const lox = CANVAS_W / 2 + 52, loy = y;
    ctx.fillStyle = 'rgba(255,255,255,0.10)';
    ctx.beginPath(); ctx.roundRect(lox - 28, loy - 12, 56, 24, 12); ctx.fill();
    ctx.fillStyle = '#FF6B6B'; ctx.font = '11px sans-serif';
    ctx.fillText('ログアウト', lox, loy);
  }

  // ── Hit-testing helpers ───────────────────────────────────────────────────

  isGameClearShareBtn(cx, cy, gm) {
    const { shareY } = this._gameClearLayout(gm);
    return cx >= CANVAS_W / 2 - 120 && cx <= CANVAS_W / 2 + 120 &&
           cy >= shareY && cy <= shareY + 52;
  }

  isGameClearNextBtn(cx, cy, gm) {
    const { nextY } = this._gameClearLayout(gm);
    if (nextY === null) return false;
    return cx >= CANVAS_W / 2 - 120 && cx <= CANVAS_W / 2 + 120 &&
           cy >= nextY && cy <= nextY + 52;
  }

  isGameClearTitleBtn(cx, cy, gm) {
    const { titleY } = this._gameClearLayout(gm);
    return cx >= CANVAS_W / 2 - 120 && cx <= CANVAS_W / 2 + 120 &&
           cy >= titleY && cy <= titleY + 52;
  }

  isPauseBtn(cx, cy) {
    return cx >= CANVAS_W - 44 && cy <= 30;
  }

  // Hit-test for the "WAVE N / M" text in the HUD (debug skip trigger)
  isWaveTextArea(cx, cy) {
    return cx >= CANVAS_W / 2 - 75 && cx <= CANVAS_W / 2 + 75 &&
           cy >= 5 && cy <= 45;
  }

  // WAVE_RESULT 画面右上「🔑 ログインでセーブ」ボタン
  isShopLoginBtn(cx, cy) {
    return !auth.isLoggedIn &&
           cx >= CANVAS_W - 160 && cx <= CANVAS_W &&
           cy >= 0 && cy <= 26;
  }

  isShareBtn(cx, cy) {
    const nby = 108 + 200 + 12 + 26;  // gridY + cardH + 12 + 26
    const sby = nby + 56 + 18;
    return cx >= CANVAS_W / 2 - 100 && cx <= CANVAS_W / 2 + 100 &&
           cy >= sby && cy <= sby + 44;
  }

  isBombBtn(cx, cy) {
    const btnY = CANVAS_H - BTN_AREA_H;
    return cx >= 4 && cx <= CANVAS_W / 2 - 4 &&
           cy >= btnY + 4 && cy <= btnY + 36;
  }

  isShieldBtn(cx, cy) {
    const btnY = CANVAS_H - BTN_AREA_H;
    return cx >= CANVAS_W / 2 + 4 && cx <= CANVAS_W - 4 &&
           cy >= btnY + 4 && cy <= btnY + 36;
  }

  isPauseTitleBtn(cx, cy) {
    const tby = CANVAS_H / 2 + 100;
    return cx >= CANVAS_W / 2 - 90 && cx <= CANVAS_W / 2 + 90 &&
           cy >= tby && cy <= tby + 44;
  }

  getButtonIndex(cx, cy) {
    const attrAreaY = CANVAS_H - BTN_AREA_H + 38;
    if (cy < attrAreaY || cy > CANVAS_H) return -1;
    return Math.floor(cx / (CANVAS_W / 3));
  }

  getDifficultyBtnIndex(cx, cy) {
    const btnW = 280, btnH = 68, gap = 14;
    const startX = (CANVAS_W - btnW) / 2, startY = 200;
    if (cx < startX || cx > startX + btnW) return -1;
    for (let i = 0; i < 4; i++) {
      const by = startY + i * (btnH + gap);
      if (cy >= by && cy <= by + btnH) return i;
    }
    return -1;
  }

  getSkillCardId(cx, cy, offeredSkills) {
    if (!offeredSkills || offeredSkills.length === 0) return null;
    const numCols = 4, pad = 6, gapX = 5;
    const colW    = Math.floor((CANVAS_W - pad * 2 - gapX * (numCols - 1)) / numCols);
    const cardH   = 200, gridY = 108;
    for (let i = 0; i < 4 && i < offeredSkills.length; i++) {
      const bx = pad + i * (colW + gapX);
      if (cx >= bx && cx <= bx + colW && cy >= gridY && cy <= gridY + cardH) {
        return offeredSkills[i].id;
      }
    }
    return null;
  }

  isNextWaveBtn(cx, cy) {
    const botY = 108 + 200 + 12 + 26;
    const nbx  = CANVAS_W / 2 - 120;
    return cx >= nbx && cx <= nbx + 240 && cy >= botY && cy <= botY + 56;
  }

  isRetryBtn(cx, cy) {
    const cy2 = CANVAS_H / 2;
    return cx >= CANVAS_W / 2 - 110 && cx <= CANVAS_W / 2 + 110 &&
           cy >= cy2 + 72 && cy <= cy2 + 130;
  }

  // ── タイトル画面ヒットテスト ─────────────────────────────────────────────
  isTitleStart(cx, cy) {
    // ログイン済み・セーブなし or 未ログイン: "タップしてはじめる"
    if (auth.isLoggedIn && savedata.hasSave) return false;
    if (savedata.isLoading) return false;
    const sby = CANVAS_H / 2 + 40;
    return cy >= sby && cy <= sby + 60;
  }

  isTitleLoginBtn(cx, cy) {
    if (auth.isLoggedIn) return false;
    const sby = CANVAS_H / 2 + 40;
    const lby = sby + 72;
    return cx >= CANVAS_W / 2 - 110 && cx <= CANVAS_W / 2 + 110 &&
           cy >= lby && cy <= lby + 46;
  }

  isTitleContinueBtn(cx, cy) {
    if (!auth.isLoggedIn || !savedata.hasSave || savedata.isLoading) return false;
    const cby = CANVAS_H / 2 + 35;
    return cx >= CANVAS_W / 2 - 130 && cx <= CANVAS_W / 2 + 130 &&
           cy >= cby && cy <= cby + 62;
  }

  isTitleNewGameBtn(cx, cy) {
    if (!auth.isLoggedIn || !savedata.hasSave || savedata.isLoading) return false;
    const cby = CANVAS_H / 2 + 35;
    const nby = cby + 68;
    return cx >= CANVAS_W / 2 - 110 && cx <= CANVAS_W / 2 + 110 &&
           cy >= nby && cy <= nby + 44;
  }

  isTitleLogoutBtn(cx, cy) {
    if (!auth.isLoggedIn) return false;
    // ユーザーチップのログアウトボタン位置
    const hasSave = savedata.hasSave && !savedata.isLoading;
    const base = hasSave ? CANVAS_H / 2 + 35 + 68 + 44 + 20 + 12
                         : CANVAS_H / 2 + 40 + 60 + 12;
    const lox  = CANVAS_W / 2 + 52;
    return cx >= lox - 28 && cx <= lox + 28 &&
           cy >= base - 12 && cy <= base + 12;
  }
}
