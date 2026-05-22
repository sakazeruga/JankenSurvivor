import { supabase } from './supabase.js';

export const auth = {
  user:       null,
  _listeners: [],

  async init() {
    // セッション復元（ページリロード / OAuth リダイレクト後）
    const { data: { session } } = await supabase.auth.getSession();
    this.user = session?.user ?? null;

    supabase.auth.onAuthStateChange((_event, session) => {
      this.user = session?.user ?? null;
      this._notify();
    });
  },

  onChange(fn)  { this._listeners.push(fn); },
  _notify()     { this._listeners.forEach(fn => fn(this.user)); },

  async loginWithGoogle() {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options:  { redirectTo: window.location.origin + window.location.pathname },
    });
    if (error) console.error('[auth] Google login error:', error);
  },

  async logout() {
    const { error } = await supabase.auth.signOut();
    if (error) console.error('[auth] Logout error:', error);
  },

  get isLoggedIn()   { return !!this.user; },
  get displayName()  {
    return this.user?.user_metadata?.full_name
        || this.user?.user_metadata?.name
        || this.user?.email
        || '';
  },
  get avatarUrl() {
    return this.user?.user_metadata?.avatar_url ?? null;
  },
};
