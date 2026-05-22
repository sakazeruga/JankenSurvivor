import { supabase } from './supabase.js';
import { auth }     from './auth.js';

export const savedata = {
  _data:    undefined,  // undefined=未取得, null=セーブなし, object=セーブあり
  _loading: false,
  _saving:  false,

  get hasSave()   { return !!this._data; },
  get isLoading() { return this._loading; },
  get isSaving()  { return this._saving; },
  get current()   { return this._data; },

  // ── ログイン後にセーブデータを取得 ────────────────────────────────────────
  async fetchForUser() {
    if (!auth.isLoggedIn) { this._data = null; return; }
    this._loading = true;
    const { data, error } = await supabase
      .from('saves')
      .select('save_data')
      .eq('user_id', auth.user.id)
      .maybeSingle();
    this._loading = false;
    if (error) { console.error('[savedata] fetch error:', error); this._data = null; return; }
    this._data = data?.save_data ?? null;
  },

  // ── セーブ ───────────────────────────────────────────────────────────────
  async save(gm) {
    if (!auth.isLoggedIn) return false;
    this._saving = true;
    const target = gm.saveTarget;   // WAVE_RESULT中は次Wave/Stage、PLAYING中は現在地
    const payload = {
      version:         1,
      savedAt:         new Date().toISOString(),
      difficulty:      gm.difficulty,
      stageIndex:      target.stageIndex,
      waveIndex:       target.waveIndex,
      score:           gm.score,
      skills:          { ...gm.skills },
      columnPurchases: { ...gm.columnPurchases },
      bombsUsed:       gm.bombsUsed,
      shieldCharges:   gm.shieldCharges,
      clearCycles:     gm.clearCycles || 0,
    };
    const { error } = await supabase
      .from('saves')
      .upsert(
        { user_id: auth.user.id, save_data: payload, updated_at: new Date().toISOString() },
        { onConflict: 'user_id' }
      );
    this._saving = false;
    if (error) { console.error('[savedata] save error:', error); return false; }
    this._data = payload;
    return true;
  },

  // ── セーブ削除（ゲームオーバー / クリア後）────────────────────────────────
  async deleteSave() {
    if (!auth.isLoggedIn) return;
    const { error } = await supabase
      .from('saves')
      .delete()
      .eq('user_id', auth.user.id);
    if (error) console.error('[savedata] delete error:', error);
    this._data = null;
  },
};
