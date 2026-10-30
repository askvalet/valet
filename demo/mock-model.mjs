// The demo's assistant: an OpenAI-compatible server with no AI in it. It reads the last question, picks a tool by
// keyword and words the answer from what the tool returned, so the chat, its cards and its approvals are all the real
// thing, with no key, no cost and nothing for a stranger to misuse. It never repeats what's typed into it.
import { createServer } from 'node:http';

const pick = (data, ...keys) => keys.reduce((v, k) => v?.[k], data);
// [what's asked, the tool (by the end of its name), its input, how to word the answer]
export const SCRIPT = [
  [/\b(pause|stop)\b.*(download|torrent)/i, 'pause_downloads', {}, d => d.denied ? 'Okay, downloads keep going.' : "Paused. They'll pick up again by themselves in ten minutes, since this is a demo."],
  [/\b(restart|fix|bring.*back)\b/i, 'restart_service', { name: 'Mealie' }, d => d.denied ? "Left it as it is." : 'Restarted Mealie and it answered straight away. It had run out of memory, so it may need a higher limit than 256 MB.'],
  [/\b(lights?|lamp|bright)\b/i, 'set_lights', { room: 'Living Room', on: false }, d => d.denied ? 'Okay, I left the lights alone.' : 'The living room is off. You can see it on the floor plan on the Home tab.'],
  [/\b(why|logs?|mealie|crash|memory leak|oom)\b/i, 'container_logs', { name: 'mealie' }, () => 'Mealie ran out of memory at 3:12 AM and hasn\'t come back. Its logs end with the out-of-memory kill, so it hit its 256 MB limit. Want me to restart it?'],
  [/\b(down|wrong|problem|broken|issue|healthy|ok|okay|working|status)\b/i, 'service_status', {}, d => { const bad = (d.services ?? []).filter(s => !s.ok); return bad.length ? `${bad.map(s => s.name).join(', ')} ${bad.length > 1 ? 'are' : 'is'} down; the other ${d.services.length - bad.length} are fine.` : `All ${d.services?.length} services are up.`; }],
  [/\b(downloads?|torrents?|stuck|finish)/i, 'downloads_status', {}, d => { const t = d.torrents ?? []; return t.length ? `${t.length} going at ${d.speed}. ${t[0].name} is at ${t[0].progress}${t[0].left ? ` with about ${t[0].left} left` : ''}.` : 'Nothing is downloading right now.'; }],
  [/\b(playing|streaming|on plex|who.*watching)\b/i, 'plex_streams', {}, d => { const s = d.streams?.[0]; return s ? `${s.user} is watching ${s.title} on the ${s.device}, with ${s.left} left.` : 'Nobody is watching anything.'; }],
  [/\b(recommend\w*|tonight|friday|evening|suggest\w*|watch|popular|movies?|films?|shows?)/i, 'plex_stats', {}, d => `The household's favourite lately is ${d.top}. If you'd like something new, ${d.unwatched} was added this week and nobody has started it.`],
  [/\b(drives?|disks?|storage|space|smart|temperatures?)/i, 'drive_health', {}, d => `All ${d.drives?.length} drives pass their health checks. The warmest is ${d.hottest}.`],
  [/\b(cpu|gpu|ram|memory|system|load|power|how.*(server|lab))\b/i, 'system_status', {}, d => `The server is comfortable: CPU at ${d.cpu}, memory at ${d.memory}, GPU at ${d.gpu}.`],
  [/\b(happened|overnight|yesterday|last night|recent|new|update)\b/i, 'what_happened', {}, d => `Mostly quiet. ${d.summary}`],
];
export const FALLBACK = "I'm a scripted stand-in here, so I only know a few things. Try asking what's down, how the downloads are doing, what to watch tonight, or to turn off the lights. On your own Valet this is a real model, local or hosted, or none at all.";
export const SUGGESTIONS = ['Why is Mealie down?', 'What should we watch tonight?', 'Turn off the living room lights', 'Anything happen overnight?'];

const textOf = c => typeof c === 'string' ? c : Array.isArray(c) ? c.map(p => p.text ?? '').join(' ') : '';
export function reply(body) {
  const msgs = body.messages ?? [], all = msgs.map(m => textOf(m.content)).join('\n');
  if (/suggest what the owner/.test(all)) return { text: SUGGESTIONS.join('\n') };
  if (/one short line/.test(all)) return { text: 'Mealie is down, everything else is fine' };
  if (/explain what's on a homelab dashboard/.test(all)) return { text: 'Mealie ran out of memory at 3:12 AM and hit its 256 MB limit. Restart it, and give it more memory if it happens again.' };
  const last = msgs.at(-1), asked = textOf(msgs.findLast(m => m.role === 'user')?.content);
  const rule = SCRIPT.find(([re]) => re.test(asked));
  if (!rule) return { text: FALLBACK };
  const [, tool, input, say] = rule;
  if (last?.role === 'tool') {
    let data = {};
    try { data = JSON.parse(textOf(last.content)); } catch { data = /denied|not approved/i.test(textOf(last.content)) ? { denied: true } : {}; }
    if (/denied/i.test(data?.type ?? '') || data?.denied) data = { denied: true };
    return { text: say(data) };
  }
  const name = (body.tools ?? []).map(t => t.function?.name).find(n => n?.endsWith(tool));
  return name ? { call: { name, args: JSON.stringify(input) } } : { text: FALLBACK };
}

const sleep = ms => new Promise(r => setTimeout(r, ms));
const server = createServer((req, res) => {
  if (req.method !== 'POST' || !req.url.endsWith('/chat/completions')) { res.writeHead(404).end(); return; }
  let raw = '', size = 0;
  req.on('data', c => { size += c.length; if (size > 9e6) req.destroy(); else raw += c; });
  req.on('end', async () => {
    let body; try { body = JSON.parse(raw); } catch { res.writeHead(400).end(); return; }
    const r = reply(body), base = { id: 'demo', object: 'chat.completion', created: Math.floor(Date.now() / 1000), model: 'scripted demo' };
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
    if (toolCall) { await sleep(300); send({ tool_calls: [{ index: 0, ...toolCall }] }); }
    else for (const w of r.text.split(/(?<= )/)) { send({ content: w }); await sleep(22); }
    send({}, toolCall ? 'tool_calls' : 'stop');
    res.write(`data: ${JSON.stringify({ ...base, object: 'chat.completion.chunk', choices: [], usage })}\n\ndata: [DONE]\n\n`);
    res.end();
  });
});
if (process.argv[1]?.endsWith('mock-model.mjs')) server.listen(8080, () => console.log('scripted model on :8080'));
