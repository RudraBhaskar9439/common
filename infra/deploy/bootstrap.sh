#!/usr/bin/env bash
# Ubuntu 24.04 single-worker host. Run as root; no application secrets here.
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y curl ca-certificates xz-utils zstd git caddy
work=$(mktemp -d)
cd "$work"
curl -fsSLO https://nodejs.org/dist/latest-v24.x/SHASUMS256.txt
node_archive=$(awk '/ node-v24.*-linux-x64.tar.xz$/ {print $2}' SHASUMS256.txt)
test -n "$node_archive"
curl -fsSLO "https://nodejs.org/dist/latest-v24.x/$node_archive"
awk -v name="$node_archive" '$2 == name' SHASUMS256.txt | sha256sum -c -
tar -xJf "$node_archive" -C /usr/local --strip-components=1
curl -fsSL https://ollama.com/install.sh -o ollama-install.sh
sh ollama-install.sh
id common >/dev/null 2>&1 || useradd --system --create-home --home-dir /var/lib/common --shell /usr/sbin/nologin common
id common-provider >/dev/null 2>&1 || useradd --system --create-home --home-dir /var/lib/common-provider --shell /usr/sbin/nologin common-provider
chmod 755 /var/lib/common
install -d -m 755 /opt/common
install -d -o common -g common -m 700 /var/lib/common/app /var/lib/common/practice
install -d -o common-provider -g common-provider -m 700 /var/lib/common/service
install -d -m 700 /etc/common
systemctl enable --now ollama
ollama pull qwen3:1.7b
ollama pull qwen3:4b
node --version
ollama --version
