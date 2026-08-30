---
name: release
description: "Run the PccAgent release workflow — review staged diff, bump version, commit, tag, push, and create a GitHub release. Use when releasing, bumping version, tagging, or creating a release. Argument: major, minor, or patch."
---

# PccAgent Release Workflow

Run the full release pipeline. Bump type is passed as `$ARGUMENTS` (major, minor, or patch).

## Step 1: Pre-flight Checks

Run these commands and **read every line of output**:

```bash
git status
git diff --cached --stat
git diff --cached
```

If the diff is too large to read in one shot, read it in chunks (e.g., per-directory or line ranges). **You must read the entire diff before proceeding.**

Review for:
- Test files, scratch files, temp files, debug artifacts (e.g., `test-*.ts`, `scratch.*`, `*.tmp`, `random-*.md`)
- Files that shouldn't be committed (`.env`, credentials, large binaries)

If you find any:
- Unstage or remove them
- Tell the user what you removed

If there are no staged changes but unstaged changes exist, ask the user if they want to stage anything first.
If the working tree is completely clean (nothing to release), tell the user and stop.

## Step 2: Version Bump

### Determine new version

1. Read the current version from `package.json` (the `"version"` field)
2. Get the latest tag: `git tag --sort=-v:refname | head -1`
3. Parse the current version as `MAJOR.MINOR.PATCH`
4. Apply the bump type from `$ARGUMENTS`:
   - `major` → `(MAJOR+1).0.0`
   - `minor` → `MAJOR.(MINOR+1).0`
   - `patch` → `MAJOR.MINOR.(PATCH+1)`
5. If `$ARGUMENTS` is empty or invalid, ask the user which bump type they want

### Validate bundled Pi runtime pins

```bash
pnpm pi:runtime:check
npm view @earendil-works/pi-coding-agent version
npm view pi-acp version
npm view pi-mcp-adapter version
```

Compare `package.json`, `pnpm-lock.yaml`, and `scripts/pi-runtime-versions.json`.
The built-in Pi packages must remain exact, mutually compatible pins. If npm has a
newer version, report it but do not silently upgrade it during an ordinary app
version bump. A Pi runtime upgrade is a separately reviewed change that must
update the manifest, lockfile, third-party notice, integration fixtures, and
packaging contracts together.

### Apply changes

1. Edit `package.json` to set the new version number
2. Update the bundled offline release history before committing or tagging. This is a required release gate:
   - Add the new version as the first entry in `src/lib/release-history.ts`
   - Use the release date in `YYYY-MM-DD` format
   - Summarize the staged user-facing changes with stable translation keys; do not use placeholder notes
   - Add matching English and Chinese copy under `about.releaseHistory.entries` in both settings locale files
   - Keep the offline summary semantically consistent with the GitHub Release notes generated in Step 5
   - Keep every previous release entry; release history is append-only
   - Do not continue the release if the new `package.json.version` is missing from the offline history
3. Run the About/release-history regression test:
   ```bash
   pnpm exec vitest run --config vitest.config.electron.ts src/components/settings/__tests__/AboutSettings.test.tsx
   ```
   The test must confirm that `package.json.version` is the newest recorded release and that both locales cover every change key. A failure blocks the release.
4. Stage the version and release-history files:
   ```bash
   git add package.json src/lib/release-history.ts src/i18n/locales/en/settings.json src/i18n/locales/zh/settings.json
   ```
5. If the user separately approved a bundled Pi runtime update, also run:
   ```bash
   pnpm install
   pnpm pi:runtime:check
   pnpm test:pi-integration
   pnpm test:electron-recovery
   git add package.json pnpm-lock.yaml scripts/pi-runtime-versions.json build/pi-runtime/THIRD_PARTY_NOTICES.md
   ```

### Run release gates

Do not commit or tag until every applicable local non-packaging gate passes:

```bash
pnpm docs:check
pnpm test-map:check
pnpm test
pnpm typecheck
pnpm build
pnpm pi:runtime:check
pnpm test:pi-integration
pnpm test:electron-recovery
git diff --check
```

Do not run `electron-builder` or a local packaging command unless the user
explicitly requests local packaging. Release packaging is verified by the
macOS, Windows, and Linux CI jobs.

## Step 3: Commit

Choose the commit message based on what's staged:

### Feature/fix changes staged (not just version bump)

```
feat: short summary (2-4 key themes)

- Change description 1
- Change description 2
- ...
```

Use `fix:` instead of `feat:` if all changes are bug fixes.

### Only version bump staged

```
chore: bump version to X.Y.Z
```

If a bundled Pi runtime upgrade was also approved and included:

```
chore: bump version to X.Y.Z and update bundled Pi runtime
```

### Always use a HEREDOC

```bash
git commit -m "$(cat <<'EOF'
<message here>
EOF
)"
```

## Step 4: Tag & Push

```bash
git tag vX.Y.Z HEAD
git push origin master && git push origin vX.Y.Z
```

If push fails, report the error and stop.

## Step 5: GitHub Release

### Gather context

Get the previous release tag:

```bash
git tag --sort=-v:refname | head -2 | tail -1
```

Read the full diff and commit log since the previous release:

```bash
git log v{prev}...HEAD --oneline
git diff v{prev}...HEAD --stat
git diff v{prev}...HEAD
```

Read ALL of this output. For the full diff, read it in chunks if needed — every line matters for writing accurate release notes.

### Write release notes

Load the template from [references/release-notes-template.md](references/release-notes-template.md) and follow its format exactly.
Before creating the release, compare the final notes with the new entry in `src/lib/release-history.ts` and both locale files. The offline entry may be shorter, but it must cover the same user-facing changes without contradictions.

### Create the release

```bash
gh release create vX.Y.Z --title "vX.Y.Z — Short Descriptive Phrase" --notes "$(cat <<'EOF'
<release notes>
EOF
)"
```

The title uses an em dash (`—`), not a hyphen.

Output the release URL when done so the user can verify.

## Important Notes

- **Never skip reading the full diff** in Step 1. Every line matters.
- Do not add a synthetic `Co-Authored-By` trailer. Preserve a real existing
  trailer only when the user explicitly asks for it.
- Pi is the only built-in live Agent. Release notes must not describe
  Claude/Codex runtime support as current functionality; mention those names
  only for legacy-session compatibility or migration.
- Repo: `https://github.com/DUNHKpcc/dpcc-harness`
- Main branch: `master`
- Changelog URL format: `https://github.com/DUNHKpcc/dpcc-harness/compare/v{prev}...v{current}`
- Package manager: `pnpm` (never use npm or yarn for installs)
