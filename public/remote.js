// Phone remote: search / paste, add or "play next", view + reorder the queue.
// This page never plays video — it only sends intents to the server.

const socket = io();
let state = { queue: [], current: null, isPlaying: false };
let name = localStorage.getItem('kk-name') || '';

// --- Nickname ---
if (!name) promptName();
renderName();

function promptName() {
  const n = prompt('Your name (shows next to songs you add):', name || '');
  if (n && n.trim()) {
    name = n.trim().slice(0, 20);
    localStorage.setItem('kk-name', name);
    renderName();
  }
}
function renderName() {
  document.getElementById('name').textContent = name || 'set name';
}
document.getElementById('name-btn').onclick = promptName;

// --- Search ---
const qEl = document.getElementById('q');
const kkEl = document.getElementById('kk');
let debounce;
qEl.addEventListener('input', () => { clearTimeout(debounce); debounce = setTimeout(runSearch, 400); });
kkEl.addEventListener('change', runSearch);

async function runSearch() {
  const raw = qEl.value.trim();
  const results = document.getElementById('results');
  if (!raw) { results.innerHTML = ''; return; }

  const q = kkEl.checked ? `${raw} karaoke` : raw;
  results.innerHTML = '<div class="hint">Searching…</div>';
  try {
    const r = await fetch('/api/search?q=' + encodeURIComponent(q));
    if (r.status === 503) {
      results.innerHTML = '<div class="hint">Search needs an API key — use “Paste a YouTube link” below.</div>';
      return;
    }
    const { items } = await r.json();
    results.innerHTML = '';
    if (!items.length) { results.innerHTML = '<div class="hint">No results.</div>'; return; }
    for (const it of items) results.appendChild(row(it, true));
  } catch {
    results.innerHTML = '<div class="hint">Search failed — try again.</div>';
  }
}

// --- Paste a link ---
document.getElementById('add-url').onclick = async () => {
  const urlEl = document.getElementById('url');
  const url = urlEl.value.trim();
  if (!url) return;
  try {
    const r = await fetch('/api/resolve?url=' + encodeURIComponent(url));
    if (!r.ok) { toast('Could not read that link'); return; }
    add(await r.json(), false);
    urlEl.value = '';
  } catch {
    toast('Could not read that link');
  }
};

function add(it, next) {
  socket.emit('add', {
    videoId: it.videoId,
    title: it.title,
    channel: it.channel,
    thumb: it.thumb,
    addedBy: name || 'Guest',
    next,
  });
  toast(next ? 'Added — playing next!' : 'Added to queue');
}

// --- Shared state ---
socket.on('state', (s) => { state = s; render(); });

function render() {
  document.getElementById('now').textContent = state.current
    ? '🎵 ' + state.current.title
    : 'Nothing playing';
  document.getElementById('count').textContent = state.queue.length ? `(${state.queue.length})` : '';

  const ol = document.getElementById('queue');
  ol.innerHTML = '';
  state.queue.forEach((s, i) => {
    const li = document.createElement('li');
    li.dataset.uid = s.uid;
    li.innerHTML = `
      <span class="pos">${i + 1}</span>
      <img src="${s.thumb}" alt="" />
      <div class="meta">
        <span class="t">${escapeHtml(s.title)}</span>
        <span class="by">${escapeHtml(s.addedBy || '')}</span>
      </div>
      <div class="btns">
        <button class="next" title="Play next">⏫</button>
        <button class="rm" title="Remove">✕</button>
      </div>`;
    li.querySelector('.next').onclick = () => socket.emit('playNext', { uid: s.uid });
    li.querySelector('.rm').onclick = () => socket.emit('remove', { uid: s.uid });
    ol.appendChild(li);
  });
}

function row(it, isResult) {
  const div = document.createElement('div');
  div.className = 'result';
  div.innerHTML = `
    <img src="${it.thumb}" alt="" />
    <div class="meta">
      <span class="t">${escapeHtml(it.title)}</span>
      <span class="by">${escapeHtml(it.channel || '')}</span>
    </div>
    <div class="btns">
      <button class="next" title="Play next">⏫</button>
      <button class="add" title="Add to queue">＋</button>
    </div>`;
  div.querySelector('.add').onclick = () => add(it, false);
  div.querySelector('.next').onclick = () => add(it, true);
  return div;
}

// Drag-to-reorder (grab the text area so button taps still work).
Sortable.create(document.getElementById('queue'), {
  animation: 150,
  handle: '.meta',
  onEnd: () => {
    const uids = [...document.querySelectorAll('#queue li')].map((li) => li.dataset.uid);
    socket.emit('reorderAll', { uids });
  },
});

// --- Toast ---
function toast(msg) {
  let t = document.getElementById('toast');
  if (!t) { t = document.createElement('div'); t.id = 'toast'; document.body.appendChild(t); }
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.remove('show'), 1500);
}

function escapeHtml(s = '') {
  return s.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  );
}
