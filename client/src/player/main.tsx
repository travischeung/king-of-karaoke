import { createRoot } from 'react-dom/client';
import Player from './Player';
import '../styles/themes.css';
import '../styles/player.css';

createRoot(document.getElementById('root')!).render(<Player />);
