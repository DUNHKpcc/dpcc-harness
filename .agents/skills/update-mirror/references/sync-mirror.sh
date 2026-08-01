#!/usr/bin/env bash
#
# sync-mirror.sh — Publish a release to the dpccgaming.xyz domestic update mirror.
#
# Usage:   ./sync-mirror.sh <version>      e.g.  ./sync-mirror.sh 2.0.1
#
# MUST be run from the LOCAL Mac, never on the server. The server's direct
# connection to GitHub is throttled to ~12 KB/s (≈9 h per file); GitHub proxies
# are throttled too for sustained transfers. The Mac pulls from GitHub fast
# (~4 MB/s) and uploads to the server over the domestic link. See SKILL.md.
#
# Keeps only the mainstream builds for the LATEST version:
#   - Windows x64 : latest.yml      + PccAgent-<v>-windows-x64-setup.exe
#   - macOS arm64 : latest-mac.yml  + PccAgent-<v>-mac-arm64.zip
# Linux and non-mainstream arches (Intel mac / win arm64) are intentionally
# dropped — those users keep the GitHub source in the app's settings.

set -euo pipefail

VERSION="${1:?usage: sync-mirror.sh <version>  e.g. 2.0.1}"

SSH_HOST=ec2-2vc-2g-Aliy-cent
REMOTE_DIR=/www/wwwroot/DpccGaming/resource/harnss/updates
REPO=DUNHKpcc/dpcc-harness
GH="https://github.com/${REPO}/releases/download/v${VERSION}"

WIN="PccAgent-${VERSION}-windows-x64-setup.exe"
MAC="PccAgent-${VERSION}-mac-arm64.zip"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
cd "$TMP"

sha() { openssl dgst -sha512 -binary "$1" | openssl base64 -A; }     # base64, electron-updater format
fsize() { stat -f%z "$1"; }                                          # macOS stat

echo "==> [1/6] downloading installers on local Mac (fast GitHub path)"
curl -fL --retry 3 --retry-delay 2 -o "$WIN" "${GH}/${WIN}"
curl -fL --retry 3 --retry-delay 2 -o "$MAC" "${GH}/${MAC}"
[ "$(fsize "$WIN")" -gt 1000000 ] || { echo "ERROR: $WIN looks truncated"; exit 1; }
[ "$(fsize "$MAC")" -gt 1000000 ] || { echo "ERROR: $MAC looks truncated"; exit 1; }

echo "==> [2/6] fetching original channel manifests (tiny, ok over direct GitHub)"
curl -fsSL -o latest.yml.orig     "${GH}/latest.yml"
curl -fsSL -o latest-mac.yml.orig "${GH}/latest-mac.yml"
RDATE_WIN="$(sed -n 's/^releaseDate: //p' latest.yml.orig)"
RDATE_MAC="$(sed -n 's/^releaseDate: //p' latest-mac.yml.orig)"

echo "==> [3/6] writing trimmed manifests (single mainstream arch each)"
# sha512/size are recomputed from the actual downloaded files — never trust the
# orig blindly; this also proves the local download is intact.
cat > latest.yml <<EOF
version: ${VERSION}
files:
  - url: ${WIN}
    sha512: $(sha "$WIN")
    size: $(fsize "$WIN")
path: ${WIN}
sha512: $(sha "$WIN")
releaseDate: ${RDATE_WIN}
EOF

cat > latest-mac.yml <<EOF
version: ${VERSION}
files:
  - url: ${MAC}
    sha512: $(sha "$MAC")
    size: $(fsize "$MAC")
path: ${MAC}
sha512: $(sha "$MAC")
releaseDate: ${RDATE_MAC}
EOF

echo "==> [4/6] uploading to server (domestic link, via scp)"
scp -q "$WIN" "$MAC" latest.yml latest-mac.yml "${SSH_HOST}:${REMOTE_DIR}/"

echo "==> [5/6] server-side: verify sha512, refresh stable links, drop old versions"
WIN_SHA="$(sha "$WIN")"; MAC_SHA="$(sha "$MAC")"
ssh "$SSH_HOST" "
  set -e
  cd '${REMOTE_DIR}'
  rw=\$(openssl dgst -sha512 -binary '${WIN}' | openssl base64 -A)
  rm_=\$(openssl dgst -sha512 -binary '${MAC}' | openssl base64 -A)
  [ \"\$rw\"  = '${WIN_SHA}' ] || { echo 'WIN sha512 MISMATCH on server'; exit 1; }
  [ \"\$rm_\" = '${MAC_SHA}' ] || { echo 'MAC sha512 MISMATCH on server'; exit 1; }
  # 'keep only latest': delete old versioned installers (-type f spares the symlinks)
  find . -maxdepth 1 -type f -name 'PccAgent-*' ! -name '*${VERSION}*' -print -delete
  # version-free stable aliases for sharing (humans), repoint to this version
  ln -sf '${WIN}' PccAgent-windows-x64-setup.exe
  ln -sf '${MAC}' PccAgent-mac-arm64.zip
  rm -f *.orig *.log
  chown -R www:www '${REMOTE_DIR}'; chown -h www:www PccAgent-windows-x64-setup.exe PccAgent-mac-arm64.zip
  echo 'server files:'; ls -la
"

echo "==> [6/6] reload nginx + verify over public URL"
ssh "$SSH_HOST" "nginx -t && nginx -s reload"
BASE="https://dpccgaming.xyz/harnss/updates"
# nginx -s reload is graceful (brief race with old workers) — give it a beat.
sleep 2
echo "--- latest.yml ---";     curl -s "${BASE}/latest.yml"     | grep -E 'version:|url:'
echo "--- latest-mac.yml ---"; curl -s "${BASE}/latest-mac.yml" | grep -E 'version:|url:'
echo -n "win exe range: "; curl -s -r 0-15 "${BASE}/${WIN}" -o /dev/null -w "HTTP %{http_code}\n"
echo -n "mac zip range: "; curl -s -r 0-15 "${BASE}/${MAC}" -o /dev/null -w "HTTP %{http_code}\n"

echo "==> done. Mirror now serves v${VERSION} at ${BASE}/"
