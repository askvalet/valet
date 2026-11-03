// For integrations that read an endpoint you run yourself: the shape Valet expects, so anyone can serve it. Written in
// MDX and placed after the options on the integration's page.
export const FORMAT: Record<string, string> = {
  aimonitor: `## Your endpoint

This reads JSON from your own endpoint, so it works with any GPU and any model server once something answers in this
shape. [\`examples/local-ai/valet-local-ai.py\`](https://github.com/askvalet/valet/tree/master/examples/local-ai)
is a small server that does it from \`nvidia-smi\` and Ollama, using only Python's standard library.

**\`GET /api/live\`** is the only one that's required:

\`\`\`json
{
  "gpu": { "util": 34, "power": 182.5, "temp": 61, "mem": 18240, "mem_total": 24576 },
  "model": { "name": "qwen3:14b", "swapping": null },
  "running": [{ "app": "Open WebUI" }],
  "today": { "requests": 212, "tokens": 481200, "kwh": 0.42, "cost": 0.06 },
  "last_query": { "app": "Open WebUI" }
}
\`\`\`

- \`gpu\`: load in %, power in W, temperature in °C, memory used and total in MiB.
- \`model.swapping\`: the name of a model that's loading, or null.
- \`running\`: what's generating right now. An empty list means idle.
- \`today.kwh\`, \`today.cost\` and \`last_query\` are optional.

Two more add the day's graphs and the electricity cost, and are used when they answer:

- **\`GET /api/history\`**: \`{ "gpu": [...], "requests": [...], "totals": { "avg_tok_s": 41, "prompt_tokens": 920000 } }\`.
  Each \`gpu\` row is \`{ "at", "util", "power", "mem", "temp" }\` and each \`requests\` row is
  \`{ "at", "app", "requests", "tokens" }\`, with \`at\` in Unix seconds and the same times in both. Arrays in that order
  work too.
- **\`GET /api/cost\`**: \`{ "days": [{ "day": "2026-11-03", "tokens": 481200, "cost": 0.06, "kwh": 0.42 }], "month": 0.31 }\`.

To check your endpoint, open it in a browser or run \`curl http://your-host:8097/api/live\`. If something doesn't fit,
the card says which field.`,

  'rgb-control': `## Your endpoint

This reads JSON from your own endpoint, so it works with whatever controls your lights (OpenRGB, a vendor tool, your own
script) once something answers in this shape.

**\`GET /api/state\`**:

\`\`\`json
{
  "cards": [
    { "id": "fans0", "title": "Top fans", "modes": ["Static", "Breathing", "Rainbow", "Off"],
      "zones": [{ "id": "fan-1", "name": "Fan 1", "state": { "mode": "Static", "color": [255, 140, 40], "brightness": 100 } }] },
    { "id": "pump", "title": "Pump head", "zones": [{ "id": "pump-ring", "state": { "mode": "Rainbow" } }] }
  ],
  "presets": [{ "id": "warm", "name": "Warm", "swatch": ["#ffaa5a"] }],
  "layout": { "fans0": "top" },
  "telemetry": { "cpu_temp": 52, "gpu_temp": 47, "gpu_power": 96, "ram_used": 21.4, "ram_total": 64,
                 "liquid_temp": 31.5, "pump_rpm": 2460, "hub_rpm": [980, 0] }
}
\`\`\`

- \`cards\` are the parts of the PC. These ids light up on the model: \`fans0\` to \`fans9\` (fan groups),
  \`coolerfans\`, \`pump\`, \`ram\`, \`gpu\` and \`strip\`. A card with \`"error"\` is shown as unavailable.
- \`state.color\` is red, green and blue, 0 to 255, and \`brightness\` is 0 to 100.
- \`presets\`, \`layout\` and \`telemetry\` are optional, and so is every field in \`telemetry\` (temperatures in °C,
  memory in GB). \`hub_rpm\` is one speed per fan group.
- Add \`"lcd": true\` if **\`GET /api/lcd/preview\`** serves a picture of a screen on the cooler.

To let Valet change the lights, answer two POSTs. Each comes with the header \`X-RGB: 1\`:

- **\`POST /api/zones\`** with \`{ "zones": ["fan-1", "fan-2"], "state": { "mode": "Static", "color": [0, 132, 255], "brightness": 80 } }\`
- **\`POST /api/preset\`** with \`{ "id": "warm" }\`

Leave them out, or set \`controls: false\`, and the card only looks.`,
};
