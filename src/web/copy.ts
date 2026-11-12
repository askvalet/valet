// Copying to the clipboard, on every page Valet is served from. Browsers only offer navigator.clipboard on a secure page
// (https or localhost), and a homelab is often opened at a plain http address on the LAN, where it doesn't exist; there
// the old copy command still works, from a click. So: the clipboard where it is and works, the copy command where it
// isn't or doesn't, and an answer either way, so a button only says "copied" when it was.

/** Copy through a selected, unseen text box, from inside `near` so a dialog that keeps focus to itself lets it be focused. */
function copyCommand(text: string, near?: Element | null): boolean {
  const box = document.createElement('textarea');
  box.value = text;
  box.setAttribute('readonly', '');
  // off-screen but in the layout, and 16px so a phone doesn't zoom to it
  box.style.cssText = 'position:fixed;top:0;left:-9999px;opacity:0;font-size:16px;';
  const home = near?.isConnected ? near : document.body, was = document.activeElement as HTMLElement | null;
  home.appendChild(box);
  try {
    box.focus({ preventScroll: true });
    box.select();
    box.setSelectionRange(0, text.length);   // iOS selects only this way
    return document.execCommand('copy');
  } catch {
    return false;
  } finally {
    box.remove();
    was?.focus?.({ preventScroll: true });
  }
}

/** Copy `text`; true once it's on the clipboard. Call it from the click itself: the copy command needs that click. */
export async function copyText(text: string, near?: Element | null): Promise<boolean> {
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText && (typeof window === 'undefined' || window.isSecureContext)) {
    try { await navigator.clipboard.writeText(text); return true; } catch { /* refused (no focus, a permission): try the old way */ }
  }
  return copyCommand(text, near);
}
