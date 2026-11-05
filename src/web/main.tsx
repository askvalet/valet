import { createRoot } from 'react-dom/client';
import { App } from './app.tsx';
import './styles.css';
import { registerWorker } from './push.ts';
import { watchIconInk } from './icon-ink.ts';

if (import.meta.env.PROD) registerWorker();
watchIconInk();

createRoot(document.getElementById('root')!).render(<App />);
