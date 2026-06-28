#!/bin/sh
set -e

SOCKET=/tmp/tailscaled.sock
TAILSCALE_STATE_DIR="${TAILSCALE_STATE_DIR:-/var/lib/tailscale}"
TAILSCALE_STATE_FILE="${TAILSCALE_STATE_FILE:-${TAILSCALE_STATE_DIR}/tailscaled.state}"
TAILSCALE_HOSTNAME="${TAILSCALE_HOSTNAME:-pocket-gateway-railway}"
TAILSCALE_SOCKS5_ADDR="${TAILSCALE_SOCKS5_ADDR:-localhost:1055}"

if [ "${TAILSCALE_ENABLED:-false}" = "true" ]; then
  mkdir -p "$TAILSCALE_STATE_DIR"
  tailscaled \
    --tun=userspace-networking \
    --state="$TAILSCALE_STATE_FILE" \
    --socket="$SOCKET" \
    --socks5-server="$TAILSCALE_SOCKS5_ADDR" &

  i=0
  while [ ! -S "$SOCKET" ] && [ "$i" -lt 30 ]; do
    i=$((i + 1))
    sleep 1
  done

  if [ -S "$SOCKET" ]; then
    if [ -s "$TAILSCALE_STATE_FILE" ]; then
      echo "Using existing Tailscale state from $TAILSCALE_STATE_FILE"
      tailscale --socket="$SOCKET" up \
        --hostname="${TAILSCALE_HOSTNAME}" \
        ${TAILSCALE_EXTRA_ARGS:-} || {
          echo "Existing Tailscale state failed; retrying with auth key if available"
          if [ -n "${TAILSCALE_AUTHKEY:-}" ]; then
            tailscale --socket="$SOCKET" up \
              --authkey="${TAILSCALE_AUTHKEY}" \
              --hostname="${TAILSCALE_HOSTNAME}" \
              ${TAILSCALE_EXTRA_ARGS:-} || echo "Tailscale up failed; starting app with Hermes offline"
          else
            echo "TAILSCALE_AUTHKEY unavailable; starting app with Hermes offline"
          fi
        }
    elif [ -n "${TAILSCALE_AUTHKEY:-}" ]; then
      echo "No Tailscale state found at $TAILSCALE_STATE_FILE; registering this node"
      tailscale --socket="$SOCKET" up \
        --authkey="${TAILSCALE_AUTHKEY}" \
        --hostname="${TAILSCALE_HOSTNAME}" \
        ${TAILSCALE_EXTRA_ARGS:-} || echo "Tailscale up failed; starting app with Hermes offline"
    else
      echo "No Tailscale state/authkey available; starting app with Hermes offline"
    fi
    tailscale --socket="$SOCKET" status || true
  else
    echo "Tailscale socket unavailable; starting app with Hermes offline"
  fi
fi

node dist/server.js
