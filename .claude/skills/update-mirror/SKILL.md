---
name: update-mirror
description: "Publish/refresh a Harnss release on the dpccgaming.xyz domestic update mirror so Chinese users get fast auto-updates. Use when releasing a new version, updating the mirror, syncing installers to the server, or fixing the China update source. Argument: the version, e.g. 2.0.1."
---

# Update the dpccgaming.xyz Domestic Update Mirror

Mirror the latest GitHub release to the self-hosted China mirror so the app's
"国内镜像" update source serves it. GitHub stays the official source; this mirror
is the fast in-China alternate users can pick in Settings → 通用 → 更新源.

The version is passed as `$ARGUMENTS` (e.g. `2.0.1`). If absent, ask for it or
read it from `package.json` (`version` field) — it must match the GitHub release
tag `v<version>`.

## Critical constraint — how files get to the server

**Download on the LOCAL Mac, then `scp` to the server. NEVER download from
GitHub on the server.**

- Server → GitHub direct: throttled to **~12 KB/s** (≈9 hours per 400 MB file). Unusable.
- GitHub acceleration proxies (gh-proxy.com, ghfast.top, …): their range-request
  speed-test looks fast, but **sustained full-file download is throttled the same**.
- Local Mac → GitHub: **~4 MB/s** (~100 s per file). Mac → server upload is a
  domestic link and is fast. This is the only reliable path.

Channel manifests (`latest*.yml`, <1 KB) are tiny, so fetching those directly is fine.

## What the mirror holds (curated)

Only the **mainstream build of the latest version**:

| Platform | Manifest | Installer |
|---|---|---|
| Windows x64 | `latest.yml` | `PccAgent-<v>-windows-x64-setup.exe` |
| macOS arm64 (Apple Silicon) | `latest-mac.yml` | `PccAgent-<v>-mac-arm64.zip` |

Dropped on purpose: Linux entirely; Intel mac (`-mac-x64.zip`), Windows arm64,
all `.dmg`, the combined `-windows-setup.exe`. Those users keep the GitHub
source — that is the whole point of the dual-source design. Old versions are
deleted so only the latest remains.

> macOS auto-update uses the **`.zip`** (not the `.dmg`); the app's unsigned
> manual-install path also consumes that zip. Windows uses the `-x64-setup.exe`.

## The fast path: run the script

From the repo root on the Mac:

```bash
.claude/skills/update-mirror/references/sync-mirror.sh <version>   # e.g. 2.0.1
```

It downloads the two installers locally, fetches + **trims** the manifests to the
single mainstream arch (recomputing sha512/size from the real files), `scp`s all
four files up, verifies sha512 server-side, deletes old-version files, fixes
ownership, reloads nginx, and curls the public URL to confirm. Read its output —
every step prints a check. If any sha512 mismatches, stop and investigate (a
truncated download is the usual cause).

After it succeeds, sanity-check in a browser / curl:
`https://dpccgaming.xyz/harnss/updates/latest.yml` should show the new version.

## Manual path (if the script can't be used)

Do the same steps by hand. Replace `<v>` with the version.

```bash
# 1. LOCAL Mac: download installers (fast) + original manifests
TMP=$(mktemp -d); cd "$TMP"
GH=https://github.com/DUNHKpcc/dpcc-harness/releases/download/v<v>
curl -fL --retry 3 -o PccAgent-<v>-windows-x64-setup.exe "$GH/PccAgent-<v>-windows-x64-setup.exe"
curl -fL --retry 3 -o PccAgent-<v>-mac-arm64.zip          "$GH/PccAgent-<v>-mac-arm64.zip"
curl -fsSL -o latest.yml.orig "$GH/latest.yml"
curl -fsSL -o latest-mac.yml.orig "$GH/latest-mac.yml"

# 2. Trim manifests to the single kept arch. Recompute sha512(base64)+size from
#    the downloaded file; keep version + releaseDate from the .orig.
#    latest.yml      -> files[] has only the windows-x64 entry; path = it.
#    latest-mac.yml  -> files[] has only the mac-arm64 entry;   path = it.
#    (electron-updater rejects the update if sha512/size don't match the file.)

# 3. Upload
scp PccAgent-<v>-windows-x64-setup.exe PccAgent-<v>-mac-arm64.zip \
    latest.yml latest-mac.yml \
    ec2-2vc-2g-Aliy-cent:/www/wwwroot/DpccGaming/resource/harnss/updates/

# 4. Server: verify sha512 == manifest, delete old versions, chown, reload
ssh ec2-2vc-2g-Aliy-cent '
  cd /www/wwwroot/DpccGaming/resource/harnss/updates
  openssl dgst -sha512 -binary PccAgent-<v>-mac-arm64.zip | openssl base64 -A   # compare to latest-mac.yml
  find . -maxdepth 1 -name "PccAgent-*" ! -name "*<v>*" -delete
  rm -f *.orig *.log; chown -R www:www .
  nginx -t && nginx -s reload'

# 5. Verify public URL (reload is graceful — retry once if a stale worker answers)
curl -s https://dpccgaming.xyz/harnss/updates/latest.yml
curl -s https://dpccgaming.xyz/harnss/updates/latest-mac.yml
```

## Server reference (already provisioned — recreate only if lost)

- SSH alias: `ec2-2vc-2g-Aliy-cent` (root, Alibaba Cloud Linux, nginx via BT panel)
- Mirror dir: `/www/wwwroot/DpccGaming/resource/harnss/updates/` (owned `www:www`;
  outside the frontend `dist/`, so a frontend redeploy won't wipe it)
- Public base URL: `https://dpccgaming.xyz/harnss/updates/`
- nginx location: `/www/server/panel/vhost/nginx/extension/dpccgaming.xyz/harnss-updates.conf`
  (BT auto-includes `extension/dpccgaming.xyz/*.conf`). Serves the dir via `root`
  with CORS + `Accept-Ranges`; installers cache 30 d, `*.yml` is `no-cache`.
  The main site is a Vue SPA (`try_files $uri $uri/ /index.html`); the `^~`
  prefix location wins over the SPA fallback so real files are served. If a `.yml`
  request returns the SPA `index.html`, it's the graceful-reload race — re-request.

If the location conf is ever missing, recreate it:

```nginx
location ^~ /harnss/updates/ {
    root /www/wwwroot/DpccGaming/resource;
    default_type application/octet-stream;
    add_header Access-Control-Allow-Origin *;
    add_header Accept-Ranges bytes;
    location ~* ^/harnss/updates/.+\.(exe|zip)$ {
        root /www/wwwroot/DpccGaming/resource;
        default_type application/octet-stream;
        add_header Access-Control-Allow-Origin *;
        add_header Cache-Control "public, max-age=2592000";
    }
    location ~* ^/harnss/updates/.+\.yml$ {
        root /www/wwwroot/DpccGaming/resource;
        default_type "text/yaml; charset=utf-8";
        add_header Access-Control-Allow-Origin *;
        add_header Cache-Control "no-cache, must-revalidate";
    }
}
```

## Direct download links (for sharing, no app needed)

Use the **version-free stable links** — these never change across releases (they
are symlinks the sync repoints to the latest version each time):

- Windows x64: `https://dpccgaming.xyz/harnss/updates/PccAgent-windows-x64-setup.exe`
- macOS arm64: `https://dpccgaming.xyz/harnss/updates/PccAgent-mac-arm64.zip`

Share those. The versioned files (`PccAgent-<v>-…`) still exist underneath — the
auto-updater needs the exact names from `latest.yml` — but humans should never
need to know the version. Manifests: `…/latest.yml` · `…/latest-mac.yml`.

> The stable links are plain symlinks (nginx follows them; `disable_symlinks` is
> off). `sync-mirror.sh` recreates them every run, so they always point at the
> latest. If editing by hand, after uploading run on the server:
> `cd <mirror-dir> && ln -sf PccAgent-<v>-windows-x64-setup.exe PccAgent-windows-x64-setup.exe && ln -sf PccAgent-<v>-mac-arm64.zip PccAgent-mac-arm64.zip && chown -h www:www PccAgent-windows-x64-setup.exe PccAgent-mac-arm64.zip`

## App-side wiring (context, not part of a sync)

The feed URL is hardcoded in `electron/src/lib/updater.ts` as
`UPDATE_MIRROR_URL = "https://dpccgaming.xyz/harnss/updates/"`. Users switch
sources in Settings (`AppSettings.updateSource: "github" | "mirror"`). A client
build must ship with that constant for "国内镜像" to work — so after the first
release that introduces it, rebuild/republish the app. Changing the mirror domain
later means editing the constant and re-releasing.
