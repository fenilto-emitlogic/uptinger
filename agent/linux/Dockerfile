# Uptinger VPS agent — minimal Alpine image running collect.sh on a loop.
# Not published to any registry: the install command the app generates (see
# GET /api/monitors/:id/agent-install) downloads this file plus collect.sh from the
# user's own Uptinger instance and runs `docker build` directly on the target VPS.
FROM alpine:3.20

RUN apk add --no-cache curl bash coreutils \
    && addgroup -S uptinger && adduser -S -G uptinger uptinger

COPY collect.sh /usr/local/bin/collect.sh
RUN chmod +x /usr/local/bin/collect.sh

# Runs as root by design: reading host CPU/RAM stats through the bind-mounted /host
# doesn't need root, but some hosts restrict /host/var/log/nginx/error.log to root,
# and --pid=host + host /proc access is commonly restricted under a non-root user
# depending on the host's kernel.yama/procfs hidepid settings. The container still
# only ever reads (mount is :ro) and only ever POSTs to one fixed URL.
USER root

ENTRYPOINT ["/usr/local/bin/collect.sh"]
