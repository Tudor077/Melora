#!/usr/bin/env node
/**
 * Melora release script
 *
 * Usage:
 *   node scripts/release.mjs patch "Release notes here"   → 0.3.0 → 0.3.1
 *   node scripts/release.mjs minor "Release notes here"   → 0.3.1 → 0.4.0
 *   node scripts/release.mjs major "Release notes here"   → 0.4.0 → 1.0.0
 *
 * What it does:
 *   1. Bumps version in tauri.conf.json, Cargo.toml, package.json (root)
 *   2. Builds the standalone Windows .exe and the Android APK
 *   3. Copies both into releases/latest/ (stable download URLs) and
 *      releases/v{version}/ (archive), updates releases/latest/version.json
 *   4. Commits and pushes
 *   5. Creates a GitHub Release with both binaries attached (gh CLI)
 */

import { readFileSync, writeFileSync, copyFileSync, mkdirSync } from "fs";
import { execSync } from "child_process";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const TAURI_CONF = join(ROOT, "apps", "desktop", "src-tauri", "tauri.conf.json");
const CARGO_TOML = join(ROOT, "apps", "desktop", "src-tauri", "Cargo.toml");
const ROOT_PKG = join(ROOT, "package.json");
const GH = `"C:\\Program Files\\GitHub CLI\\gh.exe"`;

const ANDROID_ENV = {
  JAVA_HOME: "C:\\Program Files\\Eclipse Adoptium\\jdk-17.0.19.10-hotspot",
  ANDROID_HOME: "C:\\Android\\sdk",
  NDK_HOME: "C:\\Android\\sdk\\ndk\\26.3.11579264",
};

function bumpVersion(current, type) {
  const [maj, min, pat] = current.split(".").map(Number);
  if (type === "major") return `${maj + 1}.0.0`;
  if (type === "minor") return `${maj}.${min + 1}.0`;
  if (type === "patch") return `${maj}.${min}.${pat + 1}`;
  throw new Error(`Unknown bump type: ${type}. Use "major", "minor" or "patch".`);
}

const readJson = (p) => JSON.parse(readFileSync(p, "utf8"));
const writeJson = (p, o) => writeFileSync(p, JSON.stringify(o, null, 2) + "\n", "utf8");

// ── main ─────────────────────────────────────────────────────────────────────

const bumpType = process.argv[2];
const notes = process.argv[3];
if (!["major", "minor", "patch"].includes(bumpType) || !notes) {
  console.error(`\nUsage: node scripts/release.mjs [major|minor|patch] "Release notes"\n`);
  process.exit(1);
}

// 1. Bump versions
const tauriConf = readJson(TAURI_CONF);
const newVersion = bumpVersion(tauriConf.version, bumpType);
console.log(`\n🎵  Melora ${tauriConf.version} → ${newVersion}\n`);

tauriConf.version = newVersion;
writeJson(TAURI_CONF, tauriConf);
writeFileSync(
  CARGO_TOML,
  readFileSync(CARGO_TOML, "utf8").replace(/^version\s*=\s*"[^"]+"/m, `version = "${newVersion}"`),
);
const rootPkg = readJson(ROOT_PKG);
rootPkg.version = newVersion;
writeJson(ROOT_PKG, rootPkg);
console.log(`✓ versions bumped`);

// 2. Build
const cargoPath = `${process.env.USERPROFILE}\\.cargo\\bin`;
const env = {
  ...process.env,
  ...ANDROID_ENV,
  PATH: `${ANDROID_ENV.JAVA_HOME}\\bin;${cargoPath};${process.env.PATH}`,
};
const desktopDir = join(ROOT, "apps", "desktop");

console.log(`🔨  Building Windows exe...`);
execSync("npx tauri build --no-bundle", { cwd: desktopDir, stdio: "inherit", env });

console.log(`🔨  Building Android APK...`);
execSync("npx tauri android build --apk --target aarch64", { cwd: desktopDir, stdio: "inherit", env });

// 3. Copy artifacts
const exe = join(desktopDir, "src-tauri", "target", "release", "melora-desktop.exe");
const apk = join(
  desktopDir, "src-tauri", "gen", "android", "app", "build", "outputs",
  "apk", "universal", "release", "app-universal-release.apk",
);

const latestDir = join(ROOT, "releases", "latest");
const versionDir = join(ROOT, "releases", `v${newVersion}`);
mkdirSync(latestDir, { recursive: true });
mkdirSync(versionDir, { recursive: true });

for (const dir of [latestDir, versionDir]) {
  copyFileSync(exe, join(dir, "Melora.exe"));
  copyFileSync(apk, join(dir, "Melora.apk"));
}
writeJson(join(latestDir, "version.json"), {
  version: newVersion,
  date: new Date().toISOString().slice(0, 10),
});
console.log(`✓ artifacts in releases/latest/ + releases/v${newVersion}/`);

// 4. Commit + push
execSync(`git add -A`, { cwd: ROOT, stdio: "inherit" });
execSync(`git commit -m "Release v${newVersion}"`, { cwd: ROOT, stdio: "inherit" });
execSync(`git push`, { cwd: ROOT, stdio: "inherit" });
console.log(`✓ pushed`);

// 5. GitHub Release
execSync(
  `${GH} release create v${newVersion} --title "Melora v${newVersion}" --notes "${notes.replace(/"/g, '\\"')}" ` +
    `"${join(latestDir, "Melora.exe")}#Melora.exe (Windows x64)" ` +
    `"${join(latestDir, "Melora.apk")}#Melora.apk (Android)"`,
  { cwd: ROOT, stdio: "inherit" },
);

console.log(`\n🚀  v${newVersion} live: download page + GitHub Releases\n`);
