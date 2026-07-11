import { useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import Sortable from 'sortablejs';
import { socket } from '../lib/socket';
import { useAppState } from '../lib/hooks';
import { useTheme, THEMES } from './useTheme';
import clapUrl from '../assets/clap.png';
import thumbsDownUrl from '../assets/thumbsdown.png';

// Maps a reaction emoji to the image sprayed on the player screen. Unknown emojis fall back to clap.
const REACTION_IMAGES: Record<string, string> = {
  '👏': clapUrl,
  '👎': thumbsDownUrl,
};

// The player screen: the only page that plays video. Renders the TV chrome + QR,
// mirrors the shared queue, and drives playback imperatively via the YouTube API.
export default function Player() {
  const state = useAppState();
  const stateRef = useRef(state);
  stateRef.current = state;

  const [started, setStarted] = useState(false);
  const startedRef = useRef(false);
  const readyRef = useRef(false);
  const playerRef = useRef<any>(null);
  const loadedRef = useRef<string | null>(null);
  const advancedRef = useRef<string | null>(null);
  const queueOlRef = useRef<HTMLOListElement>(null);
  const reactionsRef = useRef<HTMLDivElement>(null);

  const [qr, setQr] = useState<{ url: string; img: string }>({ url: '', img: '' });
  const { theme, selectTheme, uploadBackground, clearBackground } = useTheme();

  // --- Imperative sync: reconcile the YouTube player with the shared state ---
  const syncRef = useRef<() => void>(() => {});
  syncRef.current = () => {
    const p = playerRef.current;
    if (!readyRef.current || !startedRef.current || !p) return;
    const cur = stateRef.current.current;
    if (!cur) {
      if (loadedRef.current) { p.stopVideo(); loadedRef.current = null; }
      return;
    }
    if (cur.videoId !== loadedRef.current) {
      loadedRef.current = cur.videoId;
      p.loadVideoById(cur.videoId);
      return;
    }
    const YT = window.YT;
    const st = p.getPlayerState();
    if (stateRef.current.isPlaying && st !== YT.PlayerState.PLAYING) p.playVideo();
    if (!stateRef.current.isPlaying && st === YT.PlayerState.PLAYING) p.pauseVideo();
  };

  const advanceOnce = () => {
    if (advancedRef.current === loadedRef.current) return;
    advancedRef.current = loadedRef.current;
    socket.emit('songEnded');
  };

  // --- Set up the YouTube player once ---
  useEffect(() => {
    function create() {
      playerRef.current = new window.YT.Player('player-frame', {
        height: '100%',
        width: '100%',
        playerVars: {
          autoplay: 0, controls: 0, rel: 0, modestbranding: 1,
          iv_load_policy: 3, disablekb: 1, fs: 0, playsinline: 1,
        },
        events: {
          onReady: () => { readyRef.current = true; syncRef.current(); },
          onStateChange: (e: any) => {
            if (e.data === window.YT.PlayerState.ENDED) advanceOnce();
          },
          onError: () => socket.emit('skip'),
        },
      });
    }
    if (window.YT && window.YT.Player) {
      create();
    } else {
      const prev = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = () => { prev?.(); create(); };
      if (!document.querySelector('script[src*="youtube.com/iframe_api"]')) {
        const tag = document.createElement('script');
        tag.src = 'https://www.youtube.com/iframe_api';
        document.head.appendChild(tag);
      }
    }

    // Cut ~0.4s before the true end so YouTube's suggested-video wall never appears.
    const interval = window.setInterval(() => {
      const p = playerRef.current;
      if (!readyRef.current || !startedRef.current || !p || !loadedRef.current) return;
      if (!stateRef.current.isPlaying) return;
      let dur = 0, cur = 0;
      try { dur = p.getDuration(); cur = p.getCurrentTime(); } catch { return; }
      if (dur > 0 && dur - cur <= 0.4) advanceOnce();
    }, 250);

    const onRestart = () => {
      const p = playerRef.current;
      if (p && startedRef.current && loadedRef.current) { p.seekTo(0, true); p.playVideo(); }
    };
    socket.on('restart', onRestart);

    return () => { window.clearInterval(interval); socket.off('restart', onRestart); };
  }, []);

  // Re-sync whenever the shared state (or started flag) changes.
  useEffect(() => { syncRef.current(); }, [state, started]);

  // --- QR: encode whatever origin the page was opened at (tunnel / host / LAN) ---
  useEffect(() => {
    (async () => {
      let joinUrl = window.location.origin + '/remote';
      if (/^https?:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(window.location.origin)) {
        try {
          const { remoteUrl } = await (await fetch('/api/info')).json();
          if (remoteUrl) joinUrl = remoteUrl;
        } catch { /* keep localhost fallback */ }
      }
      const img = await QRCode.toDataURL(joinUrl, { width: 180, margin: 1 });
      setQr({ url: joinUrl, img });
    })();
  }, []);

  // --- Drag-to-reorder (revert Sortable's DOM change; server broadcast is the source of truth) ---
  useEffect(() => {
    if (!queueOlRef.current) return;
    const s = Sortable.create(queueOlRef.current, {
      animation: 150,
      onEnd: (evt) => {
        const { oldIndex, newIndex, item, from } = evt;
        if (oldIndex == null || newIndex == null || oldIndex === newIndex) return;
        from.removeChild(item);
        from.insertBefore(item, from.children[oldIndex] ?? null);
        const q = stateRef.current.queue.slice();
        const [moved] = q.splice(oldIndex, 1);
        q.splice(newIndex, 0, moved);
        socket.emit('reorderAll', { uids: q.map((x) => x.uid) });
      },
    });
    return () => s.destroy();
  }, []);

  // --- Emoji reactions: spawn a floating particle per broadcast ---
  useEffect(() => {
    const layer = reactionsRef.current;
    if (!layer) return;
    // Spawn a radial spray of glowing particles centered at (cx, cy).
    const spawnBurst = (cx: number, cy: number, base: number) => {
      const count = 14;
      const bsize = Math.max(10, Math.round(base * 0.12));
      for (let i = 0; i < count; i++) {
        const p = document.createElement('span');
        p.className = 'burst';
        const ang = (Math.PI * 2 * i) / count + Math.random() * 0.5;
        const dist = base * (0.5 + Math.random() * 0.6);
        p.style.left = cx + 'px';
        p.style.top = cy + 'px';
        p.style.setProperty('--bsize', bsize + 'px');
        p.style.setProperty('--dx', Math.round(Math.cos(ang) * dist) + 'px');
        p.style.setProperty('--dy', Math.round(Math.sin(ang) * dist) + 'px');
        p.style.setProperty('--bdur', (0.5 + Math.random() * 0.35).toFixed(2) + 's');
        p.addEventListener('animationend', () => p.remove(), { once: true });
        layer.appendChild(p);
      }
    };

    const onReaction = (p: { emoji?: string } = {}) => {
      const el = document.createElement('img');
      el.className = 'reaction';
      el.src = REACTION_IMAGES[p.emoji ?? ''] ?? clapUrl;
      el.alt = '';
      el.style.setProperty('--x', (Math.random() * 88 + 2).toFixed(1) + '%');
      el.style.setProperty('--size', Math.round(Math.random() * 180 + 240) + 'px');
      el.style.setProperty('--dur', (Math.random() * 1.07 + 2.27).toFixed(2) + 's');
      el.style.setProperty('--drift', Math.round(Math.random() * 140 - 70) + 'px');
      el.style.setProperty('--rot', Math.round(Math.random() * 60 - 30) + 'deg');
      // On reaching the top, explode into a burst.
      el.addEventListener('animationend', () => {
        const r = el.getBoundingClientRect();
        spawnBurst(r.left + r.width / 2, r.top + r.height / 2, r.width);
        el.remove();
      }, { once: true });
      layer.appendChild(el);
      while (layer.childElementCount > 150) layer.firstElementChild?.remove();
    };
    socket.on('reaction', onReaction);
    return () => { socket.off('reaction', onReaction); };
  }, []);

  const powerOn = () => {
    startedRef.current = true;
    setStarted(true);
    socket.emit('togglePlay', { playing: true });
    syncRef.current();
  };

  return (
    <>
      <div id="reactions" aria-hidden="true" ref={reactionsRef} />

      <div id="theme-bar">
        <label>
          🎨{' '}
          <select value={theme} onChange={(e) => selectTheme(e.target.value)}>
            {THEMES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
          </select>
        </label>
        <label className="upload-btn">
          📷 BG
          <input type="file" accept="image/*" hidden
            onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadBackground(f); }} />
        </label>
        <button title="Clear uploaded background" onClick={clearBackground}>✕</button>
      </div>

      {!started && (
        <div id="start-overlay">
          <div className="start-card">
            <button id="start-btn" onClick={powerOn}>⏻ POWER ON</button>
            <p>Click once to enable sound &amp; autoplay</p>
          </div>
        </div>
      )}

      <div id="stage">
        <div className="tv">
          <div className="tv-top">
            <span className="brand">K-TV</span>
            <span className="model">MODEL KT-88 · STEREO COLOR</span>
          </div>

          <div className="tv-body">
            <div className="screen-area">
              <div className="screen">
                <div id="player-frame" />
                <div id="idle" className="idle" style={{ display: state.current ? 'none' : 'flex' }}>
                  <div className="idle-inner">
                    <span className="noise">▓▒░</span>
                    <span className="big">NO SIGNAL</span>
                    <small>scan the QR to queue a song 🎶</small>
                  </div>
                </div>
                <div className="crt-overlay" aria-hidden="true" />
                <div className="screen-block" aria-hidden="true" />
              </div>
            </div>

            <div className="control-column">
              <div className="speaker" aria-hidden="true" />
              <div className="knobs" aria-hidden="true">
                <div className="knob"><i /></div>
                <div className="knob"><i /></div>
              </div>
              <div className="power"><span className="led" />PWR</div>
            </div>
          </div>

          <div className="tv-controls">
            <button className="tvbtn" onClick={() => socket.emit('togglePlay', { playing: !state.isPlaying })}>
              {state.isPlaying ? '⏸ Pause' : '▶ Play'}
            </button>
            <button className="tvbtn" onClick={() => socket.emit('skip')}>⏭ SKIP</button>
          </div>
        </div>

        <aside id="side">
          <section className="panel qr-panel">
            <div className="panel-title">📡 TUNE IN</div>
            <div id="qrcode">{qr.img && <img src={qr.img} alt="Join QR code" />}</div>
            <div className="join">scan to add songs<br /><span>{qr.url}</span></div>
          </section>

          <section className="panel queue-panel">
            <div className="panel-title">▶ UP NEXT</div>
            <ol id="queue" className="queue" ref={queueOlRef}>
              {state.queue.map((s) => (
                <li key={s.uid} data-uid={s.uid}>
                  <img src={s.thumb} alt="" />
                  <div className="meta">
                    <span className="t">{s.title}</span>
                    <span className="by">{s.addedBy || ''}</span>
                  </div>
                  <button className="rm" title="Remove" onClick={() => socket.emit('remove', { uid: s.uid })}>✕</button>
                </li>
              ))}
            </ol>
          </section>
        </aside>
      </div>
    </>
  );
}
