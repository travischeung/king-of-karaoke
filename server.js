import 'dotenv/config';
import express from 'express';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Server } from 'socket.io';

import * as queue from './src/queue.js';
import { search, parseVideoId, fetchVideoMeta } from './src/youtube.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;

queue.load();

const app = express();
// Behind Render's proxy: trust X-Forwarded-* so req.ip is the real client, not the proxy.
app.set('trust proxy', 1);
const server = http.createServer(app);
const io = new Server(server);

// Serve the built React client (Vite build output). Run `npm run build` first.
app.use(express.static(path.join(__dirname, 'dist')));
app.get('/', (req, res) => res.redirect('/player'));
app.get('/player', (req, res) => res.sendFile(path.join(__dirname, 'dist', 'player.html')));
app.get('/remote', (req, res) => res.sendFile(path.join(__dirname, 'dist', 'remote.html')));

function lanIp() {
  for (const nets of Object.values(os.networkInterfaces())) {
    for (const net of nets || []) {
      if (net.family === 'IPv4' && !net.internal) return net.address;
    }
  }
  return 'localhost';
}
const REMOTE_URL = `http://${lanIp()}:${PORT}/remote`;

app.get('/api/info', (req, res) => res.json({ remoteUrl: REMOTE_URL }));

// Per-IP throttle for the search endpoint. The YouTube quota is small and this
// instance is public, so one abusive client shouldn't be able to drain the day's
// quota. Generous enough that a human typing (400ms debounce) never hits it.
const searchHits = new Map(); // ip -> { count, resetAt }
function allowSearch(ip, max = 20, windowMs = 10_000) {
  const now = Date.now();
  if (searchHits.size > 5000) searchHits.clear(); // crude cap so the map can't grow unbounded
  const e = searchHits.get(ip);
  if (!e || now > e.resetAt) { searchHits.set(ip, { count: 1, resetAt: now + windowMs }); return true; }
  if (e.count >= max) return false;
  e.count++;
  return true;
}

// In-app search (server-side so the API key never reaches the browser).
app.get('/api/search', async (req, res) => {
  const q = String(req.query.q || '').trim();
  if (!q) return res.json({ items: [] });
  if (!allowSearch(req.ip)) return res.status(429).json({ error: 'rate_limited' });
  if (!process.env.YOUTUBE_API_KEY) return res.status(503).json({ error: 'no_api_key' });
  try {
    res.json({ items: await search(q, process.env.YOUTUBE_API_KEY) });
  } catch (e) {
    res.status(500).json({ error: 'search_failed', detail: String(e) });
  }
});

// Resolve a pasted URL to a song (uses key-free oEmbed).
app.get('/api/resolve', async (req, res) => {
  const videoId = parseVideoId(req.query.url);
  if (!videoId) return res.status(400).json({ error: 'bad_url' });
  try {
    const meta = await fetchVideoMeta(videoId);
    res.json({ videoId, ...meta });
  } catch {
    res.json({
      videoId,
      title: videoId,
      channel: '',
      thumb: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
    });
  }
});

const broadcast = () => io.emit('state', queue.getState());

io.on('connection', (socket) => {
  socket.emit('state', queue.getState());

  socket.on('add', (p = {}) => {
    if (!p.videoId) return;
    queue.addSong(
      { videoId: p.videoId, title: p.title, channel: p.channel, thumb: p.thumb, addedBy: p.addedBy },
      !!p.next
    );
    broadcast();
  });
  socket.on('reorderAll', (p = {}) => { queue.reorderAll(p.uids || []); broadcast(); });
  socket.on('playNext', (p = {}) => { queue.playNext(p.uid); broadcast(); });
  socket.on('remove', (p = {}) => { queue.remove(p.uid); broadcast(); });
  socket.on('skip', () => { queue.advance(); broadcast(); });
  socket.on('songEnded', () => { queue.advance(); broadcast(); });
  socket.on('restart', () => {
    // Transient command — tell the player page to seek the current song to 0:00.
    queue.togglePlay(true);
    io.emit('restart');
    broadcast();
  });
  socket.on('togglePlay', (p = {}) => {
    queue.togglePlay(typeof p.playing === 'boolean' ? p.playing : undefined);
    broadcast();
  });

  // Transient emoji reactions — broadcast to all (the player renders them). Light
  // per-client throttle (~8/sec) so one phone can't flood the animation layer.
  socket.on('reaction', (p = {}) => {
    const now = Date.now();
    if (now - (socket.lastReaction || 0) < 120) return;
    socket.lastReaction = now;
    const emoji = String(p.emoji || '').slice(0, 8);
    if (emoji) io.emit('reaction', { emoji });
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log('\n🎤  Karaoke server is up');
  console.log(`    Player screen  : http://localhost:${PORT}/player`);
  console.log(`    Remote (phones): ${REMOTE_URL}`);
  console.log('\n    Phones must be on the SAME Wi-Fi (and it must not have client isolation on).');
  if (!process.env.YOUTUBE_API_KEY) {
    console.log('    ⚠  No YOUTUBE_API_KEY set — in-app search is off; paste-a-link still works.');
  }
  console.log('');
});
