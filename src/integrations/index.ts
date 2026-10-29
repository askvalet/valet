// Built-in integrations. Each file is self-contained; adding one is a new file plus a line here.
import type { Integration } from '../server/core.ts';
import aimonitor from './aimonitor.ts';
import glances from './glances.ts';
import homeassistant from './homeassistant.ts';
import http from './http.ts';
import qbittorrent from './qbittorrent.ts';
import tautulli from './tautulli.ts';

export const registry: Record<string, Integration> = Object.fromEntries(
  [aimonitor, glances, homeassistant, http, qbittorrent, tautulli].map(i => [i.type, i as Integration]),
);
