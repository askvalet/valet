import { createRoot } from 'react-dom/client';
import { App } from './app.tsx';
import './styles.css';
import { registerWorker } from './push.ts';

if (import.meta.env.PROD) registerWorker();

createRoot(document.getElementById('root')!).render(<App />);
