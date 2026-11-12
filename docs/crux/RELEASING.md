# Releasing a new Crux desktop version

1. Raise `version` in `package.json` (for example 0.6.0 to 0.7.0).
2. Write `docs/crux/versions/<version>.md`: Done, To do, Scrapped, Known issues.
3. Build the installer (about 15 minutes, Git Bash):
   `npm run build && node scripts/build-server.mjs && node scripts/smoke-server.mjs --electron && npx electron-builder --win --x64 --publish never`
4. Install it over the current version and check it opens: `MSYS_NO_PATHCONV=1 dist/Crux-<version>-x64-setup.exe /S`.
5. Push the `crux` branch, then publish the release with the installer named `Crux-Setup.exe`:
   `cp dist/Crux-<version>-x64-setup.exe Crux-Setup.exe`
   `gh release create v<version> Crux-Setup.exe --repo kkkkenya/crux-desktop --target crux --title "Crux <version>" --notes-file docs/crux/versions/<version>.md`
6. Tell installed apps: in the Crux web repo, set `version` (and `notes`) in `study/web/public/desktop/latest.json` and push. Each app shows "A new version of Crux is out" on its next start.

The site's download button links to `releases/latest/download/Crux-Setup.exe`, so it always gives the newest release.
