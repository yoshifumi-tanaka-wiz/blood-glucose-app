(function () {
  'use strict';

  const TOKEN_KEY = 'bg_token';

  class ApiError extends Error {
    constructor(msg, code) { super(msg); this.code = code; }
  }

  async function call(action, params) {
    const body = Object.assign({ action: action, token: U.store.get(TOKEN_KEY, '') }, params || {});
    let res;
    try {
      res = await fetch(window.APP_CONFIG.GAS_URL, {
        method: 'POST',
        // text/plain にすることでCORSのプリフライトを回避
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(body),
        redirect: 'follow',
      });
    } catch (e) {
      throw new ApiError('通信できませんでした。電波状況を確認してください', 'NETWORK');
    }
    let json;
    try { json = await res.json(); } catch (e) {
      throw new ApiError('サーバーの応答が正しくありません（GASのURL・デプロイ設定を確認してください）', 'BAD_RESPONSE');
    }
    if (!json.ok) {
      if (json.code === 'AUTH') {
        U.store.del(TOKEN_KEY);
        window.dispatchEvent(new CustomEvent('auth-required'));
      }
      throw new ApiError(json.error || 'エラーが発生しました', json.code);
    }
    return json;
  }

  window.API = {
    call,
    hasToken: () => !!U.store.get(TOKEN_KEY, ''),
    async login(passphrase) {
      const r = await call('login', { passphrase: passphrase, token: '' });
      U.store.set(TOKEN_KEY, r.token);
      return r;
    },
    async logout() {
      try { await call('logout'); } catch (e) { /* ignore */ }
      U.store.del(TOKEN_KEY);
    },
  };
})();
