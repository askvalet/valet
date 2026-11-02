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
const ROOM_IDS = ['living room', 'kitchen', 'dining room', 'hallway', 'office', 'bedroom', 'bathroom', 'laundry', 'guest room'];
const roomId = said => ROOM_IDS.findIndex(r => said.toLowerCase().includes(r)) + 1;
const lights = said => ({ room: /\ball\b/i.test(said) ? 'All' : titled(new RegExp(lit, 'i').exec(said)?.[0].toLowerCase() ?? 'living room'), on: /\bon\b/i.test(said) });
const logsSay = d => d.up ? 'Mealie is running again. It ran out of memory at 3:12 AM when it hit its 256 MB limit, so it may need a higher one.' : 'Mealie ran out of memory at 3:12 AM and hasn\'t come back. Its logs end with the out-of-memory kill, so it hit its 256 MB limit. Want me to restart it?';
// [what's said, the tool (by its name), its input, or how to get it from what's said, how to word the answer]. An order has
// to match the whole sentence, so a question or a passing mention can never touch the house.
export const ORDERS = [
  [/^(?:pause|stop|hold) (?:all |the |my )*(?:downloads?|torrents?)$/i, 'pause_downloads', {}, d => d.denied ? 'Okay, downloads keep going.' : "Paused. They'll pick up again by themselves in ten minutes, since this is a demo."],
  [/^(?:restart|reboot|revive|fix) (?:the )?mealie(?: container| service)?$|^bring (?:the )?mealie back(?: up)?$/i, 'restart_service', { name: 'Mealie' }, d => d.denied ? 'Left it as it is.' : d.wasUp ? "Restarted Mealie. It was already up, and it's answering." : 'Restarted Mealie and it answered straight away. It had run out of memory, so it may need a higher limit than 256 MB.'],
  [new RegExp(String.raw`^(?:turn|switch) (?:on|off) (?:all )?(?:of )?(?:the |my )?(?:${lit} )?lights?$|^(?:turn|switch) (?:all )?(?:of )?(?:the |my )?(?:${lit} )?lights? (?:on|off)$`, 'i'), 'set_lights', lights, d => d.denied ? 'Okay, I left the lights alone.' : `${d.room === 'All' ? 'All the lights are' : `The ${d.room?.toLowerCase()} lights are`} ${d.on ? 'on' : 'off'}. You can see it on the floor plan on the Home tab.`],
  [new RegExp(String.raw`^(?:set|change|put|turn) ${heat}(?: up| down)? to (\d\d?(?:\.\d)?)(?:\s*(?:°|degrees?)\s*c?)?$`, 'i'), 'set_thermostat', (said, m) => ({ temperature: Math.min(30, Math.max(10, Number(m[1]))) }), d => d.denied ? 'Okay, the thermostat stays as it is.' : `The hallway is set to ${d.temperature}°, and the room will drift there over a few minutes.`],
  [new RegExp(String.raw`^(?:set|put|switch) ${heat} to (home|sleep|night)(?: mode)?$`, 'i'), 'set_thermostat', (said, m) => ({ preset: m[1].toLowerCase() }), d => d.denied ? 'Okay, the thermostat stays as it is.' : `The hallway is on its ${d.preset} setting.`],
  [new RegExp(String.raw`^turn (?:on|off) ${heat}$|^turn ${heat} (?:on|off)$`, 'i'), 'set_thermostat', said => ({ power: /\bon\b/i.test(said) }), d => d.denied ? 'Okay, the thermostat stays as it is.' : `The heating is ${d.power ? 'on' : 'off'}.`],
  [new RegExp(String.raw`^(?:(?:vacuum|clean) (?:the )?(?:${cleaned})|send ${robot} to (?:the )?(?:${cleaned}))$`, 'i'), 'run_vacuum', said => ({ command: 'clean_rooms', rooms: [roomId(said)] }), vacuumSay],
  [new RegExp(String.raw`^(?:start|run) ${robot}$|^(?:vacuum|clean) (?:the )?(?:house|floors?)$`, 'i'), 'run_vacuum', { command: 'start' }, vacuumSay],
  [new RegExp(String.raw`^(?:dock|stop) ${robot}$|^send ${robot} (?:home|back|to (?:the |its )?dock)$`, 'i'), 'run_vacuum', { command: 'dock' }, vacuumSay],
  [new RegExp(String.raw`^find ${robot}$`, 'i'), 'run_vacuum', { command: 'locate' }, vacuumSay],
];
export const ANSWERS = [
  [/^(?=.*\bmealie\b).*\b(?:why|how'?s|how is|logs?|down|up|wrong|happened|crash\w*|stopped|broken|diagnose|check|status|ok|okay|working|running|memory)\b|\bwhy\b.*\b(?:it|that)\b.*\b(?:down|crash\w*|stopp?\w*|fail\w*)\b/i, 'container_logs', { name: 'mealie' }, logsSay],
  [/\bbazarr\b/i, 'service_status', {}, () => BAZARR],
  [/\b(?:anything|everything|something|services?|homelab|lab)\b.*\b(?:down|wrong|broken|ok|okay|fine|healthy|working|up|problems?|issues?|status)\b|\bhealth check\b/i, 'service_status', {}, d => { const all = d.services ?? [], bad = all.filter(s => !s.ok && !s.quiet), up = all.filter(s => s.ok).length, off = all.length - bad.length - up, rest = off ? `, and ${off} ${off > 1 ? 'are' : 'is'} off by choice` : ''; return bad.length ? `${bad.map(s => s.name).join(', ')} ${bad.length > 1 ? 'are' : 'is'} down; the other ${up} are fine${rest}.` : `${off ? `${up} of ${all.length}` : `All ${all.length}`} services are up${rest}.`; }],
  [/\b(?:downloads?|torrents?)\b|\b(?:when|how long)\b.*\b(?:finish|done)\b/i, 'downloads_status', {}, d => { const all = d.torrents ?? [], t = all.filter(x => !x.stalled), stuck = all.filter(x => x.stalled).map(x => ` ${x.name} is stalled at ${x.progress} with no peers.`).join(''); return t.length ? `${t.length} going at ${d.speed}. ${t[0].name} is at ${t[0].progress}${t[0].left ? ` with about ${t[0].left} left` : ''}.${stuck}` : 'Nothing is downloading right now.'; }],
  [/\b(?:playing|streaming|who'?s watching|who is watching|on plex)\b/i, 'plex_streams', {}, d => { const s = d.streams?.[0]; return s ? `${s.user} is watching ${s.title} on the ${s.device}, with ${s.left} left.` : 'Nobody is watching anything.'; }],
  [/\b(?:recommend\w*|something to watch|what\b.*\bwatch|watch tonight|popular|most watched|good (?:movies?|films?|shows?)|(?:movie|film) night)\b/i, 'plex_stats', {}, d => `The household's favourite lately is ${d.top}. If you'd like something new, ${d.unwatched} was added this week and nobody has started it.`],
  [/\b(?:disks?|drives?)\b.*\b(?:health\w*|ok|okay|hot|warm|temp\w*|fail\w*|full|space|status|doing)\b|\bhow\b.*\b(?:disks?|drives?)\b|\b(?:storage|nvme|ssd)\b/i, 'drive_health', {}, d => `All ${d.drives?.length} drives pass their health checks. The warmest is ${d.hottest}.`],
  [/\b(?:cpu|gpu|ram)\b|\b(?:server|system)\b.*\b(?:load|busy|memory|doing|comfortable)\b|\bhow\b.*\b(?:server|lab|homelab)\b|\bhow much (?:memory|ram)\b.*\b(?:server|system|homelab|left|free|used|using|in use)\b|\bmemory (?:usage|use|used|in use|left|free)\b/i, 'system_status', {}, d => `The server is comfortable: CPU at ${d.cpu}, memory at ${d.memory}, GPU at ${d.gpu}.`],
  [/\b(?:overnight|last night|this morning)\b|\banything (?:happen|happened|new)\b|\bwhat happened\b/i, 'what_happened', {}, d => `Mostly quiet. ${d.summary}`],
];
export const SCRIPT = [...ORDERS, ...ANSWERS];
function vacuumSay(d) { return d.denied ? 'Okay, the vacuum stays where it is.' : `${d.status}. You can follow it on the floor plan on the Home tab.`; }

// What it can't do, said plainly, rather than the nearest thing it can. TOPICS win over any answer; OTHERS only speak up
// when no answer fits, so "how much memory is free" still gets one.
const standIn = "This demo only knows a few things", noFiles = "so I can't read files. On a real Valet, the assistant would read what you attached and answer from it.";
const TOPICS = [
  [/\b(?:files?|attach\w*|upload\w*|pdfs?|documents?|photos?|pictures?|images?|screenshots?|spreadsheets?)\b/i, noFiles],
  [/^(?:turn|switch|set|start|stop|pause|resume|cancel|delete|remove|open|close|lock|unlock|kill|shut|reboot|restart|play|add|install|update|upgrade|change|run|send|clean|dock)\b/i, 'so I can only do a few things, asked plainly: restart Mealie, turn a room\'s lights on or off, set the thermostat, send the vacuum or pause downloads. On a real Valet, the assistant could do whatever you allow, after asking you first.'],
  [/\b(?:lights?|lamps?|bulbs?|thermostat|heating|vacuum|robot)\b/i, "so I can act on a plain instruction, but I can't look at the house to answer questions about it. On a real Valet, the assistant would check Home Assistant and tell you."],
  [/\b(?:remember|remind|forget|recall|memories)\b|\bwhat'?s my name\b|\bwho am i\b/i, "so I don't remember anything between questions. On a real Valet, the assistant can look back through your services' history and its own activity log."],
];
const OTHERS = [
  [/\bmemory\b/i, TOPICS[3][1]],
  [/\b(?:weather|forecast|rain|calendar|schedule|appointments?)\b/i, "so I can't look that up. On a real Valet, the assistant would ask the weather or calendar you've connected."],
];
export const can = 'Here I can explain why Mealie is down and restart it, turn the lights on or off, suggest what to watch, sum up last night or check the downloads.';
export const FALLBACK = `${standIn}. ${can} On a real Valet this is your own model, local or hosted, or none at all.`;
const noAnswer = `${standIn}, so I can't answer that one. On a real Valet, a real model would work it out from your own services.`;
// The page lists "Why is Mealie down?" itself, live from the status cards, while the server keeps this list for up to ten
// minutes. So nothing here may depend on Mealie still being down, or it would outlive the restart.
export const SUGGESTIONS = ['What should we watch tonight?', 'Turn off the living room lights', 'Anything happen overnight?', 'How are the downloads doing?'];
export const suggestions = down => down ? SUGGESTIONS : ['What took Mealie down?', ...SUGGESTIONS.slice(0, 3)];

const textOf = c => typeof c === 'string' ? c : Array.isArray(c) ? c.map(p => p.text ?? '').join(' ') : '';
const hasFile = c => /\[attached: /.test(textOf(c)) || (Array.isArray(c) && c.some(p => p.type && p.type !== 'text'));
/** What the page reported as wrong: the words after the heading, so a mention elsewhere on the page doesn't count. */
const sick = text => /bazarr is unhealthy/i.test(/Wrong right now:\n([\s\S]*?)(?:\n\n|$)/.exec(text)?.[1] ?? '');
const mealieDown = text => /mealie is down/i.test(/Wrong right now:\n([\s\S]*?)(?:\n\n|$)/.exec(text)?.[1] ?? '');
/** The sentence without its manners, so "Hey, could you restart Mealie, please?" is the same order as "restart mealie". */
const plain = said => said.replace(/\n?\[attached: [^\]]*\]/g, '').trim().replace(/^(?:(?:hey|hi|ok|okay|valet|please)\b[,!]*\s+)+/i, '').replace(/^(?:can|could|would|will) you (?:please )?(.*?)\??$/i, '$1').replace(/^please\s+/i, '').replace(/[,\s]+(?:please|thanks|thank you)[.!\s]*$/i, '').replace(/[.!\s]+$/, '');
const NO = /^(?:no|nope|nah|not now|don'?t|leave it|no thanks)\b[\s.!]*$/i, HELLO = /^(?:hi|hello|hey|yo|hiya|good (?:morning|afternoon|evening))\b[\s.!]*$/i, THANKS = /^(?:thanks?|thank you|ty|cheers|nice|great|cool|perfect)\b[\s.!]*$/i;
const YES = /^(?:yes|yep|yeah|sure|ok|okay|go ahead|do it|restart it|please do|yes please)\b[\s.!]*$/i;

export function reply(body) {
  const msgs = body.messages ?? [], all = msgs.map(m => textOf(m.content)).join('\n'), system = msgs.filter(m => m.role === 'system' || m.role === 'developer').map(m => textOf(m.content)).join('\n');
  if (/suggest what the owner/.test(system)) return { text: suggestions(mealieDown(all)).join('\n') };
  if (/one short line/.test(system)) return { text: mealieDown(all) ? (sick(all) ? 'Mealie is down and Bazarr is unhealthy' : 'Mealie is down, everything else is fine') : sick(all) ? 'Bazarr is unhealthy, the rest is quiet' : 'All quiet, everything is up' };
  if (/explain what's on a homelab dashboard/.test(system)) return { text: /Asked about:[^\n]*bazarr/i.test(all) ? BAZARR : /Asked about:[^\n]*(?:mealie|services|containers|uptime)/i.test(all) && /"ok":false/.test(all) ? 'Mealie ran out of memory at 3:12 AM and hit its 256 MB limit. Restart it, and give it more memory if it happens again.' : `${standIn}, so I can't explain this one. On a real Valet, the assistant would read this card's numbers and say what's behind them.` };
  const last = msgs.at(-1), at = msgs.findLastIndex(m => m.role === 'user'), user = msgs[at]?.content, offered = /Want me to restart it\?\s*$/.test(textOf(msgs.slice(0, Math.max(at, 0)).findLast(m => m.role === 'assistant')?.content));
  const said = YES.test(plain(textOf(user))) && offered ? 'restart mealie' : plain(textOf(user));
  const told = msgs.slice(0, Math.max(at, 0)).some(m => m.role === 'assistant' && textOf(m.content).includes(can));
  const cant = why => ({ text: `${standIn}, ${why}${told ? '' : ` ${can}`}` });
  const offScript = () => told ? { text: noAnswer } : { text: FALLBACK };
  if (hasFile(user)) return cant(noFiles);
  if (offered && NO.test(said)) return { text: 'Okay, I\'ll leave it for now.' };
  if (HELLO.test(said)) return { text: `Hi! ${can}` };
  if (/\b(?:year in review|wrapped|recap)\b/i.test(said)) return { text: 'It\'s ready: pick "in review" just below and it plays from the start.' };
  if (THANKS.test(said)) return { text: 'Anytime.' };
  const rule = ORDERS.find(([re]) => re.test(said)), before = !rule && TOPICS.find(([re]) => re.test(said));
  if (before) return cant(before[1]);
  const answer = rule ?? ANSWERS.find(([re]) => re.test(said));
  if (!answer) { const limit = OTHERS.find(([re]) => re.test(said)); return limit ? cant(limit[1]) : offScript(); }
  const [re, tool, input, say] = answer;
  if (last?.role === 'tool') {
    let data = {};
    try { data = JSON.parse(textOf(last.content)); } catch { data = /denied|not approved/i.test(textOf(last.content)) ? { denied: true } : {}; }
    if (/denied/i.test(data?.type ?? '') || data?.denied) data = { denied: true };
    return { text: say(data) };
  }
  const name = (body.tools ?? []).map(t => t.function?.name).find(n => n?.endsWith(tool));
  return name ? { call: { name, args: JSON.stringify(typeof input === 'function' ? input(said, re.exec(said)) : input) } } : offScript();
}

const sleep = ms => new Promise(r => setTimeout(r, ms));
const between = (lo, hi) => lo + Math.random() * (hi - lo);
const server = createServer((req, res) => {
  if (req.method !== 'POST' || !req.url.endsWith('/chat/completions')) { res.writeHead(404).end(); return; }
  let raw = '', size = 0;
  req.on('data', c => { size += c.length; if (size > 9e6) req.destroy(); else raw += c; });
  req.on('end', async () => {
    let body; try { body = JSON.parse(raw); } catch { res.writeHead(400).end(); return; }
    const r = reply(body), base = { id: 'demo', object: 'chat.completion', created: Math.floor(Date.now() / 1000), model: 'qwen3.8-27b' };
    const usage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
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
if (process.argv[1]?.endsWith('mock-model.mjs')) server.listen(8080, () => console.log('scripted model on :8080'));
