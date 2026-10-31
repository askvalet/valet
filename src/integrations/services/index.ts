// Every service defined with service(): a file per family, so adding one is a few lines in the right place.
import type { Integration } from '../../server/core.ts';
import apps from './apps.ts';
import downloads from './downloads.ts';
import infra from './infra.ts';
import media from './media.ts';
import network from './network.ts';

export const services: (Integration<any> & { def: any })[] = [...media, ...downloads, ...network, ...infra, ...apps];
