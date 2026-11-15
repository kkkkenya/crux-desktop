# Releasing a new Crux Harness version

There are two kinds of release.

- **Update (most releases).** Only the app inside the window changed: pages, the tutor's prompts, Crux features. Installed apps get "Update now" and update themselves in about a minute. One command does it (below).
- **Installer.** Anything in `electron/`, `electron-builder.yml` or `build/` changed. Students download and run the installer.

## Update (no installer)

1. Raise `version` in `package.json` (for example 0.6.3 to 0.6.4) and write `docs/crux/versions/<version>.md`.
2. `node scripts/crux-patch-release.mjs --publish` (about 10 minutes). It refuses if the window shell changed since the version in `docs/crux/shell-version`. It builds the server, zips it, uploads the zip to the GitHub release `v<version>` and writes Crux web's `study/web/public/desktop/latest.json` with the zip's link, size and SHA-256.
3. Commit and push Crux web. Installed apps see "Update now" on their next start.

## Installer

1. Raise `version` in `package.json` (for example 0.6.0 to 0.7.0).
2. Write `docs/crux/versions/<version>.md`: Done, To do, Scrapped, Known issues.
3. Build the installer (about 15 minutes, Git Bash):
   `npm run build && node scripts/build-server.mjs && node scripts/smoke-server.mjs --electron && npx electron-builder --win --x64 --publish never`
4. Install it over the current version and check it opens: `MSYS_NO_PATHCONV=1 dist/Crux-Harness-<version>-x64-setup.exe /S`.
5. Push the `crux` branch, then publish the release with the installer named `Crux-Setup.exe`:
   `cp dist/Crux-Harness-<version>-x64-setup.exe Crux-Setup.exe`
   `gh release create v<version> Crux-Setup.exe --repo kkkkenya/crux-desktop --target crux --title "Crux <version>" --notes-file docs/crux/versions/<version>.md`
6. Write the version into `docs/crux/shell-version` and tag the commit `git tag v<version>`, so later updates know which shell they build on.
7. Tell installed apps: in the Crux web repo, set `version` (and `notes`) in `study/web/public/desktop/latest.json` and push. Each app shows "A new version of Crux is out" on its next start.

The site's download button links to `releases/latest/download/Crux-Setup.exe`, so it always gives the newest release.
