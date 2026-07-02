export interface Song {
  uid: string;
  videoId: string;
  title: string;
  channel: string;
  thumb: string;
  addedBy: string;
}

export interface AppState {
  queue: Song[];
  current: Song | null;
  isPlaying: boolean;
}

export interface SearchItem {
  videoId: string;
  title: string;
  channel: string;
  thumb: string;
}
