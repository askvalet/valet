// A fixture for every integration that isn't a service(): those carry their own sample.
import { feeds } from './feeds.ts';
import { home } from './home.ts';
import { infra } from './infra.ts';
import { media } from './media.ts';
import type { Fixture } from './types.ts';

export const fixtures: Record<string, Fixture> = { ...media, ...home, ...infra, ...feeds };
