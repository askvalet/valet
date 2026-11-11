// The demo's assistant: an OpenAI-compatible server with no AI in it. It reads the last question and follows a short
// script: anything that changes the house needs a plain instruction, a question only gets an answer it was written for,
// and the rest gets an honest "I can't", so the chat, its cards and its approvals are all the real thing, with no key, no
// cost and nothing for a stranger to misuse. It never repeats what's typed into it.
import { createServer } from 'node:http';

const BAZARR = 'Bazarr is running fine, and subtitles are keeping up.';
const lit = '(?:living room|kitchen|dining room|hallway|office|bedroom|bathroom|guest room)', cleaned = `(?:${lit}|laundry)`;
const titled = s => s.replace(/\b\w/g, c => c.toUpperCase());
const robot = String.raw`(?:the |my )?(?:vacuum|robot|robot vacuum)`;
const heat = String.raw`(?:the |my )?(?:thermostat|heat|heating|furnace|hallway)`;
const watched = '(?:oppenheimer|andor)', tellMe = '(?:tell me|let me know|ping me|notify me)', getting = String.raw`(?:the )?${watched}(?: download)?`, done = '(?:finishes|is done|has finished|is finished|completes|is downloaded)(?: downloading)?';
const ROOM_IDS = ['living room', 'kitchen', 'dining room', 'hallway', 'office', 'bedroom', 'bathroom', 'laundry', 'guest room'];
const roomId = said => ROOM_IDS.findIndex(r => said.toLowerCase().includes(r)) + 1;
const lights = said => ({ room: /\ball\b/i.test(said) ? 'All' : titled(new RegExp(lit, 'i').exec(said)?.[0].toLowerCase() ?? 'living room'), on: /\bon\b/i.test(said) });
const logsSay = d => d.up ? 'Mealie is running again. It ran out of memory at 3:12 AM when it hit its 256 MB limit, so it may need a higher one.' : 'Mealie ran out of memory at 3:12 AM and hasn\'t come back. Its logs end with the out-of-memory kill, so it hit its 256 MB limit. Raise `mem_limit` to 512 MB in its compose file and start it again.';
// [what's said, the tool (by its name), its input, or how to get it from what's said, how to word the answer]. An order has
// to match the whole sentence, so a question or a passing mention can never touch the house.
export const ORDERS = [
  [/^(?:add|put|show)\b.*\b(?:internet|speed\w*)\b.*$/i, 'add_speed_card', {}, d => d.denied ? 'Okay, the page stays as it is.' : "Done. Internet speed is on your page, under Services. Say undo and it's gone."],
  [/^(?:undo(?: that| it)?|take (?:it|that) (?:back|off)|remove (?:it|that|the (?:internet |speed )*card))$/i, 'undo_config', {}, d => d.denied ? 'Okay, it stays.' : d.undone ? 'Undone. The page is back as it was.' : "There's nothing to undo yet."],
  [/^(?:pause|stop|hold) (?:all |the |my )*(?:downloads?|torrents?)$/i, 'pause_downloads', {}, d => d.denied ? 'Okay, downloads keep going.' : "Paused. They'll pick up again by themselves in ten minutes, since this is a demo."],
  [/^(?:pause|stop|turn off|disable) (?:the |my )?(?:pi-?hole|ad ?block(?:ing|er)?|ads? blocking)(?: for (\d{1,4}) ?(?:min(?:ute)?s?|m))?$/i, 'adblock_pause', (said, m) => ({ minutes: Number(m?.[1] ?? 5) }), d => d.denied ? 'Okay, ad blocking stays on.' : `Ad blocking is paused for ${d.minutes ?? 5} minutes, then it turns itself back on.`],
  [/^stop (?:theo'?s |the |that )?(?:stream|movie|film|playback)(?: on plex)?$/i, 'plex_stop_stream', { who: 'Theo' }, d => d.denied ? 'Okay, Theo keeps watching.' : "Stopped Theo's stream, with a note saying you did."],
  [/^(?:resume|turn on|enable) (?:the |my )?(?:pi-?hole|ad ?block(?:ing|er)?)$/i, 'adblock_pause', { minutes: 0 }, d => d.denied ? 'Okay, it stays paused.' : 'Ad blocking is back on.'],
  [new RegExp(String.raw`^(?:turn|switch) (?:on|off) (?:all )?(?:of )?(?:the |my )?(?:${lit} )?lights?$|^(?:turn|switch) (?:all )?(?:of )?(?:the |my )?(?:${lit} )?lights? (?:on|off)$`, 'i'), 'set_lights', lights, d => d.denied ? 'Okay, I left the lights alone.' : `${d.room === 'All' ? 'All the lights are' : `The ${d.room?.toLowerCase()} lights are`} ${d.on ? 'on' : 'off'}. You can see it on the floor plan on the Home tab.`],
  [new RegExp(String.raw`^(?:set|change|put|turn) ${heat}(?: up| down)? to (\d\d?(?:\.\d)?)(?:\s*(?:°|degrees?)\s*c?)?$`, 'i'), 'set_thermostat', (said, m) => ({ temperature: Math.min(30, Math.max(10, Number(m[1]))) }), d => d.denied ? 'Okay, the thermostat stays as it is.' : `The hallway is set to ${d.temperature}°, and the room will drift there over a few minutes.`],
  [new RegExp(String.raw`^(?:set|put|switch) ${heat} to (home|sleep|night)(?: mode)?$`, 'i'), 'set_thermostat', (said, m) => ({ preset: m[1].toLowerCase() }), d => d.denied ? 'Okay, the thermostat stays as it is.' : `The hallway is on its ${d.preset} setting.`],
  [new RegExp(String.raw`^turn (?:on|off) ${heat}$|^turn ${heat} (?:on|off)$`, 'i'), 'set_thermostat', said => ({ power: /\bon\b/i.test(said) }), d => d.denied ? 'Okay, the thermostat stays as it is.' : `The heating is ${d.power ? 'on' : 'off'}.`],
  [new RegExp(String.raw`^(?:(?:vacuum|clean) (?:the )?(?:${cleaned})|send ${robot} to (?:the )?(?:${cleaned}))$`, 'i'), 'run_vacuum', said => ({ command: 'clean_rooms', rooms: [roomId(said)] }), vacuumSay],
  [new RegExp(String.raw`^(?:start|run) ${robot}$|^(?:vacuum|clean) (?:the )?(?:house|floors?)$`, 'i'), 'run_vacuum', { command: 'start' }, vacuumSay],
  [new RegExp(String.raw`^(?:dock|stop) ${robot}$|^send ${robot} (?:home|back|to (?:the |its )?dock)$`, 'i'), 'run_vacuum', { command: 'dock' }, vacuumSay],
  [new RegExp(String.raw`^find ${robot}$`, 'i'), 'run_vacuum', { command: 'locate' }, vacuumSay],
  // a reminder, as Valet's own watch_add sets one: the demo's downloads then finish in seconds, so it arrives while you look
  [new RegExp(String.raw`^(?:${tellMe}) (?:when|once) ${getting} ${done}$|^(?:when|once) ${getting} ${done},? (?:${tellMe})$`, 'i'), 'watch_add', said => { const t = titled(new RegExp(watched, 'i').exec(said)[0].toLowerCase());
    return { widget: 'lab.downloads', on: 'ends', name: t, say: `${t} has finished downloading` }; }, (d, said) => d.denied ? 'Okay, no reminder.' : d.error ? "I couldn't set that reminder." : `Done. I'll tell you when ${titled(new RegExp(watched, 'i').exec(said)?.[0].toLowerCase() ?? 'it')} finishes.`],
];
// The page offers "What's <title> about?" for what's playing (src/web/suggest.ts), so every title the demo plays has an answer
export const ABOUT = {
  'spider-man: brand new day': "Spider-Man: Brand New Day is Tom Holland's fourth Spider-Man film, picking up after No Way Home: Peter Parker starting over in a city that no longer remembers who he is.",
};
const aboutSay = said => { const t = /^what(?:'?s| is) (.+?) about\??$/i.exec(said.trim())?.[1]?.toLowerCase(); return t && ABOUT[t]; };
export const ANSWERS = [
  // web search, where `assistant.webSearch` is set (the docs' screenshots); without it there's no such tool and this is off script
  [/\b(?:search the web|on the web|look (?:it|that) up online)\b/i, 'web_search', said => ({ query: said.replace(/^.*?\bfor\b\s*/i, '').replace(/[?.!]+$/, '') || said }),
    d => { const r = d.results ?? []; if (!r.length) return 'I searched the web and found nothing useful.';
      const at = u => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return u; } };
      return `Back up two things: the database, as a dump made while Immich runs, and the upload folder with your originals. ${r[0].title} (${at(r[0].url)}) walks through both, and ${at(r[1]?.url ?? r[0].url)} has a restic schedule for them. Test a restore before you trust it.`; }],
  [/^what(?:'?s| is) .+ about\??$/i, null, {}, (d, said) => aboutSay(said) ?? `${standIn}, so it only knows what's playing right now. On a real Valet, the assistant would look the title up for you.`],
  [/\b(?:restart|reboot|revive)\b/i, null, {}, () => "Valet can't restart containers or services. It reads Docker through a read-only proxy on purpose, so a mistake, or a bad prompt, can't stop your stack. Restart it in Docker or Portainer."],
  [/\bhow (?:do|can|would) i\b.*\b(?:add|connect|support|build|make|write)\b|\b(?:valet|you) (?:doesn'?t|don'?t) (?:support|have)\b|\bnot supported\b/i, 'docs_search', {}, () => 'Two ways. If it has a JSON API, the `api` integration turns it into a card from YAML, with no code. Otherwise, one file in `data/integrations` adds a full integration in about ten lines. The Build an integration page in the docs has both.'],
  [/^(?=.*\bmealie\b).*\b(?:why|how'?s|how is|logs?|down|up|wrong|happened|crash\w*|stopped|broken|diagnose|check|status|ok|okay|working|running|memory)\b|\bwhy\b.*\b(?:it|that)\b.*\b(?:down|crash\w*|stopp?\w*|fail\w*)\b/i, 'container_logs', { name: 'mealie' }, logsSay],
  [/\bbazarr\b/i, 'service_status', {}, () => BAZARR],
  [/\b(?:next|my|today'?s?)\b.*\b(?:meetings?|calls?)\b|\bmeetings?\b/i, 'calendar_next_meeting', {}, d => { const m = d.next; if (!m) return 'No online meetings coming up.';
    const at = new Date(m.start), on = at <= new Date(), mins = Math.max(1, Math.round(((on ? new Date(m.end) : at) - new Date()) / 6e4));
    return on ? `${m.title} is on now, with ${m.with.slice(0, 2).join(' and ')}, for ${mins} more minutes. Join from the card.` : `${m.title}, in ${mins} minutes on ${m.provider}, with ${m.with.slice(0, 2).join(' and ')}. Join from the card, or say "join meeting" in ⌘K.`; }],
  [/\bbackups?\b|\bbacked up\b/i, 'backups_status', {}, backupsSay],
  [/\b(?:anything|everything|something|services?|homelab|lab)\b.*\b(?:down|wrong|broken|ok|okay|fine|healthy|working|up|problems?|issues?|status)\b|\bhealth check\b|\bwhat(?:'?s| is) (?:down|broken|wrong|not working|offline)\b/i, 'service_status', {}, d => { const all = d.services ?? [], bad = all.filter(s => !s.ok && !s.quiet), up = all.filter(s => s.ok).length, off = all.length - bad.length - up, rest = off ? `, and ${off} ${off > 1 ? 'are' : 'is'} off by choice` : ''; return bad.length ? `${bad.map(s => s.name).join(', ')} ${bad.length > 1 ? 'are' : 'is'} down; the other ${up} are fine${rest}.` : `${off ? `${up} of ${all.length}` : `All ${all.length}`} services are up${rest}.`; }],
  [/\b(?:downloads?|torrents?)\b|\b(?:when|how long)\b.*\b(?:finish|done)\b/i, 'downloads_status', {}, d => { const all = d.torrents ?? [], t = all.filter(x => !x.stalled), stuck = all.filter(x => x.stalled).map(x => ` ${x.name} is stalled at ${x.progress} with no peers.`).join(''); return t.length ? `${t.length} going at ${d.speed}. ${t[0].name} is at ${t[0].progress}${t[0].left ? ` with about ${t[0].left} left` : ''}.${stuck}` : 'Nothing is downloading right now.'; }],
  [/\b(?:playing|streaming|who'?s watching|who is watching|on plex)\b/i, 'plex_streams', {}, d => { const s = d.streams?.[0]; return s ? `${s.user} is watching ${s.title} on the ${s.device}, with ${s.left} left.` : 'Nobody is watching anything.'; }],
  [/\b(?:recommend\w*|something to watch|what\b.*\bwatch|watch tonight|popular|most watched|good (?:movies?|films?|shows?)|(?:movie|film) night)\b/i, 'plex_stats', {}, d => `The household's favourite lately is ${d.top}. If you'd like something new, ${d.unwatched} was added this week and nobody has started it.`],
  [/\b(?:disks?|drives?)\b.*\b(?:health\w*|ok|okay|hot|warm|temp\w*|fail\w*|full|space|status|doing)\b|\bhow\b.*\b(?:disks?|drives?)\b|\b(?:storage|nvme|ssd)\b/i, 'drive_health', {}, d => `All ${d.drives?.length} drives pass their health checks. The warmest is ${d.hottest}.`],
  [/\b(?:cpu|gpu|ram)\b|\b(?:server|system)\b.*\b(?:load|busy|memory|doing|comfortable)\b|\bhow\b.*\b(?:server|lab|homelab)\b|\bhow much (?:memory|ram)\b.*\b(?:server|system|homelab|left|free|used|using|in use)\b|\bmemory (?:usage|use|used|in use|left|free)\b/i, 'system_status', {}, d => `The server is comfortable: CPU at ${d.cpu}, memory at ${d.memory}, GPU at ${d.gpu}.`],
  [/\b(?:overnight|last night|this morning)\b|\banything (?:happen|happened|new)\b|\bwhat happened\b/i, 'what_happened', {}, d => `Mostly quiet. ${d.summary}`],
];
export const SCRIPT = [...ORDERS, ...ANSWERS];
function backupsSay(d) {
  const jobs = d.jobs ?? [], bad = jobs.filter(j => j.state === 'failed' || j.state === 'overdue'), odd = jobs.filter(j => j.sizeChange && !bad.includes(j)), fine = jobs.length - bad.length - odd.length;
  const when = j => /\(([^)]+)\)/.exec(j.lastGood ?? '')?.[1] ?? 'a while ago';
  const said = [...bad.map(j => `${j.job} (${j.source}) is ${j.state}: its last good backup was ${when(j)}, and it should run within ${j.expectedWithin}.`),
    ...odd.map(j => `${j.job} worked, but it ${j.sizeChange.startsWith('-') ? 'shrank' : 'grew'} ${j.sizeChange.replace(/^[-+]/, '')}, so it's worth a look.`), fine ? `The other ${fine} are fine.` : ''];
  return jobs.length ? (bad.length || odd.length ? said.join(' ').trim() : `All ${jobs.length} backups are fine.`) : 'Nothing here reports any backups yet.';
}
function vacuumSay(d) { return d.denied ? 'Okay, the vacuum stays where it is.' : `${d.status}. You can follow it on the floor plan on the Home tab.`; }

// What it can't do, said plainly, rather than the nearest thing it can. TOPICS win over any answer; OTHERS only speak up
// when no answer fits, so "how much memory is free" still gets one.
const standIn = "This demo only knows a few things", noFiles = "so I can't read files. On a real Valet, the assistant would read what you attached and answer from it.";
const TOPICS = [
  [/\b(?:files?|attach\w*|upload\w*|pdfs?|documents?|photos?|pictures?|images?|screenshots?|spreadsheets?)\b/i, noFiles],
  [/^(?:turn|switch|set|start|stop|pause|resume|cancel|delete|remove|open|close|lock|unlock|kill|shut|play|add|install|update|upgrade|change|run|send|clean|dock)\b/i, 'so I can only do a few things, asked plainly: restart Mealie, turn a room\'s lights on or off, set the thermostat, send the vacuum or pause downloads. On a real Valet, the assistant could do whatever you allow, after asking you first.'],
  [/\b(?:lights?|lamps?|bulbs?|thermostat|heating|vacuum|robot)\b/i, "so I can act on a plain instruction, but I can't look at the house to answer questions about it. On a real Valet, the assistant would check Home Assistant and tell you."],
  [/\b(?:remember|remind|forget|recall|memories)\b|\bwhat'?s my name\b|\bwho am i\b/i, "so I don't remember anything between questions. On a real Valet, the assistant can look back through your services' history and its own activity log."],
];
const OTHERS = [
  [/\bmemory\b/i, TOPICS[3][1]],
  [/\b(?:weather|forecast|rain|calendar|schedule|appointments?)\b/i, "so I can't look that up. On a real Valet, the assistant would ask the weather or calendar you've connected."],
];
export const can = 'Here I can explain why Mealie is down, pause Pi-hole, add an internet speed card to this page, turn the lights on or off, suggest what to watch, sum up last night, check the backups or check the downloads.';
export const FALLBACK = `${standIn}. ${can} On a real Valet this is your own model, local or hosted, or none at all.`;
const noAnswer = `${standIn}, so I can't answer that one. On a real Valet, a real model would work it out from your own services.`;
// The page lists "Why is Mealie down?" itself, live from the status cards, while the server keeps this list for up to ten
// minutes. So nothing here may say Mealie is up or down: the page says that, live.
export const SUGGESTIONS = ['Add an internet speed card', 'What should we watch tonight?', 'Turn off the living room lights', 'Anything happen overnight?'];
export const suggestions = down => down ? SUGGESTIONS : ['What took Mealie down?', ...SUGGESTIONS.slice(0, 3)];

const textOf = c => typeof c === 'string' ? c : Array.isArray(c) ? c.map(p => p.text ?? '').join(' ') : '';
// what the person typed, without the note Valet puts in front of it when earlier turns were summarised or left out
const own = c => Array.isArray(c) ? c.filter(p => !(p.type === 'text' && p.text?.startsWith('[Valet: '))) : c;
const hasFile = c => /\[attached: /.test(textOf(c)) || (Array.isArray(c) && c.some(p => p.type && p.type !== 'text'));
/** What the page reported as wrong: the words after the heading, so a mention elsewhere on the page doesn't count. */
const sick = text => /bazarr is unhealthy/i.test(/Wrong right now:\n([\s\S]*?)(?:\n\n|$)/.exec(text)?.[1] ?? '');
const mealieDown = text => /mealie is down/i.test(/Wrong right now:\n([\s\S]*?)(?:\n\n|$)/.exec(text)?.[1] ?? '');
/** The sentence without its manners, so "Hey, could you restart Mealie, please?" is the same order as "restart mealie". */
// an @mention says where to look, not what's asked, so the script reads the words around it
const plain = said => said.replace(/\n?\[attached: [^\]]*\]/g, '').replace(/(^|\s)@[\w.-]+(?=\s|$)/g, ' ').replace(/\s+/g, ' ').trim().replace(/^(?:(?:hey|hi|ok|okay|valet|please)\b[,!]*\s+)+/i, '').replace(/^(?:can|could|would|will) you (?:please )?(.*?)\??$/i, '$1').replace(/^please\s+/i, '').replace(/[,\s]+(?:please|thanks|thank you)[.!\s]*$/i, '').replace(/[.!\s]+$/, '');
const NO = /^(?:no|nope|nah|not now|don'?t|leave it|no thanks)\b[\s.!]*$/i, HELLO = /^(?:hi|hello|hey|yo|hiya|good (?:morning|afternoon|evening))\b[\s.!]*$/i, THANKS = /^(?:thanks?|thank you|ty|cheers|nice|great|cool|perfect)\b[\s.!]*$/i;
const YES = /^(?:yes|yep|yeah|sure|ok|okay|go ahead|do it|please do|yes please)\b[\s.!]*$/i;

export function reply(body) {
  const msgs = body.messages ?? [], all = msgs.map(m => textOf(m.content)).join('\n'), system = msgs.filter(m => m.role === 'system' || m.role === 'developer').map(m => textOf(m.content)).join('\n');
  if (/suggest what the owner/.test(system)) return { text: suggestions(mealieDown(all)).join('\n') };
  if (/one short line/.test(system)) return { text: mealieDown(all) ? (sick(all) ? 'Mealie is down and Bazarr is unhealthy' : 'Mealie is down, everything else is fine') : sick(all) ? 'Bazarr is unhealthy, the rest is quiet' : 'All quiet, everything is up' };
  // Valet folding the start of a long chat into a summary: a made-up one that only counts, so nothing typed comes back
  if (/You summarise the start of a conversation/.test(system)) { const n = (all.match(/^Person: /gm) ?? []).length; return { text: `The person asked ${n === 1 ? 'one question' : `${n} questions`} about their homelab, and each was answered from the page's tools. Nothing was changed.` }; }
  if (/explain what's on a homelab dashboard/.test(system)) return { text: /Asked about:[^\n]*bazarr/i.test(all) ? BAZARR : /Asked about:[^\n]*(?:mealie|services|containers|uptime)/i.test(all) && /"ok":false/.test(all) ? 'Mealie ran out of memory at 3:12 AM and hit its 256 MB limit. Give it more memory in its compose file and restart it there.' : `${standIn}, so I can't explain this one. On a real Valet, the assistant would read this card's numbers and say what's behind them.` };
  const last = msgs.at(-1), at = msgs.findLastIndex(m => m.role === 'user'), user = own(msgs[at]?.content), offered = /Want me to pause it\?\s*$/.test(textOf(msgs.slice(0, Math.max(at, 0)).findLast(m => m.role === 'assistant')?.content));
  const said = YES.test(plain(textOf(user))) && offered ? 'pause pi-hole' : plain(textOf(user));
  const told = msgs.slice(0, Math.max(at, 0)).some(m => m.role === 'assistant' && textOf(m.content).includes(can));
  const cant = why => ({ text: `${standIn}, ${why}${told ? '' : ` ${can}`}` });
  const offScript = () => told ? { text: noAnswer } : { text: FALLBACK };
  if (hasFile(user)) return cant(noFiles);
  if (offered && NO.test(said)) return { text: 'Okay, I\'ll leave it for now.' };
  if (HELLO.test(said)) return { text: `Hi! ${can}` };
  if (/\b(?:year in review|wrapped|recap)\b/i.test(said)) return { text: 'Open #recap and it plays from the start: the year your services had, told from their own numbers.' };
  if (THANKS.test(said)) return { text: 'Anytime.' };
  const rule = ORDERS.find(([re]) => re.test(said)), before = !rule && TOPICS.find(([re]) => re.test(said));
  if (before) return cant(before[1]);
  const answer = rule ?? ANSWERS.find(([re]) => re.test(said));
  if (!answer) { const limit = OTHERS.find(([re]) => re.test(said)); return limit ? cant(limit[1]) : offScript(); }
  const [re, tool, input, say] = answer;
  if (!tool) return { text: say({}, said) };
  if (last?.role === 'tool') {
    let data = {};
    try { data = JSON.parse(textOf(last.content)); } catch { data = /denied|not approved/i.test(textOf(last.content)) ? { denied: true } : {}; }
    if (/denied/i.test(data?.type ?? '') || data?.denied) data = { denied: true };
    return { text: say(data, said) };
  }
  const name = (body.tools ?? []).map(t => t.function?.name).find(n => n?.endsWith(tool));
  return name ? { call: { name, args: JSON.stringify(typeof input === 'function' ? input(said, re.exec(said)) : input) } } : offScript();
}

// what the stand-in's server lists at /v1/models, so `auto` in the demo's models has a list to offer. Whichever is picked,
// the same script answers, and how much it's asked to think changes nothing
export const MODELS = ['qwen3.8-27b', 'qwen3.8-4b', 'qwen3.8-235b-a22b', 'gemma-4-27b', 'gemma-4-12b', 'llama-4.2-70b', 'mistral-small-4', 'phi-5-mini', 'deepseek-v4-lite', 'olmo-3-32b', 'nomic-embed-text-v2'];
export const modelList = () => ({ object: 'list', data: MODELS.map(id => ({ id, object: 'model', created: 1767225600, owned_by: 'demo' })) });

const sleep = ms => new Promise(r => setTimeout(r, ms));
const between = (lo, hi) => lo + Math.random() * (hi - lo);
const server = createServer((req, res) => {
  if (req.method === 'GET' && req.url.replace(/\?.*$/, '').endsWith('/models')) { res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(modelList())); return; }
  if (req.method !== 'POST' || !req.url.endsWith('/chat/completions')) { res.writeHead(404).end(); return; }
  let raw = '', size = 0;
  req.on('data', c => { size += c.length; if (size > 9e6) req.destroy(); else raw += c; });
  req.on('end', async () => {
    let body; try { body = JSON.parse(raw); } catch { res.writeHead(400).end(); return; }
    const r = reply(body), base = { id: 'demo', object: 'chat.completion', created: Math.floor(Date.now() / 1000), model: typeof body.model === 'string' && MODELS.includes(body.model) ? body.model : 'qwen3.8-27b' };
    // about a token for every four characters, so the chat's context meter fills as it would with a real model
    const given = Math.round(JSON.stringify([body.messages, body.tools]).length / 4), said = Math.round(JSON.stringify(r.text ?? r.call ?? '').length / 4);
    const usage = { prompt_tokens: given, completion_tokens: said, total_tokens: given + said };
    // MOCK_CONTEXT=n plays a small model: past n tokens it refuses as an OpenAI-compatible server would
    if (Number(process.env.MOCK_CONTEXT) && given > Number(process.env.MOCK_CONTEXT)) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: `This model's maximum context length is ${process.env.MOCK_CONTEXT} tokens. However, you requested ${given} tokens.`, type: 'invalid_request_error', code: 'context_length_exceeded' } }));
      return;
    }
    const toolCall = r.call && { id: `call_${Date.now()}`, type: 'function', function: { name: r.call.name, arguments: r.call.args } };
    if (!body.stream) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ...base, usage, choices: [{ index: 0, finish_reason: toolCall ? 'tool_calls' : 'stop', message: { role: 'assistant', content: r.text ?? null, ...(toolCall ? { tool_calls: [toolCall] } : {}) } }] }));
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store' });
    const send = (delta, finish_reason = null) => res.write(`data: ${JSON.stringify({ ...base, object: 'chat.completion.chunk', choices: [{ index: 0, delta, finish_reason }] })}\n\n`);
    send({ role: 'assistant', content: '' });
    // paced like a model on a home GPU: a moment to think, then words in uneven runs, a beat after each sentence
    await sleep(between(900, 1600));
    if (toolCall) send({ tool_calls: [{ index: 0, ...toolCall }] });
    else for (const w of r.text.split(/(?<= )/)) { send({ content: w }); await sleep(between(28, 62) + (/[.,:;?!]\s*$/.test(w) ? between(80, 220) : 0)); }
    send({}, toolCall ? 'tool_calls' : 'stop');
    res.write(`data: ${JSON.stringify({ ...base, object: 'chat.completion.chunk', choices: [], usage })}\n\ndata: [DONE]\n\n`);
    res.end();
  });
});
if (process.argv[1]?.endsWith('mock-model.mjs')) { const port = Number(process.env.MOCK_PORT) || 8080; server.listen(port, () => console.log(`scripted model on :${port}`)); }
