# Uptinger VPS Agent

Lightweight Docker agent that reports CPU, RAM, disk, network, (optional) Nginx stats,
and (optional) a live Docker container inventory — per-container CPU/memory and
on-disk (writable layer + image) size — from a Linux VPS back to a self-hosted Uptinger
instance. No dependency beyond Docker itself needs to be installed on the monitored
server.

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

## Nginx behind Docker (its own container/network)

By default the agent looks for Nginx's `stub_status` at `http://127.0.0.1/nginx_status`,
which only works if Nginx runs directly on the host (the agent's `--net=host` puts it on
the same loopback). If Nginx runs in its own container — e.g. on a `nginx-network` Docker
network — it isn't reachable on the host's loopback at all, so this needs to be pointed
at wherever `stub_status` actually is:

- If Nginx publishes a port to the host (`-p 8080:80`), set
  `UPTINGER_NGINX_STATUS_URL=http://127.0.0.1:8080/nginx_status`.
- If not, attach the agent container to the same Docker network as Nginx
  (`docker network connect nginx-network uptinger-agent`, or add `--network nginx-network`
  to the install command's `docker run`) and point at the container by name:
  `UPTINGER_NGINX_STATUS_URL=http://nginx:80/nginx_status`.

Either way, `stub_status` needs to actually be enabled in the Nginx config first
(`location /nginx_status { stub_status; }`, restricted to internal access).

Traefik isn't supported yet — the agent only speaks Nginx's `stub_status` format, not
Traefik's Prometheus metrics endpoint.

## Docker container detection

When the install command's `-v /var/run/docker.sock:/var/run/docker.sock:ro` mount is
present, each push also includes a `containers` array: one entry per container
(`id`, `name`, `image`, `state`), and for running ones, live `cpu_pct`/`mem_used_mb`/
`mem_limit_mb` from that container's own `stats` endpoint, plus `volume_mb` — its
writable layer + image size (the same number `docker ps -s` reports), always available
regardless of state. This powers the "Docker Containers" section on the VPS monitor's
dashboard.

- Read-only: the agent only ever calls `GET` endpoints on the socket
  (`/containers/json`, `/containers/<id>/stats`) — it cannot start, stop, or otherwise
  control any container.
- Capped at `UPTINGER_MAX_CONTAINERS` (default 30) containers per push, since each
  running container's `stats` call blocks briefly; a host with more than that many
  still reports the rest of its VPS metrics normally, just without the overflow
  containers.
- Silently omitted (empty `containers: []`) if the socket isn't mounted, isn't a
  socket, or `jq` is unavailable — same best-effort approach as the Nginx integration.
- Set `UPTINGER_DOCKER_SOCK` if the socket is bind-mounted somewhere other than
  `/var/run/docker.sock` inside the agent container.

## Trust model / what the container can see

- `-v /:/host:ro,rslave` — **read-only** bind mount of the host root, needed to read
  real disk/mount stats and (optionally) Nginx's log file. The agent never writes to
  this mount.
- `--pid=host` — needed for accurate host-wide CPU/load figures.
- `--net=host` — used only to reach Nginx's `stub_status` on `127.0.0.1` if present;
  the agent makes no other outbound connections besides the configured `UPTINGER_URL`.
- `-v /var/run/docker.sock:/var/run/docker.sock:ro` — **read-only** mount of the
  Docker socket, used only for the two `GET` calls described above. This does give the
  agent visibility into every other container's name/image/resource usage on the host
  (a real trust-model change from earlier versions, which mounted no socket at all) —
  if that's unacceptable for your host, omit this mount from the generated command;
  the agent keeps working, just without the Docker container section.

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
