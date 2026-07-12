import { useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { socket } from '../lib/socket';
import { useAppState } from '../lib/hooks';
import { useTheme } from './useTheme';
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
  // Track by queue entry uid (not videoId) so back-to-back duplicates still reload/seek.
  const loadedUidRef = useRef<string | null>(null);
  const loadedVideoIdRef = useRef<string | null>(null);
  const advancedUidRef = useRef<string | null>(null);
  // Ignore stale ENDED events from the previous video after we load the next one.
  const suppressEndedRef = useRef(false);
  const reactionsRef = useRef<HTMLDivElement>(null);

  const [qr, setQr] = useState<{ url: string; img: string }>({ url: '', img: '' });
  useTheme(); // applies Pink CRT (or saved theme) — UI controls hidden for now

  // --- Imperative sync: reconcile the YouTube player with the shared state ---
  const syncRef = useRef<() => void>(() => {});
  syncRef.current = () => {
    const p = playerRef.current;
    if (!readyRef.current || !startedRef.current || !p) return;
    const cur = stateRef.current.current;
    if (!cur) {
      if (loadedUidRef.current) {
        p.stopVideo();
        loadedUidRef.current = null;
        loadedVideoIdRef.current = null;
      }
      return;
    }
    if (cur.uid !== loadedUidRef.current) {
      loadedUidRef.current = cur.uid;
      loadedVideoIdRef.current = cur.videoId;
      suppressEndedRef.current = true;
      // Always load by uid change (including duplicate videoIds from pasted links).
      p.loadVideoById(cur.videoId);
      return;
    }
    const YT = window.YT;
    const st = p.getPlayerState();
    if (stateRef.current.isPlaying && st !== YT.PlayerState.PLAYING) p.playVideo();
    if (!stateRef.current.isPlaying && st === YT.PlayerState.PLAYING) p.pauseVideo();
  };

  // Advance at most once per loaded queue entry. Sends uid so the server can drop stale events.
  const advanceOnce = () => {
    const uid = loadedUidRef.current;
    if (!uid || advancedUidRef.current === uid) return;
    advancedUidRef.current = uid;
    socket.emit('songEnded', { uid });
  };

  const skipCurrent = () => {
    const uid = stateRef.current.current?.uid ?? loadedUidRef.current;
    if (!uid) return;
    // Mark locally so a late ENDED can't also advance this same entry.
    advancedUidRef.current = uid;
    suppressEndedRef.current = true;
    socket.emit('skip', { uid });
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
            const YT = window.YT;
            // New video is actually playing — safe to honor end events again.
            if (e.data === YT.PlayerState.PLAYING) suppressEndedRef.current = false;
            if (e.data === YT.PlayerState.ENDED) {
              if (suppressEndedRef.current) return;
              advanceOnce();
            }
          },
          // Unplayable (common with pasted non-embeddable links) — same guarded advance path.
          onError: () => advanceOnce(),
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
      if (!readyRef.current || !startedRef.current || !p || !loadedUidRef.current) return;
      if (!stateRef.current.isPlaying || suppressEndedRef.current) return;
      let dur = 0, cur = 0;
      try { dur = p.getDuration(); cur = p.getCurrentTime(); } catch { return; }
      if (dur > 0 && dur - cur <= 0.4) advanceOnce();
    }, 250);

    const onRestart = () => {
      const p = playerRef.current;
      if (p && startedRef.current && loadedUidRef.current) { p.seekTo(0, true); p.playVideo(); }
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
            <button className="tvbtn" onClick={skipCurrent}>⏭ SKIP</button>
          </div>
        </div>

        <aside id="side">
          <section className="panel now-panel">
            <div className="panel-title">♪ NOW PLAYING</div>
            {state.current ? (
              <div className="now-playing">
                <img src={state.current.thumb} alt="" />
                <div className="meta">
                  <span className="t">{state.current.title}</span>
                  <span className="by">{state.current.addedBy || 'Guest'}</span>
                </div>
              </div>
            ) : (
              <div className="now-empty">Nothing playing</div>
            )}
          </section>

          <section className="panel qr-panel">
            <div className="panel-title">📡 TUNE IN</div>
            <div id="qrcode">{qr.img && <img src={qr.img} alt="Join QR code" />}</div>
            <div className="join">scan to add songs<br /><span>{qr.url}</span></div>
          </section>

          <section className="panel queue-panel">
            <div className="panel-title">▶ UP NEXT</div>
            <ol id="queue" className="queue queue-readonly">
              {state.queue.map((s) => (
                <li key={s.uid}>
                  <img src={s.thumb} alt="" />
                  <div className="meta">
                    <span className="t">{s.title}</span>
                    <span className="by">{s.addedBy || ''}</span>
                  </div>
                </li>
              ))}
            </ol>
          </section>
        </aside>
      </div>
    </>
  );
}
