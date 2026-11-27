// mindmap-server（または同じ API を持つサーバー）につなぐ store。<mind-map> の store に渡す。
//
//   el.store = httpStore({ base: '/api/mindmap', name: 'daily-2026-11-27' });
//
// 使う API（base からの相対）:
//   GET  /map?name=     → マップの JSON と version（無ければ 404）
//   PUT  /map?name=     {baseVersion, map} → {version}。版が古ければ 409 と {map, version}
//   GET  /ws            WebSocket。{type: 'map', name, version, map} を受ける
//   GET  /unfurl?url=   リンクの題名など（無くてもよい）
// ログインはページ側（cookie など）に任せる。401 が返ったら onUnauthorized を呼ぶ。

/**
 * @param {{ base?: string, name: string, params?: Record<string, string>, onUnauthorized?: () => void }} opts
 */
export function httpStore({ base = '/api', name, params = {}, onUnauthorized } = {}) {
  if (!name) throw new Error('httpStore: name（マップ名）が必要です');
  const query = (extra = {}) => '?' + new URLSearchParams({ ...params, name, ...extra });
  const json = { 'Content-Type': 'application/json' };
  const unauthorized = r => { if (r.status === 401) { if (onUnauthorized) onUnauthorized(); return true; } return false; };

  async function load() {
    const r = await fetch(base + '/map' + query());
    if (unauthorized(r)) throw new Error('ログインしていません');
    if (r.status === 404) return null;
    if (!r.ok) throw new Error(`読み込めませんでした（${r.status}）`);
    const { version, name: _name, ...map } = await r.json();
    return { map, version };
  }

  return {
    load,
    async save(map, baseVersion) {
      const r = await fetch(base + '/map' + query(), { method: 'PUT', headers: json, body: JSON.stringify({ baseVersion, map }) });
      if (unauthorized(r)) return { error: 'unauthorized' };
      const body = await r.json().catch(() => ({}));
      if (r.ok) return { ok: true, version: body.version };
      if (r.status === 409) return { conflict: true, map: body.map, version: body.version };
      return { error: body.error || String(r.status) };
    },
    // 切れたらつなぎ直し、つながるたびに切れていた間の変更を読み直す
    subscribe(cb) {
      let ws = null, closed = false, retry = 0, ping = null, timer = null;
      const url = () => {
        const u = new URL(base + '/ws' + query(), location.href);
        u.protocol = u.protocol === 'https:' ? 'wss:' : 'ws:';
        return u.href;
      };
      const open = () => {
        if (closed) return;
        try { ws = new WebSocket(url()); } catch (e) { return; }
        ws.onopen = () => {
          retry = 0;
          load().then(got => { if (got) cb(got); }).catch(() => {});
          clearInterval(ping);
          ping = setInterval(() => { if (ws.readyState === WebSocket.OPEN) ws.send('ping'); }, 30000);
        };
        ws.onmessage = e => {
          let msg; try { msg = JSON.parse(e.data); } catch (err) { return; } // pong
          if (msg.type === 'map' && msg.name === name) cb({ map: msg.map, version: msg.version });
        };
        ws.onclose = () => {
          clearInterval(ping);
          if (!closed) timer = setTimeout(open, Math.min(30000, 1000 * 2 ** retry++));
        };
      };
      open();
      return () => { closed = true; clearTimeout(timer); clearInterval(ping); if (ws) ws.close(); };
    },
    async unfurl(url) {
      const r = await fetch(base + '/unfurl' + query({ url }));
      return r.ok ? r.json() : null;
    },
  };
}

/** 保存しない store（試しに置くとき・画面の確認用）。 */
export function memoryStore(initial = null) {
  let current = initial ? { map: initial, version: 1 } : null;
  return {
    async load() { return current && { map: structuredClone(current.map), version: current.version }; },
    async save(map, baseVersion) {
      const v = current ? current.version : 0;
      if (baseVersion !== v) return { conflict: true, map: structuredClone(current.map), version: v };
      current = { map: structuredClone(map), version: v + 1 };
      return { ok: true, version: current.version };
    },
  };
}
