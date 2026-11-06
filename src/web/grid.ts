// The grid a section of cards is laid out on, shared by the main page and the wall: a bento whose tracks grow with the
// width, or the section's own count of columns per screen (`columns: { phone, tablet, desktop, wide }`).
import type React from 'react';

export type Size = 'small' | 'wide' | 'medium' | 'tall' | 'large';
export type Grid = { phone?: number; tablet?: number; desktop?: number; wide?: number };

/** Each size's columns and rows on a bento. */
export const SPANS: Record<Size, [number, number]> = { small: [1, 1], wide: [2, 1], medium: [2, 1], tall: [2, 2], large: [4, 1] };
/** A section's own columns per screen, read by `.cols` in styles.css. */
export const gridVars = (g: Grid) => ({ '--cols-phone': g.phone, '--cols-tablet': g.tablet, '--cols-desktop': g.desktop, '--cols-wide': g.wide }) as React.CSSProperties;

/**
 * Where one card sits on a wall section's grid: its size's span, or the card's own `cols` and `rows`, never past the
 * last column. A section with its own columns places every card by number, one column each unless a size or `cols`
 * says more, as on the main page; the bento keeps its classes otherwise.
 */
export function wallCell(size: Size | undefined, look: { cols?: number; rows?: number } | undefined, grid: boolean): { className?: string; style?: React.CSSProperties } {
  const [cols, rows] = size ? SPANS[size] : grid ? [1, 1] : SPANS.medium;
  if (!size) size = 'medium';
  if (grid || look?.cols) return { style: { gridColumn: `span min(${look?.cols ?? cols}, var(--tracks, 6))`, gridRow: `span ${look?.rows ?? rows}` } };
  const span = size === 'small' ? 'col-span-1' : size === 'tall' ? 'col-span-2 row-span-2' : size === 'large' ? 'col-span-full @5xl/main:col-span-4' : 'col-span-2';
  return { className: span, style: look?.rows ? { gridRow: `span ${look.rows}` } : undefined };
}
