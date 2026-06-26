#!/bin/sh
set -e

SOCKET=/tmp/tailscaled.sock
TAILSCALE_STATE_DIR="${TAILSCALE_STATE_DIR:-/var/lib/tailscale}"
TAILSCALE_HOSTNAME="${TAILSCALE_HOSTNAME:-pocket-gateway-railway}"
TAILSCALE_SOCKS5_ADDR="${TAILSCALE_SOCKS5_ADDR:-localhost:1055}"

if [ "${TAILSCALE_ENABLED:-false}" = "true" ]; then
  mkdir -p "$TAILSCALE_STATE_DIR"
  tailscaled \
    --tun=userspace-networking \
    --state="${TAILSCALE_STATE_DIR}/tailscaled.state" \
    --socket="$SOCKET" \
    --socks5-server="$TAILSCALE_SOCKS5_ADDR" &

  i=0
  while [ ! -S "$SOCKET" ] && [ "$i" -lt 30 ]; do
    i=$((i + 1))
    sleep 1
  done

  if [ -S "$SOCKET" ] && [ -n "${TAILSCALE_AUTHKEY:-}" ]; then
    tailscale --socket="$SOCKET" up \
      --authkey="${TAILSCALE_AUTHKEY}" \
      --hostname="${TAILSCALE_HOSTNAME}" \
      ${TAILSCALE_EXTRA_ARGS:-} || echo "Tailscale up failed; starting app with Hermes offline"
    tailscale --socket="$SOCKET" status || true
  else
    echo "Tailscale socket/authkey unavailable; starting app with Hermes offline"
  fi
fi

node dist/server.js
