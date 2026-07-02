// YouTube helpers: Data API search (needs a key) + key-free URL resolving via oEmbed.

export async function search(query, apiKey) {
  const url = new URL('https://www.googleapis.com/youtube/v3/search');
  url.searchParams.set('part', 'snippet');
  url.searchParams.set('type', 'video');
  url.searchParams.set('videoEmbeddable', 'true'); // only embeddable results — avoids dead ends
  url.searchParams.set('maxResults', '10');
  url.searchParams.set('q', query);
  url.searchParams.set('key', apiKey);

  const res = await fetch(url);
  if (!res.ok) throw new Error(`YouTube API responded ${res.status}`);
  const data = await res.json();

  return (data.items || []).map((it) => ({
    videoId: it.id.videoId,
    title: decodeEntities(it.snippet.title),
    channel: decodeEntities(it.snippet.channelTitle),
    thumb: it.snippet.thumbnails?.medium?.url || it.snippet.thumbnails?.default?.url,
  }));
}

// Accepts a full URL, a youtu.be link, an embed/shorts link, or a bare 11-char id.
export function parseVideoId(input) {
  if (!input) return null;
  const s = String(input).trim();
  if (/^[\w-]{11}$/.test(s)) return s;
  try {
    const u = new URL(s);
    if (u.hostname === 'youtu.be') return u.pathname.slice(1, 12) || null;
    const v = u.searchParams.get('v');
    if (v && /^[\w-]{11}$/.test(v)) return v;
    const m = u.pathname.match(/\/(embed|shorts|v)\/([\w-]{11})/);
    if (m) return m[2];
  } catch {
    // not a URL
  }
  return null;
}

// Fetch title/channel/thumb without spending API quota.
export async function fetchVideoMeta(videoId) {
  const res = await fetch(
    `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`
  );
  if (!res.ok) throw new Error('oEmbed lookup failed');
  const d = await res.json();
  return { title: d.title, channel: d.author_name, thumb: d.thumbnail_url };
}

function decodeEntities(s = '') {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}
