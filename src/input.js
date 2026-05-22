import { ATTR, DIFFICULTY, AUDIO } from './constants.js';
import { GameState } from './game.js';
import { audio } from './audio.js';

const BTN_ATTRS    = [ATTR.ROCK, ATTR.SCISSORS, ATTR.PAPER];
const DIFFICULTIES = [DIFFICULTY.EASY, DIFFICULTY.NORMAL, DIFFICULTY.HARD, DIFFICULTY.MERCILESS];

async function doShare(gm) {
  const isGameClear = gm.state === GameState.GAME_CLEAR;
  const header = isGameClear
    ? `🎉 GAME CLEAR！${gm.clearCycles}周目クリア`
    : `STAGE ${gm.stageIndex + 1}  ${gm._nextWaveIdx === -1 ? 'STAGE CLEAR!' : `WAVE ${gm.waveIndex + 1} クリア`}`;
  const lines = [
    'じゃんけんサバイバーで遊んでます！',
    header,
    `スコア: ${gm.score.toLocaleString()}pt`,
    '#じゃんけんサバイバー',
  ];
  const text = lines.join('\n');
  if (navigator.share) {
    try { await navigator.share({ text }); } catch (_) {}
  } else if (navigator.clipboard) {
    try {
      await navigator.clipboard.writeText(text);
      audio.playSfx(AUDIO.SFX_POWERUP);
    } catch (_) {}
  }
}

export function setupInput(canvas, gm, renderer) {
  // ── Debug skip: tap WAVE text 5× within 2 s ──────────────────────────────
  let waveClickCount = 0;
  let waveClickTimer = 0;

  function scaledPos(clientX, clientY) {
    const rect   = canvas.getBoundingClientRect();
    const scaleX = canvas.width  / rect.width;
    const scaleY = canvas.height / rect.height;
    return { x: (clientX - rect.left) * scaleX, y: (clientY - rect.top) * scaleY };
  }

  function onTap(clientX, clientY) {
    // Unblock title BGM (and any BGM) on first user interaction
    audio.unlock();

    const { x, y } = scaledPos(clientX, clientY);

    if (gm.state === GameState.TITLE) {
      if (renderer.isTitleStart(x, y)) gm.selectDifficulty();
      return;
    }

    if (gm.state === GameState.DIFFICULTY_SELECT) {
      const idx = renderer.getDifficultyBtnIndex(x, y);
      if (idx >= 0) {
        audio.playSfx(AUDIO.SFX_SELECT);
        gm.startGame(DIFFICULTIES[idx]);
      }
      return;
    }

    if (gm.state === GameState.GAME_OVER) {
      if (renderer.isRetryBtn(x, y)) gm.selectDifficulty();
      return;
    }

    if (gm.state === GameState.GAME_CLEAR) {
      if (renderer.isGameClearShareBtn(x, y, gm)) { doShare(gm);            return; }
      if (renderer.isGameClearNextBtn(x, y, gm))  { gm.startNextCycle();    return; }
      if (renderer.isGameClearTitleBtn(x, y, gm)) { gm.goToTitle();         return; }
      return;
    }

    if (gm.state === GameState.WAVE_RESULT) {
      if (renderer.isNextWaveBtn(x, y)) { gm.advanceFromShop(); return; }
      if (renderer.isShareBtn(x, y))    { doShare(gm);          return; }
      const skillId = renderer.getSkillCardId(x, y, gm.offeredSkills);
      if (skillId) gm.selectSkill(skillId);
      return;
    }

    if (gm.state === GameState.PAUSED) {
      gm.togglePause();
      return;
    }

    if (gm.state === GameState.PLAYING) {
      if (renderer.isPauseBtn(x, y)) { gm.togglePause(); return; }
      if (renderer.isBombBtn(x, y))  { gm.activateBomb(); return; }

      // ── Debug skip: 5 rapid taps on WAVE text ──────────────────────────
      if (renderer.isWaveTextArea(x, y)) {
        const now = Date.now();
        if (now - waveClickTimer > 2000) waveClickCount = 0;
        waveClickCount++;
        waveClickTimer = now;
        if (waveClickCount >= 5) {
          waveClickCount = 0;
          gm.debugSkipWave();
          return;
        }
        return; // absorb tap so it doesn't also fire a bullet
      }

      const idx = renderer.getButtonIndex(x, y);
      if (idx >= 0) gm.fireBullet(BTN_ATTRS[idx]);
    }
  }

  canvas.addEventListener('click', e => onTap(e.clientX, e.clientY));
  canvas.addEventListener('touchstart', e => {
    e.preventDefault();
    onTap(e.changedTouches[0].clientX, e.changedTouches[0].clientY);
  }, { passive: false });
}
