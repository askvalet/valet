// Writes docs/services.md from the catalog, so the list of what Valet supports can't drift from what it does.
// `npm run docs:services`; a test fails if it's out of date.
import { writeFileSync } from 'node:fs';
import { registry } from '../src/integrations/index.ts';

const AUTH = (a: any, optional?: boolean) => { const t = !a || a === 'none' ? 'none' : a === 'basic' ? 'username, password' : a === 'bearer' || a === 'token' || a.header || a.query ? 'key' : a.login ? (a.needs ?? ['username', 'password']).join(', ') : a.handshake ? 'username, password' : 'see docs'; return optional && t !== 'none' ? `${t} (optional)` : t; };
export function doc() {
  const all = Object.values(registry).sort((a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }));
  const short = all.filter((i: any) => i.def), full = all.filter((i: any) => !i.def);
  return `# Supported services

Generated from the code by \`npm run docs:services\`: please don't edit by hand.

${all.length} integrations. If yours isn't here, \`type: api\` turns any JSON API into a card from YAML, and a new integration is
usually about ten lines ([docs/plugins.md](plugins.md)).

**How these are tested:** every service below runs in \`npm test\` against a sample of its API, which proves the card, the
sign-in flow and failure handling. A sample can't prove the service still answers that way, so if one misbehaves on your
version, please open an issue with the response it sent. \`npm run test:services\` runs them against your real services.

Self-signed certificate (Proxmox, TrueNAS and friends)? Add \`insecure: true\` to that integration.

## Full integrations

| Service | \`type:\` |
|---|---|
${full.map(i => `| ${i.name} | \`${i.type}\` |`).join('\n')}

## Catalog

Each needs \`url:\` plus what's listed, and gives a card, a tile and a read-only tool for the assistant.

| Service | \`type:\` | Sign-in |
|---|---|---|
${short.map((i: any) => `| ${i.name} | \`${i.type}\` | ${AUTH(i.def.auth, i.def.authOptional)} |`).join('\n')}

## Not supported yet

FRITZ!Box (SOAP), QNAP (XML sign-in), Omada, UrBackup and JDownloader (signed or multi-step sign-in), and GameDig (many game
protocols). Help welcome.
`;
}
if (process.argv[1]?.endsWith('services-doc.mjs')) writeFileSync('docs/services.md', doc());
