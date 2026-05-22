import { ATTR, DIFFICULTY, AUDIO } from './constants.js';
import { GameState } from './game.js';
import { audio }     from './audio.js';
import { auth }      from './auth.js';
import { savedata }  from './savedata.js';

const BTN_ATTRS    = [ATTR.ROCK, ATTR.SCISSORS, ATTR.PAPER];
const DIFFICULTIES = [DIFFICULTY.EASY, DIFFICULTY.NORMAL, DIFFICULTY.HARD, DIFFICULTY.MERCILESS];

async function doShare(gm) {
  const isGameClear = gm.state === GameState.GAME_CLEAR;
  const header = isGameClear
    ? `🎉 GAME CLEAR！STAGE ${gm.stageIndex + 1} 完全クリア`
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
    audio.unlock();
    const { x, y } = scaledPos(clientX, clientY);

    // ── タイトル画面 ────────────────────────────────────────────────────────
    if (gm.state === GameState.TITLE) {
      // ログアウト
      if (renderer.isTitleLogoutBtn(x, y)) { auth.logout(); return; }
      // 続きから（セーブあり）
      if (renderer.isTitleContinueBtn(x, y)) {
        if (savedata.current) gm.loadFromSave(savedata.current);
        return;
      }
      // 最初から（セーブあり・新規開始）
      if (renderer.isTitleNewGameBtn(x, y)) {
        savedata.deleteSave();
        gm.selectDifficulty();
        return;
      }
      // Googleログイン
      if (renderer.isTitleLoginBtn(x, y)) { auth.loginWithGoogle(); return; }
      // 通常スタート（未ログイン or セーブなし）
      if (renderer.isTitleStart(x, y)) { gm.selectDifficulty(); return; }
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
      if (renderer.isGameOverLoadBtn(x, y)) {
        gm.loadFromSave(savedata.current);
        return;
      }
      if (renderer.isRetryBtn(x, y)) {
        savedata.deleteSave();
        gm.selectDifficulty();
      }
      return;
    }

    if (gm.state === GameState.GAME_CLEAR) {
      if (renderer.isGameClearShareBtn(x, y)) { doShare(gm);    return; }
      if (renderer.isGameClearTitleBtn(x, y)) { gm.goToTitle(); return; }
      return;
    }

    // ── スキルショップ ──────────────────────────────────────────────────────
    if (gm.state === GameState.WAVE_RESULT) {
      if (renderer.isNextWaveBtn(x, y)) {
        gm.advanceFromShop();
        savedata.save(gm);  // 次のWave開始状態をセーブ（fire & forget）
        return;
      }
      if (renderer.isShareBtn(x, y)) { doShare(gm); return; }
      if (renderer.isShopLoginBtn(x, y)) { auth.loginWithGoogle(); return; }
      const skillId = renderer.getSkillCardId(x, y, gm.offeredSkills);
      if (skillId) {
        gm.selectSkill(skillId);
        savedata.save(gm);  // スキル選択後に再セーブ（スキルを含む状態で保存）
      }
      return;
    }

    if (gm.state === GameState.PAUSED) {
      if (renderer.isPauseTitleBtn(x, y)) { gm.goToTitle(); return; }
      gm.togglePause();
      return;
    }

    if (gm.state === GameState.PLAYING) {
      if (renderer.isPauseBtn(x, y))   { gm.togglePause();    return; }
      if (renderer.isBombBtn(x, y))    { gm.activateBomb();   return; }
      if (renderer.isShieldBtn(x, y))  { gm.activateShield(); return; }

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
        return;
      }

      const idx = renderer.getButtonIndex(x, y);
      if (idx >= 0) gm.fireBullet(BTN_ATTRS[(gm.buttonOrder || [0, 1, 2])[idx]]);
    }
  }

  canvas.addEventListener('click', e => onTap(e.clientX, e.clientY));
  canvas.addEventListener('touchstart', e => {
    e.preventDefault();
    onTap(e.changedTouches[0].clientX, e.changedTouches[0].clientY);
  }, { passive: false });
}
