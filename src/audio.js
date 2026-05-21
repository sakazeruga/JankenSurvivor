export class AudioManager {
  constructor() {
    this._bgm    = null;
    this._bgmUrl = null;
  }

  playBgm(url) {
    if (this._bgmUrl === url && this._bgm && !this._bgm.paused) return;
    if (this._bgm) { this._bgm.pause(); this._bgm = null; }
    this._bgmUrl = url;
    const bgm  = new Audio(url);
    bgm.loop   = true;
    bgm.volume = 0.5;
    bgm.play().catch(() => {
      // Blocked by browser autoplay policy — will retry on first user interaction
    });
    this._bgm = bgm;
  }

  // Call on every user interaction to unblock autoplay-gated BGM
  unlock() {
    if (this._bgm && this._bgm.paused && this._bgmUrl) {
      this._bgm.play().catch(() => {});
    }
  }

  pauseBgm() {
    if (this._bgm && !this._bgm.paused) this._bgm.pause();
  }

  resumeBgm() {
    if (this._bgm && this._bgm.paused && this._bgmUrl) {
      this._bgm.play().catch(() => {});
    }
  }

  stopBgm() {
    if (this._bgm) { this._bgm.pause(); this._bgm = null; }
    this._bgmUrl = null;
  }

  playSfx(url) {
    const sfx  = new Audio(url);
    sfx.volume = 0.75;
    sfx.play().catch(() => {});
  }
}

export const audio = new AudioManager();
