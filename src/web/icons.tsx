// A small built-in icon set (24px grid, 1.6 stroke) so cards need no icon library.
const P: Record<string, string> = {
  cpu: 'M8 8h8v8H8zM4 9h2M4 15h2M18 9h2M18 15h2M9 4v2M15 4v2M9 18v2M15 18v2M6 6h12v12H6z',
  disk: 'M4 7c0-1.7 3.6-3 8-3s8 1.3 8 3-3.6 3-8 3-8-1.3-8-3zM4 7v10c0 1.7 3.6 3 8 3s8-1.3 8-3V7M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3',
  download: 'M12 4v11M7 10l5 5 5-5M5 19h14',
  pulse: 'M3 12h4l2-6 4 12 2-6h6',
  play: 'M8 5v14l11-7z',
  bulb: 'M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.6.4 1 1.1 1 1.8V16h5v-.3c0-.7.4-1.4 1-1.8A6 6 0 0 0 12 3z',
  sparkle: 'M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8z',
  send: 'M5 12h13M13 6l6 6-6 6',
  x: 'M6 6l12 12M18 6L6 18',
  ext: 'M14 5h5v5M19 5l-8 8M18 14v4a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h4',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  gpu: 'M3 7h18v10H3zM7 17v3M17 17v3M8 12a2 2 0 1 0 4 0 2 2 0 0 0-4 0zM14 10h4M14 14h4',
  home: 'M4 11l8-7 8 7M6 9.5V20h12V9.5',
  film: 'M4 5h16v14H4zM8 5v14M16 5v14M4 9h4M4 15h4M16 9h4M16 15h4',
  shield: 'M12 3l7 3v5c0 4.4-3 8-7 10-4-2-7-5.6-7-10V6z',
};

export function Icon({ name, size = 16, className = '' }: { name?: string; size?: number; className?: string }) {
  if (!name) return null;
  if (name.startsWith('http') || name.startsWith('/')) return <img src={name} width={size} height={size} alt="" className={className} />;
  const d = P[name];
  if (!d) return null;
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6}
      strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true"><path d={d} /></svg>
  );
}
