#!/usr/bin/env bash
# Writes a JSON description of the machine a benchmark ran on, so published numbers carry
# the hardware they were measured on. Usage: ci/runner-info.sh <target> <outfile>
set -euo pipefail
target="$1"
out="$2"

cpu_model="$(lscpu | awk -F: '/^Model name/ {gsub(/^[ \t]+/, "", $2); print $2; exit}')"
cores="$(nproc)"
mem_bytes="$(awk '/^MemTotal/ {print $2 * 1024}' /proc/meminfo)"
disk_free="$(df -B1 --output=avail . | tail -1 | tr -d ' ')"
images="$(docker image ls --digests --format '{{.Repository}}:{{.Tag}}@{{.Digest}}' | sort -u | jq -R . | jq -s .)"

jq -n \
  --arg target "$target" \
  --arg cpuModel "$cpu_model" \
  --argjson cores "$cores" \
  --argjson memoryBytes "$mem_bytes" \
  --argjson diskFreeBytes "$disk_free" \
  --arg kernel "$(uname -r)" \
  --arg arch "$(uname -m)" \
  --arg os "${ImageOS:-unknown}" \
  --arg imageVersion "${ImageVersion:-unknown}" \
  --arg runnerName "${RUNNER_NAME:-unknown}" \
  --arg dockerVersion "$(docker version --format '{{.Server.Version}}' 2>/dev/null || echo unknown)" \
  --arg ohaVersion "$(oha --version 2>/dev/null | head -1 || echo unknown)" \
  --argjson images "$images" \
  '{target: $target, cpuModel: $cpuModel, cores: $cores, memoryBytes: $memoryBytes,
    diskFreeBytes: $diskFreeBytes, kernel: $kernel, arch: $arch, os: $os, imageVersion: $imageVersion,
    runnerName: $runnerName, dockerVersion: $dockerVersion, ohaVersion: $ohaVersion, images: $images}' >"$out"
