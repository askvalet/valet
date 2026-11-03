// A fixture for every integration that isn't a service(): those carry their own sample.
import { feeds } from './feeds.ts';
import { home } from './home.ts';
import { homeRich } from './home-rich.ts';
import { infra } from './infra.ts';
import { infraRich } from './infra-rich.ts';
import { media } from './media.ts';
import { mediaRich } from './media-rich.ts';
import type { Fixture } from './types.ts';

export const fixtures: Record<string, Fixture> = { ...media, ...mediaRich, ...home, ...homeRich, ...infra, ...infraRich, ...feeds };
