// Built-in integrations. Each file is self-contained; adding one is a new file plus a line here.
import type { Integration } from '../server/core.ts';
import aimonitor from './aimonitor.ts';
import glances from './glances.ts';
import homeassistant from './homeassistant.ts';
import karakeep from './karakeep.ts';
import paperless from './paperless.ts';
import http from './http.ts';
import qbittorrent from './qbittorrent.ts';
import rgbcontrol from './rgbcontrol.ts';
import seerr from './seerr.ts';
import tautulli from './tautulli.ts';
import weather from './weather.ts';

export const registry: Record<string, Integration> = Object.fromEntries(
  [aimonitor, glances, homeassistant, http, karakeep, paperless, qbittorrent, rgbcontrol, seerr, tautulli, weather].map(i => [i.type, i as Integration]),
);
