import { ATTR, DIFFICULTY, AUDIO } from './constants.js';
import { GameState } from './game.js';
import { audio } from './audio.js';

const BTN_ATTRS    = [ATTR.ROCK, ATTR.SCISSORS, ATTR.PAPER];
const DIFFICULTIES = [DIFFICULTY.EASY, DIFFICULTY.NORMAL, DIFFICULTY.HARD, DIFFICULTY.MERCILESS];

export function setupInput(canvas, gm, renderer) {
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

    if (gm.state === GameState.WAVE_RESULT) {
      if (renderer.isNextWaveBtn(x, y)) {
        gm.advanceFromShop();
        return;
      }
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
