#!/bin/sh
# Uptinger VPS agent — collects host CPU/RAM/disk/network/Nginx stats and pushes them
# to a self-hosted Uptinger instance. Runs inside a container with the host's root
# filesystem bind-mounted read-only at /host (see ../linux/Dockerfile and the
# `docker run` command shown in the Uptinger UI when adding a VPS Performance monitor).
#
# Deliberately POSIX sh + coreutils/busybox only — no runtime language dependency,
# so the container image stays a few MB and there's nothing else to install or update
# on the host beyond Docker itself.
set -u

: "${UPTINGER_URL:?UPTINGER_URL is required (e.g. https://your-uptinger-host/api/agent/123/ingest)}"
: "${UPTINGER_TOKEN:?UPTINGER_TOKEN is required}"
INTERVAL="${UPTINGER_INTERVAL:-30}"
HOST_ROOT="${UPTINGER_HOST_ROOT:-/host}"
# Override when Nginx isn't on the host's own loopback — e.g. it runs in its own
# Docker container/network. Point this at wherever stub_status is actually reachable
# from this container (a published host port, or a container:port on a shared
# --network this agent was also attached to).
NGINX_STATUS_URL="${UPTINGER_NGINX_STATUS_URL:-http://127.0.0.1/nginx_status}"
# Override when Nginx's logs aren't at the host's own /var/log/nginx — e.g. Nginx runs
# in its own container with `./logs:/var/log/nginx` bind-mounted from some other
# directory on the host. Point this at that real host directory (it's read through
# $HOST_ROOT same as everything else here, so pass the host-side path, not a
# container-side one).
NGINX_LOG_DIR="${UPTINGER_NGINX_LOG_DIR:-/var/log/nginx}"
# Where the host's Docker socket is bind-mounted into this container (read-only), if at
# all — see the -v /var/run/docker.sock:/var/run/docker.sock:ro line in the generated
# install command. Container listing/stats are silently omitted from the payload when
# this path isn't a socket, same "best-effort" approach as the Nginx stats above.
DOCKER_SOCK="${UPTINGER_DOCKER_SOCK:-/var/run/docker.sock}"
# Bounds how many containers get a per-container `stats` call each push interval (each
# call blocks ~1s), so a host with hundreds of containers can't stall the whole loop.
MAX_CONTAINERS="${UPTINGER_MAX_CONTAINERS:-30}"
AGENT_VERSION="1.1.0"

# Never crash the loop on a transient host-file read/parse failure — a monitoring
# agent going down is worse than one skipped/partial data point.
trap 'exit 0' TERM INT

json_escape() {
    # Escapes backslashes, double quotes, and strips control chars (esp. newlines) so
    # arbitrary log lines / interface names can never break out of a JSON string.
    printf '%s' "$1" | tr -d '\000-\010\013\014\016-\037' | sed 's/\\/\\\\/g; s/"/\\"/g'
}

read_cpu_pct() {
    # Delta of two /proc/stat samples 1s apart — instantaneous CPU % needs two points,
    # there's no single-read equivalent of "top"'s live percentage.
    line1=$(awk '/^cpu /{print}' "$HOST_ROOT/proc/stat")
    sleep 1
    line2=$(awk '/^cpu /{print}' "$HOST_ROOT/proc/stat")

    echo "$line1 $line2" | awk '{
        idle1=$5; total1=0; for(i=2;i<=11;i++) total1+=$i;
        idle2=$16; total2=0; for(i=13;i<=22;i++) total2+=$i;
        dt=total2-total1; di=idle2-idle1;
        if (dt <= 0) { print "0"; exit }
        printf "%.1f", (dt-di)/dt*100
    }'
}

read_load() {
    awk '{print $1, $2, $3}' "$HOST_ROOT/proc/loadavg" 2>/dev/null || echo "0 0 0"
}

read_ram() {
    awk '
        /^MemTotal:/     {total=$2}
        /^MemAvailable:/ {avail=$2}
        /^SwapTotal:/    {swap_total=$2}
        /^SwapFree:/     {swap_free=$2}
        END {
            used = total - avail;
            if (used < 0) used = 0;
            swap_used = swap_total - swap_free;
            if (swap_used < 0) swap_used = 0;
            printf "%d %d %d %d", used/1024, total/1024, swap_used/1024, swap_total/1024
        }
    ' "$HOST_ROOT/proc/meminfo"
}

read_uptime() {
    awk '{printf "%d", $1}' "$HOST_ROOT/proc/uptime" 2>/dev/null || echo 0
}

read_net() {
    # Sums every real interface (skips loopback + the header lines), which is a
    # reasonable default for a single-NIC VPS; per-interface breakdown isn't worth the
    # payload size for what this dashboard is for.
    awk -F'[: ]+' '
        NR>2 && $2 !~ /^lo$/ {rx+=$3; tx+=$11}
        END {printf "%d %d", rx+0, tx+0}
    ' "$HOST_ROOT/proc/net/dev" 2>/dev/null || echo "0 0"
}

# Emits one JSON object per real (non-virtual) host mount. Relies on the container
# being started with -v /:/host:ro,rslave so host submounts propagate under /host —
# without rslave only the top-level root mount would be visible here.
#
# The `overlay` fs type is excluded because it's what Docker uses for *container*
# rootfs/layer mounts, which would otherwise flood this list with junk. But some VPS
# providers (and container-based hosts) also use overlay/overlay2 for the real host
# root — excluding it unconditionally then leaves nothing at all. So: filter it out
# of the general scan, then fall back to reporting "/" by itself (whatever its fs
# type actually is) if that filtering left us with zero mounts.
read_disks_json() {
    entries=$(awk '
        $3 !~ /^(tmpfs|devtmpfs|overlay|squashfs|proc|sysfs|cgroup|cgroup2|devpts|mqueue|debugfs|tracefs|securityfs|pstore|autofs|nsfs|bpf)$/ {print $2}
    ' "$HOST_ROOT/proc/mounts" 2>/dev/null | sort -u | while IFS= read -r mnt; do
        path="$HOST_ROOT$mnt"
        [ -d "$path" ] || continue
        df -P "$path" 2>/dev/null | awk -v m="$mnt" 'NR==2{printf "%s\t%d\t%d\n", m, $2/1024, $3/1024}'
    done)

    if [ -z "$entries" ]; then
        entries=$(df -P "$HOST_ROOT" 2>/dev/null | awk 'NR==2{printf "/\t%d\t%d\n", $2/1024, $3/1024}')
    fi

    first=1
    printf '['
    printf '%s\n' "$entries" | while IFS="$(printf '\t')" read -r mnt total used; do
        [ -n "$mnt" ] || continue
        if [ "$first" -eq 1 ]; then first=0; else printf ','; fi
        printf '{"mount":"%s","used_mb":%d,"total_mb":%d}' "$(json_escape "$mnt")" "${used:-0}" "${total:-0}"
    done
    printf ']'
}

# Best-effort Nginx stats via the stub_status module on localhost (--net=host puts us
# on the host's own loopback). Silently omitted from the payload if Nginx isn't
# installed or stub_status isn't enabled — this agent should work on any VPS, not just
# ones running Nginx.
read_nginx_json() {
    body=$(curl -fsS --max-time 3 "$NGINX_STATUS_URL" 2>/dev/null) || return 1
    active=$(echo "$body" | awk '/Active connections/{print $3}')
    requests=$(echo "$body" | awk 'NR==3{print $3}')
    [ -n "$active" ] || return 1

    errors_json='[]'
    error_log_size=0
    if [ -f "$HOST_ROOT$NGINX_LOG_DIR/error.log" ]; then
        error_log_size=$(wc -c < "$HOST_ROOT$NGINX_LOG_DIR/error.log" 2>/dev/null | tr -d ' ')
        errors_json=$(tail -n 200 "$HOST_ROOT$NGINX_LOG_DIR/error.log" 2>/dev/null | grep '\[error\]' | tail -n 20 | \
            while IFS= read -r l; do printf '%s\n' "$(json_escape "$l")"; done | \
            awk 'BEGIN{printf "["} {if(NR>1) printf ","; printf "\"%s\"", $0} END{printf "]"}')
        [ -n "$errors_json" ] || errors_json='[]'
    fi

    # Only ever the last 20 lines of the current file — never the whole 500MB+ file,
    # and nothing is uploaded/copied wholesale to the server, just this bounded tail
    # each push interval (same shape as the error-log sampling above).
    access_json='[]'
    access_log_size=0
    if [ -f "$HOST_ROOT$NGINX_LOG_DIR/access.log" ]; then
        access_log_size=$(wc -c < "$HOST_ROOT$NGINX_LOG_DIR/access.log" 2>/dev/null | tr -d ' ')
        access_json=$(tail -n 20 "$HOST_ROOT$NGINX_LOG_DIR/access.log" 2>/dev/null | \
            while IFS= read -r l; do printf '%s\n' "$(json_escape "$l")"; done | \
            awk 'BEGIN{printf "["} {if(NR>1) printf ","; printf "\"%s\"", $0} END{printf "]"}')
        [ -n "$access_json" ] || access_json='[]'
    fi

    printf '{"nginx_active_connections":%d,"nginx_requests_total":%d,"nginx_recent_errors":%s,"nginx_recent_access":%s,"nginx_error_log_size_bytes":%d,"nginx_access_log_size_bytes":%d}' \
        "${active:-0}" "${requests:-0}" "$errors_json" "$access_json" "${error_log_size:-0}" "${access_log_size:-0}"
}

# Lists containers (via the Docker API over the bind-mounted socket) with, for each
# running one, live CPU%/memory from its `stats` endpoint plus its on-disk footprint
# (writable layer + image size, from `size=1` on the list call — the same numbers
# `docker ps -s` shows). Requires `jq` (in the agent image) since these responses nest
# deeply enough that awk/sed parsing would be unreadable and fragile.
read_docker_json() {
    [ -S "$DOCKER_SOCK" ] || return 1
    command -v jq >/dev/null 2>&1 || return 1

    containers=$(curl -fsS --max-time 5 --unix-socket "$DOCKER_SOCK" "http://localhost/containers/json?all=1&size=1" 2>/dev/null)
    [ -n "$containers" ] || return 1
    echo "$containers" | jq -e 'type == "array"' >/dev/null 2>&1 || return 1

    printf '['
    echo "$containers" | jq -c ".[0:${MAX_CONTAINERS}][]" 2>/dev/null | while IFS= read -r c; do
        id=$(echo "$c" | jq -r '.Id[0:12]')
        name=$(echo "$c" | jq -r '(.Names[0] // "") | sub("^/"; "")')
        image=$(echo "$c" | jq -r '.Image // ""')
        state=$(echo "$c" | jq -r '.State // "unknown"')
        size_rw=$(echo "$c" | jq -r '.SizeRw // 0')
        size_root=$(echo "$c" | jq -r '.SizeRootFs // 0')
        volume_mb=$(( (size_rw + size_root) / 1024 / 1024 ))

        cpu_pct=0
        mem_used_mb=0
        mem_limit_mb=0
        if [ "$state" = "running" ]; then
            stats=$(curl -fsS --max-time 5 --unix-socket "$DOCKER_SOCK" "http://localhost/containers/${id}/stats?stream=false" 2>/dev/null)
            if [ -n "$stats" ]; then
                cpu_pct=$(echo "$stats" | jq -r '
                    ((.cpu_stats.cpu_usage.total_usage // 0) - (.precpu_stats.cpu_usage.total_usage // 0)) as $cd |
                    ((.cpu_stats.system_cpu_usage // 0) - (.precpu_stats.system_cpu_usage // 0)) as $sd |
                    (.cpu_stats.online_cpus // (.cpu_stats.cpu_usage.percpu_usage | length) // 1) as $ncpu |
                    if $sd > 0 and $cd >= 0 then ($cd / $sd * $ncpu * 100) else 0 end
                ' 2>/dev/null)
                mem_used_mb=$(echo "$stats" | jq -r '((.memory_stats.usage // 0) - (.memory_stats.stats.cache // 0)) / 1024 / 1024' 2>/dev/null)
                mem_limit_mb=$(echo "$stats" | jq -r '(.memory_stats.limit // 0) / 1024 / 1024' 2>/dev/null)
            fi
        fi
        cpu_pct=$(printf '%.1f' "${cpu_pct:-0}" 2>/dev/null || echo 0)
        mem_used_mb=$(printf '%.0f' "${mem_used_mb:-0}" 2>/dev/null || echo 0)
        mem_limit_mb=$(printf '%.0f' "${mem_limit_mb:-0}" 2>/dev/null || echo 0)

        printf '{"id":"%s","name":"%s","image":"%s","state":"%s","cpu_pct":%s,"mem_used_mb":%s,"mem_limit_mb":%s,"volume_mb":%s}\n' \
            "$(json_escape "$id")" "$(json_escape "$name")" "$(json_escape "$image")" "$(json_escape "$state")" \
            "${cpu_pct:-0}" "${mem_used_mb:-0}" "${mem_limit_mb:-0}" "${volume_mb:-0}"
    done | awk 'BEGIN{first=1} {if(!first) printf ","; printf "%s", $0; first=0}'
    printf ']'
}

build_and_send() {
    cpu=$(read_cpu_pct)
    load=$(read_load)
    load1=$(echo "$load" | cut -d' ' -f1)
    load5=$(echo "$load" | cut -d' ' -f2)
    load15=$(echo "$load" | cut -d' ' -f3)

    ram=$(read_ram)
    ram_used=$(echo "$ram" | cut -d' ' -f1)
    ram_total=$(echo "$ram" | cut -d' ' -f2)
    swap_used=$(echo "$ram" | cut -d' ' -f3)
    swap_total=$(echo "$ram" | cut -d' ' -f4)

    net=$(read_net)
    net_rx=$(echo "$net" | cut -d' ' -f1)
    net_tx=$(echo "$net" | cut -d' ' -f2)

    uptime=$(read_uptime)
    disks_json=$(read_disks_json)
    nginx_json=$(read_nginx_json)
    containers_json=$(read_docker_json)
    [ -n "$containers_json" ] || containers_json='[]'

    payload=$(printf '{"cpu_pct":%s,"load1":%s,"load5":%s,"load15":%s,"ram_used_mb":%s,"ram_total_mb":%s,"swap_used_mb":%s,"swap_total_mb":%s,"disks":%s,"net_rx_bytes":%s,"net_tx_bytes":%s,"uptime_seconds":%s,"containers":%s,"agent_version":"%s"' \
        "${cpu:-0}" "${load1:-0}" "${load5:-0}" "${load15:-0}" "${ram_used:-0}" "${ram_total:-0}" "${swap_used:-0}" "${swap_total:-0}" \
        "${disks_json:-[]}" "${net_rx:-0}" "${net_tx:-0}" "${uptime:-0}" "${containers_json:-[]}" "$AGENT_VERSION")

    if [ -n "$nginx_json" ]; then
        # Splice the nginx fields into the same object instead of nesting, so the
        # server-side payload shape stays flat (matches tbl_vps_metrics columns 1:1).
        inner=$(printf '%s' "$nginx_json" | sed 's/^{//; s/}$//')
        payload="${payload},${inner}}"
    else
        payload="${payload}}"
    fi

    curl -fsS --max-time 10 \
        -H "Authorization: Bearer ${UPTINGER_TOKEN}" \
        -H "Content-Type: application/json" \
        -X POST --data-binary "$payload" \
        "$UPTINGER_URL" >/dev/null 2>&1
    if [ $? -ne 0 ]; then
        echo "$(date -u +%FT%TZ) uptinger-agent: push failed, will retry next interval" >&2
    fi
}

echo "$(date -u +%FT%TZ) uptinger-agent: starting, pushing to ${UPTINGER_URL} every ${INTERVAL}s"
while true; do
    build_and_send
    # read_cpu_pct already burns ~1s sampling; subtract it so the loop period matches
    # INTERVAL rather than drifting to INTERVAL+1 every cycle.
    sleep_for=$((INTERVAL > 1 ? INTERVAL - 1 : 1))
    sleep "$sleep_for"
done
