// Where an integration sits in the sidebar. service() types take their family's name; anything here overrides it.
export const FAMILY_NAMES: Record<string, string> = { media: 'Media', downloads: 'Downloads', network: 'Network', infra: 'Infrastructure', apps: 'Apps' };
const group = (name: string, types: string) => Object.fromEntries(types.split(' ').map(t => [t, name]));
export const CATEGORIES = ['Media', 'Downloads', 'Network', 'Infrastructure', 'Home and daily life', 'Feeds and web', 'Apps', 'Build your own'];
export const CATEGORY: Record<string, string> = {
  ...group('Media', 'arr tautulli seerr immich romm komga kavita'),
  ...group('Downloads', 'qbittorrent indexers'),
  ...group('Network', 'pihole speedtest-tracker'),
  ...group('Infrastructure', 'docker glances host uptimekuma scrutiny apcups minecraft ollama aimonitor proxmox backrest healthchecks'),
  ...group('Home and daily life', 'homeassistant weather calendar camera rgb-control todo clock frigate esphome evcc homebridge opendtu octoprint moonraker spoolman mealie tandoor'),
  ...group('Feeds and web', 'rss hackernews lobsters reddit releases repository markets twitch miniflux'),
  ...group('Apps', 'changedetection karakeep paperless syncthing'),
  ...group('Build your own', 'api http iframe links'),
};
// docs/services.md's list, and the things people ask for most.
export const UNSUPPORTED: { what: string; why: string }[] = [
  { what: 'MJPEG streams', why: 'The cameras card shows a JPEG snapshot, refreshed about once a second, or a video the browser can play, such as MP4. Point `camera` at the camera\'s snapshot address, or use an RTSP-to-JPEG bridge. Frigate has its own integration.' },
  { what: 'RTSP', why: 'Browsers can\'t play it. The same answer as MJPEG: use a snapshot address or a bridge.' },
  { what: 'FRITZ!Box', why: 'It speaks SOAP.' },
  { what: 'QNAP', why: 'Its sign-in is XML.' },
  { what: 'Omada, UrBackup and JDownloader', why: 'Each needs a signed or multi-step sign-in.' },
  { what: 'GameDig', why: 'It covers many game protocols. Minecraft has its own integration.' },
];
