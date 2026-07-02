import { useEffect, useState } from 'react';
import { socket } from './socket';
import type { AppState } from './types';

// Subscribes to the server's single `state` broadcast. The server is the source of
// truth; components render from this and emit intents back via `socket`.
export function useAppState(): AppState {
  const [state, setState] = useState<AppState>({ queue: [], current: null, isPlaying: false });
  useEffect(() => {
    const onState = (s: AppState) => setState(s);
    socket.on('state', onState);
    return () => { socket.off('state', onState); };
  }, []);
  return state;
}
