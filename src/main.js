import { GameManager, GameState } from './game.js';
import { Renderer }    from './renderer.js';
import { setupInput }  from './input.js';
import { audio }       from './audio.js';
import { AUDIO, LAST_STAGE_IDX } from './constants.js';
import { auth }        from './auth.js';
import { savedata }    from './savedata.js';

const canvas   = document.getElementById('gameCanvas');
const gm       = new GameManager();
const renderer = new Renderer(canvas);

setupInput(canvas, gm, renderer);
window._gm = gm; window._renderer = renderer;  // debug

// ── 裏画面に行ったら自動ポーズ ────────────────────────────────────────────
document.addEventListener('visibilitychange', () => {
  if (document.hidden && gm.state === GameState.PLAYING) gm.togglePause();
});

// ── Auth 初期化 ────────────────────────────────────────────────────────────
auth.init().then(() => {
  if (auth.isLoggedIn) savedata.fetchForUser();
});

auth.onChange(user => {
  if (user) {
    savedata.fetchForUser();
  } else {
    savedata._data = null;
  }
});

// ── ゲームループ ────────────────────────────────────────────────────────────
let lastTime    = performance.now();
let prevState   = null;
let prevBossKey = '';

function loop(now) {
  const dt = Math.min((now - lastTime) / 1000, 0.05);
  lastTime = now;

  gm.update(dt);

  // 状態遷移時の処理
  if (gm.state !== prevState) {
    if (gm.state === GameState.WAVE_RESULT) {
      savedata.save(gm);  // Waveクリア直後にセーブ（saveTargetで次Wave/Stageを指す）
    }
    if (gm.state === GameState.GAME_CLEAR) {
      savedata.deleteSave();
    }
  }

  // BGM 管理
  const _lbEnemy = gm.state === GameState.PLAYING
    ? gm.enemies.find(e => e.isLastBoss && e.alive && !e.exploding) : null;
  const hasLastBoss  = !!_lbEnemy;
  const lbPhaseKey   = hasLastBoss
    ? (_lbEnemy.lbFinalPhase ? 'p3' : `p${_lbEnemy.lastBossPhase}`) : '';

  const hasUltraBoss = !hasLastBoss && gm.state === GameState.PLAYING &&
    gm.enemies.some(e => e.isUltraBoss && e.alive && !e.exploding);
  const hasGrandBoss = !hasLastBoss && !hasUltraBoss && gm.state === GameState.PLAYING &&
    gm.enemies.some(e => e.isGrandBoss && e.alive && !e.exploding);
  const hasNormalBoss = !hasLastBoss && !hasUltraBoss && !hasGrandBoss && gm.state === GameState.PLAYING &&
    gm.enemies.some(e => e.isBoss && e.alive && !e.exploding);
  const bossKey = hasLastBoss ? `lb_${lbPhaseKey}`
    : hasUltraBoss ? 'ultra' : hasGrandBoss ? 'grand' : hasNormalBoss ? 'boss'
    : (gm.stageIndex === LAST_STAGE_IDX && gm.state === GameState.PLAYING ? 'last_stage' : 'none');

  if (gm.state !== GameState.PAUSED) {
    if (gm.state !== prevState || bossKey !== prevBossKey) {
      if (gm.state === GameState.TITLE || gm.state === GameState.DIFFICULTY_SELECT) {
        audio.playBgm(AUDIO.BGM_TITLE);
      } else if (gm.state === GameState.WAVE_RESULT) {
        audio.playBgm(AUDIO.BGM_TITLE);
      } else if (gm.state === GameState.PLAYING) {
        if (hasLastBoss) {
          if      (lbPhaseKey === 'p3') audio.playBgm(AUDIO.BGM_LAST_BOSS_P3);
          else if (lbPhaseKey === 'p2') audio.playBgm(AUDIO.BGM_LAST_BOSS_P2);
          else                          audio.playBgm(AUDIO.BGM_LAST_BOSS);
        } else if (hasUltraBoss)       audio.playBgm(AUDIO.BGM_ULTRA_BOSS);
        else if (hasGrandBoss)  audio.playBgm(AUDIO.BGM_GRAND_BOSS);
        else if (hasNormalBoss) audio.playBgm(AUDIO.BGM_BOSS);
        else if (gm.stageIndex === LAST_STAGE_IDX) audio.playBgm(AUDIO.BGM_LAST_STAGE);
        else                    audio.playBgm(AUDIO.BGM_STAGE);
      } else if (gm.state === GameState.GAME_OVER) {
        audio.playBgm(AUDIO.BGM_GAME_OVER);
      } else if (gm.state === GameState.GAME_CLEAR) {
        audio.playBgm(AUDIO.BGM_GAME_CLEAR);
      }
      prevBossKey = bossKey;
    }
  }

  prevState = gm.state;
  renderer.render(gm);
  requestAnimationFrame(loop);
}

requestAnimationFrame(loop);
