import { GameManager, GameState } from './game.js';
import { Renderer }    from './renderer.js';
import { setupInput }  from './input.js';
import { audio }       from './audio.js';
import { AUDIO }       from './constants.js';

const canvas   = document.getElementById('gameCanvas');
const gm       = new GameManager();
const renderer = new Renderer(canvas);

setupInput(canvas, gm, renderer);
window._gm = gm; window._renderer = renderer;  // debug

let lastTime    = performance.now();
let prevState   = null;
let prevBossKey = '';  // 'none' | 'boss' | 'grand'

function loop(now) {
  const dt = Math.min((now - lastTime) / 1000, 0.05);
  lastTime = now;

  gm.update(dt);

  // BGM management — skip while paused to preserve BGM continuity
  const hasGrandBoss = gm.state === GameState.PLAYING &&
    gm.enemies.some(e => e.isGrandBoss && e.alive && !e.exploding);
  const hasNormalBoss = !hasGrandBoss && gm.state === GameState.PLAYING &&
    gm.enemies.some(e => e.isBoss && e.alive && !e.exploding);
  const bossKey = hasGrandBoss ? 'grand' : hasNormalBoss ? 'boss' : 'none';

  if (gm.state !== GameState.PAUSED) {
    if (gm.state !== prevState || bossKey !== prevBossKey) {
      if (gm.state === GameState.TITLE || gm.state === GameState.DIFFICULTY_SELECT) {
        audio.playBgm(AUDIO.BGM_TITLE);
      } else if (gm.state === GameState.WAVE_RESULT) {
        audio.playBgm(AUDIO.BGM_TITLE);
      } else if (gm.state === GameState.PLAYING) {
        if (hasGrandBoss)       audio.playBgm(AUDIO.BGM_GRAND_BOSS);
        else if (hasNormalBoss) audio.playBgm(AUDIO.BGM_BOSS);
        else                    audio.playBgm(AUDIO.BGM_STAGE);
      } else if (gm.state === GameState.GAME_OVER) {
        audio.playBgm(AUDIO.BGM_GAME_OVER);
      } else if (gm.state === GameState.GAME_CLEAR) {
        audio.playBgm(AUDIO.BGM_GAME_CLEAR);
      }
      prevState   = gm.state;
      prevBossKey = bossKey;
    }
  }

  renderer.render(gm);
  requestAnimationFrame(loop);
}

requestAnimationFrame(loop);
