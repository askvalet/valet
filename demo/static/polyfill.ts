// The made-up homelab draws some pictures as data URIs, which on a server means Buffer. This must load before it does.
const base64 = (text: string) => btoa(String.fromCharCode(...new TextEncoder().encode(text)));
(globalThis as any).Buffer ??= { from: (text: string) => ({ toString: () => base64(text) }), isBuffer: () => false };
