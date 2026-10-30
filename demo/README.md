# The Valet demo

Real Valet, made-up homelab. The page runs the published code; the only stand-ins are one plugin
(`integrations/homelab.mjs`, the invented house) and a scripted model (`mock-model.mjs`, the assistant).

- **Nothing real:** no secrets, no real services. Every name and title is invented and every picture is drawn in code.
- **Sealed:** Valet and the model sit on an internal Docker network with no route to the internet, the LAN or the host.
  The small proxy is the only way in.
- **No AI bill:** the chat calls the scripted model, so it costs nothing and can't be talked into anything. It never
  repeats what's typed into it.
- **Self-healing:** whatever a visitor changes lapses after ten minutes, and restarting wipes everything else.

```sh
docker compose build                       # in the repo root: builds local/valet:dev
cd demo && docker compose up -d            # http://172.17.0.1:7580
```

It is **not public**: the port is on the Docker bridge address only, for a reverse proxy on the same machine. To open it
later, add the public name to `allowedHosts` in `config.yaml` and point a proxy or tunnel at that port.
