# Signing certificates — custody, rotation, and incident response

This runbook covers every cryptographic identity Nomi ships its desktop
binaries under:

1. **Apple Developer ID Application** — signs and notarizes the macOS
   `.app` / `.dmg` so Gatekeeper accepts the bundle on first launch.
2. **Windows EV/OV code-signing certificate** — signs the `.msi` so
   SmartScreen doesn't block the installer.
3. **Ed25519 update signing key** — signs the Tauri auto-update
   manifests (`latest.json`) so existing installs only accept updates
   from us.

Each section documents the cadence, the storage location, the GitHub
Actions secret names that must stay in sync, and the incident
playbooks for the failure modes we have seen or anticipated.

> Audience: Nomi maintainers with admin on `nomiai/nomi`. None of these
> procedures should be carried out without 4-eyes verification.

## At-a-glance

| Identity                       | Lifetime    | Custodian      | Rotation cadence | GitHub Actions secret(s)                                                          |
| ------------------------------ | ----------- | -------------- | ---------------- | --------------------------------------------------------------------------------- |
| Apple Developer ID Application | 5 years     | Maintainer     | T-90 days        | `APPLE_CERTIFICATE`, `APPLE_CERTIFICATE_PASSWORD`, `APPLE_SIGNING_IDENTITY`       |
| Apple ID + app-specific pw     | App-pw: 1y  | Maintainer     | yearly           | `APPLE_ID`, `APPLE_PASSWORD`, `APPLE_TEAM_ID`                                     |
| Windows EV/OV cert             | 1–3 years   | Maintainer     | T-90 days        | `WINDOWS_CERTIFICATE`, `WINDOWS_CERTIFICATE_PASSWORD`                             |
| Ed25519 update key (prod)      | indefinite  | Maintainer     | only on leak     | `TAURI_SIGNING_PRIVATE_KEY`, `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`                 |
| Ed25519 update key (dev)       | indefinite  | committed repo | n/a              | none — `dev-keys/nomi-dev.key` lives in the repo                                  |

A calendar reminder template at the bottom of this doc seeds the
T-90 alerts.

---

## 1. Apple Developer ID Application

### What it is

A 5-year certificate issued under Apple's Developer Program ($99 / yr
membership). The matching private key is what `codesign` and
`notarytool` use; without it, every macOS user sees an "unidentified
developer" Gatekeeper prompt and most never click through.

### Storage

- **Private key + cert**: `.p12` exported from the maintainer's
  Keychain. Stored in 1Password under
  `Engineering › Signing › Apple Developer ID Application`. Password
  for the `.p12` is in the same vault entry, generated with `pwgen`
  (32 chars).
- **Apple ID + app-specific password**: in 1Password under
  `Engineering › Signing › Apple ID`. The app-specific password is
  rotated yearly (Apple expires them silently after 12 months of disuse;
  on rotation we proactively renew before expiry).
- **Team ID**: not secret. Same vault entry; also visible at
  https://developer.apple.com/account → Membership.

### GitHub Actions secret mapping

The values pasted into `nomiai/nomi` → Settings → Secrets:

| Secret                          | Source                                           |
| ------------------------------- | ------------------------------------------------ |
| `APPLE_CERTIFICATE`             | `base64 -i developer-id.p12 \| pbcopy`           |
| `APPLE_CERTIFICATE_PASSWORD`    | the .p12 password from 1Password                 |
| `APPLE_SIGNING_IDENTITY`        | `Developer ID Application: <Name> (<TEAM_ID>)`   |
| `APPLE_ID`                      | the maintainer's Apple ID email                  |
| `APPLE_PASSWORD`                | app-specific password from appleid.apple.com     |
| `APPLE_TEAM_ID`                 | 10-char ID from developer.apple.com → Membership |

The release workflow (`.github/workflows/release.yml`) also runs a
verification step that calls `codesign --verify` and `spctl --assess`;
a silent secret typo therefore fails the release rather than shipping
unsigned.

### Routine rotation (T-90 days)

The Developer ID cert lasts 5 years but expires hard — once expired,
existing notarization tickets keep working but new releases can't be
signed. Rotate at T-90 to leave headroom:

1. Log in to https://developer.apple.com/account → Certificates → "+"
   → Developer ID Application. Apple lets you have two simultaneously
   for transition windows; create the new one without revoking the old.
2. Download the new `.cer`, double-click to install in the maintainer's
   Keychain, then export the private key + cert as a new `.p12`.
3. Update 1Password with the new `.p12` + password; keep the previous
   entry around for 30 days marked "OLD — do not use".
4. Update GitHub secrets `APPLE_CERTIFICATE` + `APPLE_CERTIFICATE_PASSWORD`
   + `APPLE_SIGNING_IDENTITY`. Run `.github/workflows/update-e2e.yml`
   manually to confirm the new identity signs cleanly.
5. Cut a no-op patch release (e.g. `v<current>.<minor>.<patch+1>`) and
   verify Gatekeeper accepts it on a fresh macOS VM.
6. Once the new cert has shipped one successful release, revoke the
   previous one in the developer portal and remove the OLD 1Password
   entry.

### Incident: cert leaked

A `.p12` leaving the maintainer's machine, a public CI log accidentally
echoing `APPLE_CERTIFICATE`, an unencrypted backup making it to a
third-party drive — any of these triggers this playbook.

1. Log in to developer.apple.com → Certificates → select the leaked
   cert → Revoke. **Revocation is immediate and global; do not skip.**
2. Notarized bundles previously shipped under that cert keep working
   (notarization tickets are signed by Apple, not by us). Existing
   users feel nothing.
3. Issue a new Developer ID Application cert per the routine rotation
   steps above. Update GitHub secrets within 24 hours.
4. Audit GitHub Actions logs for the prior 30 days for any sign that
   the secret was extracted (look for `APPLE_CERTIFICATE` substring,
   weird workflow_dispatch calls, repo-level token reuse). File an
   incident note in `docs/incidents/<yyyy-mm-dd>-apple-cert-leak.md`.
5. Force-rotate `APPLE_PASSWORD` (app-specific password) too — leaks
   that touched the Keychain may have touched it as well.

### Incident: cert expired during release

The `tauri build` step fails with `errSecCertificateExpired` or
notarytool returns `Invalid` with `code = 65`. Symptoms: the macOS job
in the release workflow hard-fails, no `.app.tar.gz` is uploaded.

1. Check the certificate dates: `openssl pkcs12 -in developer-id.p12 -nokeys -info`.
   Confirm expiry vs system clock.
2. Run the routine rotation procedure above, treating it as
   accelerated. Skip the 30-day overlap step.
3. Re-run the failed release workflow. The draft release is preserved
   so artifacts from non-macOS jobs already there don't need to rebuild.

---

## 2. Windows EV / OV code-signing cert

### What it is

A code-signing certificate issued by a CA Microsoft trusts (DigiCert,
Sectigo, GlobalSign). EV (Extended Validation) is preferred — it
suppresses SmartScreen warnings immediately on first install, whereas
OV builds reputation gradually and shows warnings until enough users
trust it. Cost: $200–$700/yr depending on vendor + validation tier.

### Storage

- **Private key + cert**: hardware token (HSM) for EV; `.pfx` file for
  OV. The token's PIN or the `.pfx` password lives in 1Password under
  `Engineering › Signing › Windows Code-Signing`.
- For EV, the private key is non-exportable from the HSM. Signing in CI
  requires either Azure Key Vault (preferred) or a dedicated build VM
  with the token plugged in. Document the chosen setup here once
  procurement happens; this section is a stub until then.

### GitHub Actions secret mapping (OV path; EV documented when implemented)

| Secret                          | Source                                       |
| ------------------------------- | -------------------------------------------- |
| `WINDOWS_CERTIFICATE`           | `base64 -i code-signing.pfx`                 |
| `WINDOWS_CERTIFICATE_PASSWORD`  | `.pfx` password from 1Password               |

The workflow runs `signtool sign /tr http://timestamp.digicert.com /td sha256 /fd sha256`
plus `signtool verify /pa` post-build. Timestamping ensures signatures
remain valid past the cert's own expiry (signed binaries are still
trusted by Windows after the cert lapses, as long as they were
timestamped during the cert's validity).

### Routine rotation (T-90 days)

OV certs are typically 1-year. EV certs are 1–3 years.

1. Initiate renewal with the CA at T-90. CAs usually offer a renewal
   workflow that reuses the validated identity and only requires a new
   key pair.
2. For EV: order the new HSM token. While it's being shipped, finalize
   the cert; once received, update GitHub secrets.
3. For OV: download the new `.pfx`, paste-base64-encode it into
   `WINDOWS_CERTIFICATE`. Update `WINDOWS_CERTIFICATE_PASSWORD`.
4. Cut a no-op patch release; verify SmartScreen accepts the MSI on a
   clean Windows 11 VM.

### Incident: cert leaked (OV) / token compromised (EV)

1. Contact the CA's revocation hotline. CAs have 24h SLAs on revocation
   for incidents.
2. Past timestamped binaries continue working but anyone holding the
   key can sign new ones until the revocation propagates. Treat the
   window as fully compromised.
3. Notify users via release notes if a malicious build could plausibly
   have been distributed (e.g. someone with the cert pushed a tag).
4. Re-issue per routine rotation; update GitHub secrets.

---

## 3. Ed25519 update signing key

### What it is

The minisign-format keypair used by Tauri's auto-updater. The public
key is embedded in `app/src-tauri/tauri.conf.json` →
`plugins.updater.pubkey` at build time. Existing installs trust update
manifests signed by the matching private key, and *only* that key —
losing it means every existing user is stranded on whatever version
they last had.

This is the highest-stakes credential in the project.

### Custody

- **Production key**: `.key` file generated via
  `npx tauri signer generate -w nomi-update.key`. Stored in 1Password
  under `Engineering › Signing › Ed25519 Update Key`. The vault entry
  also stores the password (32-char generated). Backed up to a
  separate offline vault at <maintainer-residence-safe>.
- **Development key**: committed to the repository at
  `dev-keys/nomi-dev.key` and `dev-keys/nomi-dev.key.pub`. Anyone with
  read access to the repo can sign update manifests that locally-built
  copies of Nomi will accept. Acceptable for development; not for
  shipping to users. See `dev-keys/README.md` for context.

### GitHub Actions secret mapping

| Secret                                | Source                                                   |
| ------------------------------------- | -------------------------------------------------------- |
| `TAURI_SIGNING_PRIVATE_KEY`           | the contents of the production `.key` file (multi-line)  |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`  | the password from 1Password                              |

When `TAURI_SIGNING_PRIVATE_KEY` is unset, the release workflow signs
with the committed dev key — fine for pre-1.0 internal alpha builds,
not for public distribution. The first cut of the production key
**must** happen before announcing the project publicly.

### Switching from dev to production pubkey

This is a one-way door. Every existing install that has a dev-key
build will reject manifests signed by the new prod key, and vice
versa. Plan it with the next major release.

1. Generate the production keypair on an air-gapped machine if
   feasible: `npx tauri signer generate -w nomi-update-prod.key`.
2. Store the private key + password in 1Password, replicated to the
   offline vault.
3. Replace `plugins.updater.pubkey` in
   `app/src-tauri/tauri.conf.json` with the new public key (single
   line, base64). Commit this change.
4. Add `TAURI_SIGNING_PRIVATE_KEY` + `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`
   to GitHub Actions secrets.
5. Cut a release. Existing dev-key users have to reinstall manually —
   surface this in release notes prominently. Going forward all
   updates are signed by the prod key.

### Incident: production update key leaked

This is the hardest case. The leak window allows an attacker to ship
malicious updates to every existing install.

1. **Immediately**: take down the GitHub Releases that reference the
   compromised manifest (mark them as drafts again so the
   `latest.json` redirect 404s and existing apps stop seeing
   updates). This buys time but doesn't stop apps that already
   downloaded a malicious bundle.
2. Generate a new production keypair. Update `tauri.conf.json` with
   the new public key. Cut a release with a forced major-version
   bump (v2 → v3 etc.) and clearly-flagged release notes.
3. The pubkey rotation **forces every existing install to be reinstalled
   manually** — the new app rejects updates signed under the old key
   and won't auto-roll forward. There is no graceful path.
4. Communicate via every available channel (release notes, blog,
   in-app banner if a hotfix can be shipped under the OLD key with a
   "please reinstall" message — but this depends on still trusting
   the old key, which after a leak we don't).
5. Audit the leak vector. File `docs/incidents/<yyyy-mm-dd>-update-key-leak.md`.

### Incident: production update key lost (no leak)

E.g. 1Password vault permanently deleted, offline backup destroyed,
maintainer hit by a bus.

1. Same recovery as a leak: new keypair, new pubkey embedded, forced
   reinstall for every user.
2. The communications angle is friendlier ("we rotated keys for
   security best practices") but the user impact is identical.
3. **Mitigation**: keep the offline backup. Audit it yearly.

---

## Calendar reminders

Paste this into a shared calendar (or a recurring CalDAV task) so
rotations don't fall through the cracks:

```
Title: Apple Developer ID — rotate at T-90
Recurrence: yearly, anchored to current cert expiry minus 90 days
Body: Run `openssl pkcs12 -in developer-id.p12 -nokeys -info` and check
the notAfter date. If <90 days, follow docs/runbooks/signing-certs.md
section 1 routine rotation.
```

```
Title: Apple ID app-specific password — refresh
Recurrence: yearly
Body: Generate a fresh app-specific password at appleid.apple.com,
update GitHub secret APPLE_PASSWORD, run update-e2e workflow to
confirm.
```

```
Title: Windows code-signing cert — rotate at T-90
Recurrence: aligned to cert expiry minus 90 days
Body: docs/runbooks/signing-certs.md section 2 routine rotation.
```

```
Title: Audit Ed25519 update key offline backup
Recurrence: yearly
Body: Confirm the offline copy of the production update signing key
exists, is readable, and matches the 1Password vault entry. Required
for the "key lost" incident playbook to be feasible.
```

---

## Verification checklist

After any cert/key rotation, run through this before declaring the
release good:

- [ ] `update-e2e.yml` workflow run is green on the latest commit.
- [ ] A test release tag (`v<current>-rotation-test`) builds, signs,
      notarizes, and the resulting `.app` opens without Gatekeeper
      prompt on a fresh macOS VM.
- [ ] `signtool verify /pa Nomi_*.msi` returns "Successfully verified"
      on a fresh Windows VM.
- [ ] Auto-update from the previous release installs cleanly (run
      with `defaults write ai.nomi.app updater.endpoints '...'` to
      point at a staging manifest if needed).
- [ ] 1Password vault entries reflect the new identities; OLD entries
      are dated.
- [ ] `docs/runbooks/signing-certs.md` "GitHub Actions secret mapping"
      tables match what's actually in repo settings (no stale rows).
