import { io } from 'socket.io-client';

// Connects to the same origin the page was served from (LAN, tunnel, or host).
// In dev, Vite proxies /socket.io to the Node server on :3000.
export const socket = io();
