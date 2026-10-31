import { useEffect, useRef, useState } from 'react';
import { twMerge } from 'tailwind-merge';

type ClassValue = string | number | null | undefined | false | ClassValue[] | Record<string, unknown>;

/** Class names from strings, arrays and { class: condition } objects, with later Tailwind classes winning conflicts. */
export function cn(...inputs: ClassValue[]): string {
  const out: string[] = [];
  const walk = (v: ClassValue) => {
    if (!v) return;
    if (typeof v === 'string' || typeof v === 'number') out.push(String(v));
    else if (Array.isArray(v)) v.forEach(walk);
    else for (const [k, on] of Object.entries(v)) if (on) out.push(k);
  };
  inputs.forEach(walk);
  return twMerge(out.join(' '));
}

/** Whether an element is on screen, so what loops or rotates can rest while nobody can see it. */
export function useOnScreen<T extends Element>() {
  const ref = useRef<T>(null), [seen, setSeen] = useState(true);
  useEffect(() => {
    if (!ref.current) return;
    const io = new IntersectionObserver(([e]) => setSeen(e.isIntersecting));
    io.observe(ref.current);
    return () => io.disconnect();
  }, []);
  return [ref, seen] as const;
}
