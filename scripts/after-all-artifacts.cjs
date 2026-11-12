"use strict";
/*
 * electron-builder afterAllArtifactBuild (Crux, 2026-11-12).
 *
 * A folder with a Low integrity label (this laptop's Downloads has one) passes it
 * to every file built inside it. Windows runs a Low-labelled installer in the
 * browser sandbox level, where it cannot write to %LOCALAPPDATA%\Programs: it
 * reported "Crux cannot be closed", failed to write its uninstaller and aborted.
 * Each Windows installer is set back to the normal (Medium) level here.
 */
const { execFileSync } = require("node:child_process");

module.exports = async function afterAllArtifactBuild(result) {
	if (process.platform !== "win32") return [];
	for (const file of result.artifactPaths ?? []) {
		if (!/\.exe$/i.test(file)) continue;
		execFileSync("icacls", [file, "/setintegritylevel", "M"], { stdio: "ignore" });
		const label = execFileSync("icacls", [file], { encoding: "utf8" });
		if (/Mandatory Label\Low/i.test(label)) throw new Error(`${file} still has a Low integrity label`);
		console.log(`  • integrity set to Medium  file=${file}`);
	}
	return [];
};
