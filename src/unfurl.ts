// リンクの展開。ページを取りに行き、題名・サイト名・説明・画像・アイコンを読む。
// 画面はこれでリンクのノードをカードにし（Figma: Links）、CLI の add <URL> は題名をノードの文字にする。
// 読むのは <head> の中だけ（<body> が始まるか 512KB で打ち切る）。5 秒で諦める。

export interface LinkMeta {
  url: string;
  /** 取りに行けて HTML を読めたか。false でも title にはドメインが入る。 */
  ok: boolean;
  title: string;
  site: string;
  description: string;
  image: string;
  icon: string;
}

const LIMIT = 512 * 1024;
const TIMEOUT = 5000;

/** 手元やネットワーク内を指すホスト。手元の開発（領域 local）のほかでは取りに行かない。 */
export function privateHost(url: string): boolean {
  let h: string;
  try { h = new URL(url).hostname.toLowerCase().replace(/^\[|\]$/g, ''); } catch { return true; }
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal') || !h.includes('.') && !h.includes(':')) return true;
  const v4 = h.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
  }
  return h === '::1' || h.startsWith('fc') || h.startsWith('fd') || h.startsWith('fe80');
}

function decode(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp|#39);/gi, (_, e: string) => {
    const k = e.toLowerCase();
    if (k[0] === '#') {
      const code = k[1] === 'x' ? parseInt(k.slice(2), 16) : parseInt(k.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : '';
    }
    return ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' } as Record<string, string>)[k] ?? '';
  });
}
const clean = (s: string | undefined, max: number) => decode(s ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
function absolute(href: string | undefined, base: string): string {
  if (!href) return '';
  try {
    const u = new URL(decode(href.trim()), base);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.href : '';
  } catch { return ''; }
}
function hostOf(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; }
}

export async function unfurl(url: string): Promise<LinkMeta> {
  const fallback: LinkMeta = { url, ok: false, title: hostOf(url), site: hostOf(url), description: '', image: '', icon: '' };
  try { fallback.icon = new URL('/favicon.ico', url).href; } catch { /* URL は呼ぶ側で確かめてある */ }
  let res: Response;
  try {
    res = await fetch(url, {
      redirect: 'follow',
      signal: AbortSignal.timeout(TIMEOUT),
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; MindmapLinkPreview/1.0)',
        Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5',
        'Accept-Language': 'ja,en;q=0.8',
      },
    });
  } catch { return fallback; }
  const finalUrl = res.url || url;
  const type = res.headers.get('Content-Type') || '';
  if (!res.ok || !/html/i.test(type) || !res.body) {
    try { await res.body?.cancel(); } catch { /* 読まずに閉じる */ }
    if (res.ok && /^image\//i.test(type)) return { ...fallback, ok: true, image: finalUrl };
    return fallback;
  }

  const meta: Record<string, string> = {};
  let title = '', inTitle = false, done = false;
  const icons: { href: string; rank: number }[] = [];
  const rewriter = new HTMLRewriter()
    .on('title', {
      element(el) { inTitle = true; el.onEndTag(() => { inTitle = false; }); },
      text(t) { if (inTitle && title.length < 1000) title += t.text; },
    })
    .on('meta', {
      element(el) {
        const key = (el.getAttribute('property') || el.getAttribute('name') || el.getAttribute('itemprop') || '').toLowerCase();
        const content = el.getAttribute('content');
        if (key && content && !(key in meta)) meta[key] = content;
      },
    })
    .on('link', {
      element(el) {
        const rel = (el.getAttribute('rel') || '').toLowerCase().split(/\s+/);
        const href = el.getAttribute('href');
        if (!href) return;
        if (rel.includes('icon')) {
          const sizes = el.getAttribute('sizes') || '';
          icons.push({ href, rank: /svg/i.test(el.getAttribute('type') || href) ? 0 : /(32|48|64)x/.test(sizes) ? 1 : 2 });
        } else if (rel.includes('apple-touch-icon')) icons.push({ href, rank: 3 });
      },
    })
    .on('body', { element() { done = true; } });

  const reader = rewriter.transform(new Response(res.body, { headers: res.headers })).body!.getReader();
  let bytes = 0;
  try {
    while (!done && bytes < LIMIT) {
      const { value, done: end } = await reader.read();
      if (end) break;
      bytes += value.byteLength;
    }
  } catch { /* 途中で切れても、読めたぶんで作る */ }
  try { await reader.cancel(); } catch { /* もう閉じている */ }

  icons.sort((a, b) => a.rank - b.rank);
  const pageTitle = clean(meta['og:title'] || meta['twitter:title'] || title, 300);
  return {
    url,
    ok: true,
    title: pageTitle || hostOf(finalUrl),
    site: clean(meta['og:site_name'] || meta['application-name'], 120) || hostOf(finalUrl),
    description: clean(meta['og:description'] || meta['twitter:description'] || meta['description'], 500),
    image: absolute(meta['og:image'] || meta['og:image:url'] || meta['twitter:image'] || meta['twitter:image:src'], finalUrl),
    icon: absolute(icons[0]?.href, finalUrl) || absolute('/favicon.ico', finalUrl),
  };
}
