#!/usr/bin/env bash
# Run as the unprivileged account that owns the rootless Docker daemon.
set -euo pipefail

if [[ "$(id -u)" -eq 0 ]]; then
  echo "ERROR: Do not execute the runtime as root." >&2
  exit 1
fi
if ! command -v docker >/dev/null; then
  echo "ERROR: Install the rootless Docker CLI first." >&2
  exit 1
fi
if ! command -v node >/dev/null; then
  echo "ERROR: Node.js 22+ is required." >&2
  exit 1
fi
version="$(node -p 'Number(process.versions.node.split(".")[0])')"
if (( version < 22 )); then
  echo "ERROR: Node.js 22+ is required; found $(node --version)." >&2
  exit 1
fi
security="$(docker info --format '{{json .SecurityOptions}}')"
driver="$(docker info --format '{{.CgroupDriver}}')"
if [[ "$security" != *rootless* || "$driver" != systemd ]]; then
  echo "ERROR: Docker must be rootless with the systemd cgroup driver." >&2
  echo "Found security: $security; cgroup driver: $driver" >&2
  exit 1
fi
if [[ ! -f "$HOME/.config/adminerva-runtime/runtime.env" ]]; then
  echo "ERROR: Create ~/.config/adminerva-runtime/runtime.env." >&2
  exit 1
fi
if [[ ! -f package.json ]]; then
  echo "ERROR: Run from ~/Adminerva/runtime/java." >&2
  exit 1
fi
echo "Runtime prerequisites located: Node $(node --version), rootless Docker, systemd cgroup driver."
echo "Verify CPU/memory/pids cgroup controllers are delegated before student access."
echo "Build the runner image, install dependencies, and enable the user service."
