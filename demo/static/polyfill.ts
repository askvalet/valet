// The made-up homelab draws some pictures as data URIs, which on a server means Buffer. This must load before it does.
// The AI SDK also reaches for Buffer when there is one, to sign tool approvals, so it takes bytes as well as text.
const bytesOf = (v: string | ArrayBuffer | ArrayBufferView, offset = 0, length?: number) => typeof v === 'string' ? new TextEncoder().encode(v)
  : ArrayBuffer.isView(v) ? new Uint8Array(v.buffer, v.byteOffset, v.byteLength) : new Uint8Array(v, offset, length ?? v.byteLength - offset);
const base64 = (b: Uint8Array) => { let s = ''; for (let i = 0; i < b.length; i += 4096) s += String.fromCharCode(...b.subarray(i, i + 4096)); return btoa(s); };
(globalThis as any).Buffer ??= {
  from: (v: string | ArrayBuffer | ArrayBufferView, offset?: number, length?: number) => { const b = bytesOf(v, offset, length); return { toString: (enc?: string) => enc === 'base64' ? base64(b) : new TextDecoder().decode(b) }; },
  isBuffer: () => false,
};
