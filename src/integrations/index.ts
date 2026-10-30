// Built-in integrations. Each file is self-contained; adding one is a new file plus a line here.
import type { Integration } from '../server/core.ts';
import aimonitor from './aimonitor.ts';
import arr from './arr.ts';
import glances from './glances.ts';
import homeassistant from './homeassistant.ts';
import immich from './immich.ts';
import indexers from './indexers.ts';
import karakeep from './karakeep.ts';
import paperless from './paperless.ts';
import http from './http.ts';
import ollama from './ollama.ts';
import pihole from './pihole.ts';
import qbittorrent from './qbittorrent.ts';
import quran from './quran.ts';
import rgbcontrol from './rgbcontrol.ts';
import romm from './romm.ts';
import scrutiny from './scrutiny.ts';
import seerr from './seerr.ts';
import tautulli from './tautulli.ts';
import uptimekuma from './uptimekuma.ts';
import weather from './weather.ts';

export const registry: Record<string, Integration> = Object.fromEntries(
  [aimonitor, arr, glances, homeassistant, http, immich, indexers, karakeep, ollama, paperless, pihole, qbittorrent, quran, rgbcontrol, romm, scrutiny, seerr, tautulli, uptimekuma, weather].map(i => [i.type, i as Integration]),
);
