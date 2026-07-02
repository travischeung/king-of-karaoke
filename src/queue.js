// In-memory karaoke queue with cheap JSON persistence.
// The server is the single source of truth; every mutation goes through here,
// then the server broadcasts the whole state to all clients.

import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STATE_FILE = path.join(__dirname, '..', 'state.json');

// song  = { uid, videoId, title, channel, thumb, addedBy }
// state = { queue: [song...], current: song|null, isPlaying: bool }
let state = { queue: [], current: null, isPlaying: false };

export function load() {
  try {
    const parsed = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    state = {
      queue: Array.isArray(parsed.queue) ? parsed.queue : [],
      current: parsed.current || null,
      isPlaying: false, // always start paused; host clicks "Start the party"
    };
  } catch {
    // no state file yet — first run
  }
  normalize();
}

let saveTimer = null;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const toDisk = JSON.stringify({ queue: state.queue, current: state.current }, null, 2);
    fs.writeFile(STATE_FILE, toDisk, () => {});
  }, 300);
}

// Keep exactly one song "current" whenever the queue has anything.
function normalize() {
  if (!state.current && state.queue.length) {
    state.current = state.queue.shift();
  }
}

export function getState() {
  return state;
}

export function addSong(song, next = false) {
  const entry = {
    uid: randomUUID(),
    videoId: song.videoId,
    title: song.title || song.videoId,
    channel: song.channel || '',
    thumb: song.thumb || `https://i.ytimg.com/vi/${song.videoId}/hqdefault.jpg`,
    addedBy: song.addedBy || 'Guest',
  };
  if (next) state.queue.unshift(entry);
  else state.queue.push(entry);
  normalize();
  save();
  return entry;
}

// Reorder the whole queue to match a list of uids (from a drag-and-drop reorder).
export function reorderAll(uids = []) {
  const byUid = new Map(state.queue.map((s) => [s.uid, s]));
  const reordered = uids.map((u) => byUid.get(u)).filter(Boolean);
  // Safety: keep any songs that weren't in the incoming list (e.g. added mid-drag).
  for (const s of state.queue) {
    if (!uids.includes(s.uid)) reordered.push(s);
  }
  state.queue = reordered;
  save();
}

// Bump a queued song to the front ("play next" button).
export function playNext(uid) {
  const idx = state.queue.findIndex((s) => s.uid === uid);
  if (idx > -1) {
    const [s] = state.queue.splice(idx, 1);
    state.queue.unshift(s);
    save();
  }
}

export function remove(uid) {
  state.queue = state.queue.filter((s) => s.uid !== uid);
  save();
}

// Advance to the next song (on skip or when a song ends).
export function advance() {
  state.current = state.queue.shift() || null;
  state.isPlaying = !!state.current;
  save();
}

export function togglePlay(force) {
  state.isPlaying = typeof force === 'boolean' ? force : !state.isPlaying;
}
