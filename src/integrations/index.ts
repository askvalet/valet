// Built-in integrations. Each file is self-contained; adding one is a new file plus a line here.
import type { Integration } from '../server/core.ts';
import glances from './glances.ts';
import http from './http.ts';
import qbittorrent from './qbittorrent.ts';

export const registry: Record<string, Integration> = Object.fromEntries(
  [glances, http, qbittorrent].map(i => [i.type, i as Integration]),
);
