// Player screen: the only page that actually plays video. Renders the QR,
// mirrors the shared queue, and acts as the DJ booth (play/pause/skip/reorder).

const socket = io();
let state = { queue: [], current: null, isPlaying: false };

let player = null;
let ytReady = false;
let started = false;
let loadedVideoId = null;

// --- QR code + join URL ---
fetch('/api/info')
  .then((r) => r.json())
  .then(({ remoteUrl }) => {
    document.getElementById('join-url').textContent = remoteUrl;
    new QRCode(document.getElementById('qrcode'), {
      text: remoteUrl,
      width: 180,
      height: 180,
      colorDark: '#000',
      colorLight: '#fff',
    });
  });

// --- YouTube IFrame API ---
window.onYouTubeIframeAPIReady = () => {
  player = new YT.Player('player-frame', {
    height: '100%',
    width: '100%',
    playerVars: { autoplay: 0, controls: 1, rel: 0, modestbranding: 1, playsinline: 1 },
    events: {
      onReady: () => { ytReady = true; sync(); },
      onStateChange: (e) => {
        if (e.data === YT.PlayerState.ENDED) socket.emit('songEnded');
      },
      onError: () => {
        // Non-embeddable / unavailable video — skip past it.
        socket.emit('skip');
      },
    },
  });
};

// --- Controls ---
document.getElementById('start-btn').onclick = () => {
  started = true;
  document.getElementById('start-overlay').style.display = 'none';
  socket.emit('togglePlay', { playing: true });
  sync(); // first play happens inside this user gesture → satisfies autoplay policy
};
document.getElementById('playpause').onclick = () =>
  socket.emit('togglePlay', { playing: !state.isPlaying });
document.getElementById('skip').onclick = () => socket.emit('skip');

// --- Shared state ---
socket.on('state', (s) => {
  state = s;
  render();
  sync();
});

function sync() {
  if (!ytReady || !started || !player) return;
  const cur = state.current;

  if (!cur) {
    if (loadedVideoId) { player.stopVideo(); loadedVideoId = null; }
    return;
  }
  if (cur.videoId !== loadedVideoId) {
    loadedVideoId = cur.videoId;
    player.loadVideoById(cur.videoId); // starts playing
    return;
  }
  const st = player.getPlayerState();
  if (state.isPlaying && st !== YT.PlayerState.PLAYING) player.playVideo();
  if (!state.isPlaying && st === YT.PlayerState.PLAYING) player.pauseVideo();
}

function render() {
  document.getElementById('idle').style.display = state.current ? 'none' : 'flex';
  document.getElementById('playpause').textContent = state.isPlaying ? '⏸ Pause' : '▶ Play';

  const ol = document.getElementById('queue');
  ol.innerHTML = '';
  for (const s of state.queue) {
    const li = document.createElement('li');
    li.dataset.uid = s.uid;
    li.innerHTML = `
      <img src="${s.thumb}" alt="" />
      <div class="meta">
        <span class="t">${escapeHtml(s.title)}</span>
        <span class="by">${escapeHtml(s.addedBy || '')}</span>
      </div>
      <button class="rm" title="Remove">✕</button>`;
    li.querySelector('.rm').onclick = () => socket.emit('remove', { uid: s.uid });
    ol.appendChild(li);
  }
}

// Drag-to-reorder on the player screen.
Sortable.create(document.getElementById('queue'), {
  animation: 150,
  onEnd: () => {
    const uids = [...document.querySelectorAll('#queue li')].map((li) => li.dataset.uid);
    socket.emit('reorderAll', { uids });
  },
});

function escapeHtml(s = '') {
  return s.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  );
}
