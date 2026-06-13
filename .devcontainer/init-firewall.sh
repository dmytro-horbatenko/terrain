#!/bin/bash
# Default-deny egress firewall for the Terrain devcontainer. Resolves an allowlist
# of domains to IPs (while egress is still open), adds GitHub's published ranges,
# allows the local Compose subnet (so the app can reach the `db` Postgres service),
# then drops everything else outbound. Re-run on every container start.
#
# Edit ALLOWED_DOMAINS to add/remove reachable hosts. Run as root (sudo).
set -euo pipefail

ALLOWED_DOMAINS=(
  # --- Claude Code: inference + auth (nonessential telemetry disabled via env) ---
  "api.anthropic.com"
  "claude.ai"
  "console.anthropic.com"
  # --- package installs ---
  "registry.npmjs.org"
  "registry.yarnpkg.com"
  "repo.yarnpkg.com"
  # --- dev docs (so WebFetch/WebSearch result pages resolve in-container) ---
  "www.prisma.io"
  "pris.ly"
  "docs.nestjs.com"
  "tanstack.com"
  "vite.dev"
  "react.dev"
  "oxc.rs"
  "developer.mozilla.org"
  "www.npmjs.com"
  "code.claude.com"
  "docs.anthropic.com"
)

echo "[firewall] resetting rules..."
iptables -F
# Reset default policies to ACCEPT first, so re-running this script while a previous
# lockdown is active does not block its own DNS/HTTPS lookups (rules are flushed
# but the DROP policy would otherwise persist). The script re-applies DROP at the end.
iptables -P INPUT ACCEPT
iptables -P OUTPUT ACCEPT
iptables -P FORWARD ACCEPT
iptables -X 2>/dev/null || true
# NOTE: do NOT flush the nat table — Docker's embedded DNS (127.0.0.11) installs its
# DNAT rules there; flushing them breaks name resolution inside the container.
iptables -t mangle -F 2>/dev/null || true
ipset destroy allowed 2>/dev/null || true
ipset create allowed hash:net

# Loopback + DNS + established (needed before we lock down).
iptables -A INPUT  -i lo -j ACCEPT
iptables -A OUTPUT -o lo -j ACCEPT
iptables -A OUTPUT -p udp --dport 53 -j ACCEPT
iptables -A INPUT  -p udp --sport 53 -j ACCEPT
iptables -A OUTPUT -p tcp --dport 53 -j ACCEPT
iptables -A INPUT  -m state --state ESTABLISHED,RELATED -j ACCEPT
iptables -A OUTPUT -m state --state ESTABLISHED,RELATED -j ACCEPT

# GitHub's published IP ranges (web/api/git) — used by yarn, gh, the feature, etc.
echo "[firewall] adding GitHub ranges..."
gh_ranges=$(curl -fsS https://api.github.com/meta || echo '{}')
for cidr in $(echo "$gh_ranges" | jq -r '(.web // [])[], (.api // [])[], (.git // [])[]' 2>/dev/null); do
  [[ "$cidr" =~ : ]] && continue   # skip IPv6
  ipset add allowed "$cidr" 2>/dev/null || true
done

# Resolve the allowlist to IPv4 and add to the set.
for domain in "${ALLOWED_DOMAINS[@]}"; do
  for ip in $(dig +short A "$domain" | grep -E '^[0-9.]+$'); do
    ipset add allowed "$ip" 2>/dev/null || true
  done
done

# Allow the local Compose/bridge subnet so the app can reach `db` (Postgres).
default_gw=$(ip route | awk '/default/ {print $3; exit}')
if [[ -n "${default_gw:-}" ]]; then
  subnet=$(echo "$default_gw" | sed 's/\.[0-9]*$/.0\/24/')
  iptables -A OUTPUT -d "$subnet" -j ACCEPT
  iptables -A INPUT  -s "$subnet" -j ACCEPT
  echo "[firewall] allowed local subnet $subnet"
fi

# Allow egress to the resolved allowlist, then drop everything else.
iptables -A OUTPUT -m set --match-set allowed dst -j ACCEPT
iptables -P INPUT DROP
iptables -P FORWARD DROP
iptables -P OUTPUT DROP

echo "[firewall] verifying..."
if curl -fsS --max-time 5 https://api.anthropic.com/ >/dev/null 2>&1 \
   || curl -s --max-time 5 -o /dev/null -w '%{http_code}' https://api.anthropic.com/ | grep -qE '^[0-9]'; then
  echo "[firewall] OK: api.anthropic.com reachable"
else
  echo "[firewall] WARNING: api.anthropic.com not reachable — check the allowlist" >&2
fi
if curl -s --max-time 5 https://example.com >/dev/null 2>&1; then
  echo "[firewall] WARNING: example.com reachable — egress NOT locked down" >&2
else
  echo "[firewall] OK: non-allowlisted egress is blocked"
fi
