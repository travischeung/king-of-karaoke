import { useEffect, useRef, useState } from 'react';
import Sortable from 'sortablejs';
import { socket } from '../lib/socket';
import { useAppState } from '../lib/hooks';
import type { SearchItem } from '../lib/types';

const REACTIONS = ['👏'];

// The phone remote: search / paste, add or "play next", transport controls, and the queue.
// Never plays video — only sends intents to the server.
export default function Remote() {
  const state = useAppState();
  const stateRef = useRef(state);
  stateRef.current = state;

  const [name, setName] = useState<string>(() => localStorage.getItem('kk-name') || '');
  const [query, setQuery] = useState('');
  const [karaoke, setKaraoke] = useState(true);
  const [results, setResults] = useState<SearchItem[]>([]);
  const [searchMsg, setSearchMsg] = useState('');
  const [pasteUrl, setPasteUrl] = useState('');
  const [toast, setToast] = useState('');
  const toastTimer = useRef<number>();
  const queueOlRef = useRef<HTMLOListElement>(null);

  // Ask for a nickname on first load.
  useEffect(() => { if (!name) promptName(); /* eslint-disable-next-line */ }, []);

  function promptName() {
    const n = window.prompt('Your name (shows next to songs you add):', name || '');
    if (n && n.trim()) {
      const v = n.trim().slice(0, 20);
      setName(v);
      localStorage.setItem('kk-name', v);
    }
  }

  function showToast(msg: string) {
    setToast(msg);
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(''), 1500);
  }

  // Debounced search.
  useEffect(() => {
    const raw = query.trim();
    if (!raw) { setResults([]); setSearchMsg(''); return; }
    const q = karaoke ? `${raw} karaoke` : raw;
    setSearchMsg('Searching…');
    const t = window.setTimeout(async () => {
      try {
        const r = await fetch('/api/search?q=' + encodeURIComponent(q));
        if (r.status === 503) {
          setResults([]);
          setSearchMsg('Search needs an API key — use “Paste a YouTube link” below.');
          return;
        }
        const { items } = await r.json();
        setResults(items);
        setSearchMsg(items.length ? '' : 'No results.');
      } catch {
        setResults([]);
        setSearchMsg('Search failed — try again.');
      }
    }, 400);
    return () => window.clearTimeout(t);
  }, [query, karaoke]);

  function add(it: SearchItem, next: boolean) {
    socket.emit('add', {
      videoId: it.videoId, title: it.title, channel: it.channel,
      thumb: it.thumb, addedBy: name || 'Guest', next,
    });
    setQuery('');   // clear the search field (the effect also clears the results)
    showToast(next ? 'Added — playing next!' : 'Added to queue');
  }

  async function addUrl() {
    const url = pasteUrl.trim();
    if (!url) return;
    try {
      const r = await fetch('/api/resolve?url=' + encodeURIComponent(url));
      if (!r.ok) { showToast('Could not read that link'); return; }
      add(await r.json(), false);
      setPasteUrl('');
    } catch {
      showToast('Could not read that link');
    }
  }

  // Drag-to-reorder (revert Sortable's DOM change; server broadcast is source of truth).
  useEffect(() => {
    if (!queueOlRef.current) return;
    const s = Sortable.create(queueOlRef.current, {
      animation: 150,
      handle: '.meta',
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

  const noSong = !state.current;

  return (
    <>
      <header>
        <span id="now">{state.current ? '🎵 ' + state.current.title : 'Nothing playing'}</span>
        <button id="name-btn" onClick={promptName}>👤 <span id="name">{name || 'set name'}</span></button>
      </header>

      <div className={'transport' + (noSong ? ' disabled' : '')} id="transport">
        <button id="r-restart" title="Restart song" disabled={noSong} onClick={() => socket.emit('restart')}>⏮ Restart</button>
        <button id="r-playpause" title="Play / Pause" disabled={noSong}
          onClick={() => socket.emit('togglePlay', { playing: !state.isPlaying })}>
          {state.isPlaying ? '⏸ Pause' : '▶ Play'}
        </button>
        <button id="r-skip" title="Skip" disabled={noSong} onClick={() => socket.emit('skip')}>⏭ Skip</button>
      </div>

      <div className="search-bar">
        <input id="q" type="search" placeholder="Search for a song…" autoComplete="off"
          value={query} onChange={(e) => setQuery(e.target.value)} />
        <label className="kk">
          <input type="checkbox" checked={karaoke} onChange={(e) => setKaraoke(e.target.checked)} /> karaoke
        </label>
      </div>

      <div id="results">
        {searchMsg && <div className="hint">{searchMsg}</div>}
        {results.map((it) => (
          <div className="result" key={it.videoId}>
            <img src={it.thumb} alt="" />
            <div className="meta">
              <span className="t">{it.title}</span>
              <span className="by">{it.channel || ''}</span>
            </div>
            <div className="btns">
              <button className="next" title="Play next" onClick={() => add(it, true)}>⏫</button>
              <button className="add" title="Add to queue" onClick={() => add(it, false)}>＋</button>
            </div>
          </div>
        ))}
      </div>

      <details className="paste">
        <summary>Paste a YouTube link instead</summary>
        <div className="paste-row">
          <input placeholder="https://youtube.com/watch?v=…" value={pasteUrl}
            onChange={(e) => setPasteUrl(e.target.value)} />
          <button onClick={addUrl}>Add</button>
        </div>
      </details>

      <h2>Queue {state.queue.length ? <span id="count">({state.queue.length})</span> : null}</h2>
      <ol id="queue" className="queue" ref={queueOlRef}>
        {state.queue.map((s, i) => (
          <li key={s.uid} data-uid={s.uid}>
            <span className="pos">{i + 1}</span>
            <img src={s.thumb} alt="" />
            <div className="meta">
              <span className="t">{s.title}</span>
              <span className="by">{s.addedBy || ''}</span>
            </div>
            <div className="btns">
              <button className="next" title="Play next" onClick={() => socket.emit('playNext', { uid: s.uid })}>⏫</button>
              <button className="rm" title="Remove" onClick={() => socket.emit('remove', { uid: s.uid })}>✕</button>
            </div>
          </li>
        ))}
      </ol>

      <div className="reaction-bar">
        {REACTIONS.map((e) => (
          <button key={e} aria-label={`Send ${e}`} onClick={() => socket.emit('reaction', { emoji: e })}>{e}</button>
        ))}
      </div>

      <div id="toast" className={toast ? 'show' : ''}>{toast}</div>
    </>
  );
}
