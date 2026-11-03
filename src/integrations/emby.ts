// Emby: the same cards and tools as Jellyfin (jellyfin.ts), which began as its fork and still shares its API. What
// differs is here: everything lives under /emby, and the per-user lists are under /Users/{id}.
import { mediaServer } from './jellyfin.ts';

export default mediaServer({
  type: 'emby', name: 'Emby', prefix: '/emby',
  resume: u => `/Users/${u}/Items/Resume?`, latest: u => `/Users/${u}/Items/Latest?`, items: u => `/Users/${u}/Items?`,
  sessions: '/Sessions',
  link: (web, i) => `${web}/web/index.html#!/item?id=${i.Id}${typeof i.ServerId === 'string' && /^[A-Za-z0-9-]{1,64}$/.test(i.ServerId) ? `&serverId=${i.ServerId}` : ''}`,
  auth: key => ({ 'X-Emby-Token': key }),
});
