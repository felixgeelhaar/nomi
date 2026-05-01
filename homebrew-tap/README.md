# Homebrew tap (template)

This directory holds the canonical Homebrew Cask template for Nomi.
The actual tap that users install from lives in a separate repository,
`nomiai/homebrew-tap`. The release workflow in `.github/workflows/release.yml`
opens a PR against that external repo on every published release,
bumping `version` + `sha256` + the URL to point at the new artifact.

## First-time setup (maintainer)

1. Create the public repo `nomiai/homebrew-tap` on GitHub. The repo
   name must start with `homebrew-` for the `brew tap nomiai/tap`
   shortcut to resolve.
2. Copy the contents of this directory into the new repo:
   ```bash
   cp -r homebrew-tap/* /path/to/nomiai-homebrew-tap/
   ```
3. Commit + push.
4. Create a fine-grained Personal Access Token (PAT) with
   `Contents: write` scope on `nomiai/homebrew-tap` and add it as the
   `HOMEBREW_TAP_GITHUB_TOKEN` secret on `nomiai/nomi`. The release
   workflow uses it to open the auto-bump PR.

## User installation

Once the tap repo is published:

```bash
brew tap nomiai/tap
brew install --cask nomi
```

The cask:

- Downloads the universal DMG from the latest signed GitHub Release.
- Drags `Nomi.app` into `/Applications`.
- Trusts the Apple Developer ID Application signature (no Gatekeeper
  prompt because the bundle is notarized + stapled in
  `signing-05`).

## What gets removed on `brew uninstall --zap nomi`

- `~/Library/Application Support/Nomi/` — the SQLite database,
  bearer token, plugin store.
- `~/Library/Caches/ai.nomi.app/`
- `~/Library/Preferences/ai.nomi.app.plist`
- `~/Library/Saved Application State/ai.nomi.app.savedState`

The Go daemon (`nomid`) is not bundled by the cask today. Users who
want to run the daemon standalone download it from the GitHub Release
or via `brew install nomid` if/when a formula is published.

## Cask filename naming convention

Tauri's bundler outputs the universal DMG as
`Nomi_<version>_universal.dmg`. The cask `url` interpolates `#{version}`
to match. Renaming the bundle would require a corresponding edit here.
