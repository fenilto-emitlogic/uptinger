# Uptinger VPS Agent

Lightweight Docker agent that reports CPU, RAM, disk, network and (optional) Nginx
stats from a Linux VPS back to a self-hosted Uptinger instance. No dependency beyond
Docker itself needs to be installed on the monitored server.

## How it works

1. In the Uptinger UI, add a monitor of type **VPS Performance**. This generates a
   unique, revocable bearer token tied to that monitor (`config.agent_token` — see
   [`src/models/monitor.model.ts`](../src/models/monitor.model.ts)).
2. The UI shows an install command (built server-side in
   [`GET /api/monitors/:id/agent-install`](../src/routes/api/monitor.routes.ts)) that:
   - downloads this instance's own copy of [`linux/collect.sh`](linux/collect.sh) and
     [`linux/Dockerfile`](linux/Dockerfile) from `GET /api/agent/source/:file`
     ([`src/routes/api/agent.routes.ts`](../src/routes/api/agent.routes.ts)),
   - runs `docker build` **on the VPS itself**, and
   - starts the resulting image with the monitor's token.

   There is no prebuilt image on a registry to pull or trust — the two files land on
   disk before `docker build` ever runs them, so they can be read first if you want to.
3. The running container runs `collect.sh` on a loop (default every 30s), reading the
   host's `/proc`, `/sys` and mount table via a read-only bind mount, and POSTs a JSON
   snapshot to `POST /api/agent/:id/ingest` with `Authorization: Bearer <token>`.
4. If the agent goes quiet for 3x its push interval, the server marks the monitor
   OFFLINE itself (`checkVpsStaleness()` in [`src/config/uptinger.ts`](../src/config/uptinger.ts))
   — the agent can't report "I'm down," so the server has to notice the silence.

## Trust model / what the container can see

- `-v /:/host:ro,rslave` — **read-only** bind mount of the host root, needed to read
  real disk/mount stats and (optionally) Nginx's log file. The agent never writes to
  this mount.
- `--pid=host` — needed for accurate host-wide CPU/load figures.
- `--net=host` — used only to reach Nginx's `stub_status` on `127.0.0.1` if present;
  the agent makes no other outbound connections besides the configured `UPTINGER_URL`.
- No Docker socket is mounted; this agent cannot see or control other containers.

## Building locally (for development)

This is what the generated install command does automatically on the target VPS; useful
to run by hand when developing the agent itself:

```bash
docker build -t uptinger-agent agent/linux
```

## Regenerating a compromised token

If a token leaks, regenerate it from the monitor's settings
(`POST /api/monitors/:id/agent-token/regenerate`) — the old token stops authenticating
immediately. On the VPS, stop the old container and re-run the (re-fetched) install
command with the new token: `docker rm -f uptinger-agent`, then paste the fresh command
from the UI.
