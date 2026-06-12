#!/usr/bin/env node
/**
 * Melora release script
 *
 * Usage:
 *   node scripts/release.mjs minor   → 0.1.0 → 0.2.0
 *   node scripts/release.mjs major   → 0.1.0 → 1.0.0
 *
 * What it does:
 *   1. Bumps version in tauri.conf.json, Cargo.toml, package.json (root)
 *   2. Builds the Tauri Windows installer
 *   3. Copies the .exe to releases/v{version}/
 *   4. Updates releases/versions.json
 */

import { readFileSync, writeFileSync, copyFileSync, mkdirSync, existsSync } from "fs";
import { execSync } from "child_process";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const VERSIONS_FILE = join(ROOT, "releases", "versions.json");
const TAURI_CONF = join(ROOT, "apps", "desktop", "src-tauri", "tauri.conf.json");
const CARGO_TOML = join(ROOT, "apps", "desktop", "src-tauri", "Cargo.toml");
const ROOT_PKG = join(ROOT, "package.json");

// ── helpers ──────────────────────────────────────────────────────────────────

function bumpVersion(current, type) {
  const [maj, min, pat] = current.split(".").map(Number);
  if (type === "major") return `${maj + 1}.0.0`;
  if (type === "minor") return `${maj}.${min + 1}.0`;
  throw new Error(`Unknown bump type: ${type}. Use "major" or "minor".`);
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function writeJson(path, obj) {
  writeFileSync(path, JSON.stringify(obj, null, 2) + "\n", "utf8");
}

function patchCargoToml(content, newVersion) {
  return content.replace(/^version\s*=\s*"[^"]+"/m, `version = "${newVersion}"`);
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

// ── main ─────────────────────────────────────────────────────────────────────

const bumpType = process.argv[2];
if (!["major", "minor"].includes(bumpType)) {
  console.error(`\nUsage: node scripts/release.mjs [major|minor]\n`);
  process.exit(1);
}

// 1. Read current version
const tauriConf = readJson(TAURI_CONF);
const currentVersion = tauriConf.version;
const newVersion = bumpVersion(currentVersion, bumpType);

console.log(`\n🎵  Melora Release`);
console.log(`   ${currentVersion} → ${newVersion} (${bumpType})\n`);

// 2. Patch versions
tauriConf.version = newVersion;
writeJson(TAURI_CONF, tauriConf);
console.log(`✓ tauri.conf.json → ${newVersion}`);

const cargoRaw = readFileSync(CARGO_TOML, "utf8");
writeFileSync(CARGO_TOML, patchCargoToml(cargoRaw, newVersion), "utf8");
console.log(`✓ Cargo.toml → ${newVersion}`);

const rootPkg = readJson(ROOT_PKG);
rootPkg.version = newVersion;
writeJson(ROOT_PKG, rootPkg);
console.log(`✓ package.json → ${newVersion}\n`);

// 3. Build
console.log(`🔨  Building Tauri desktop app...`);
const cargoPath = `${process.env.USERPROFILE || process.env.HOME}\\.cargo\\bin`;
const env = { ...process.env, PATH: `${process.env.PATH};${cargoPath}` };

execSync("npm run build --workspace @melora/web", {
  cwd: ROOT,
  stdio: "inherit",
  env,
});

execSync(`npx tauri build`, {
  cwd: join(ROOT, "apps", "desktop"),
  stdio: "inherit",
  env,
});
console.log(`\n✓ Build complete`);

// 4. Copy installer
const bundleDir = join(ROOT, "apps", "desktop", "src-tauri", "target", "release", "bundle");
const nsisExe = join(bundleDir, "nsis", `Melora_${newVersion}_x64-setup.exe`);
const msiExe  = join(bundleDir, "msi",  `Melora_${newVersion}_x64_en-US.msi`);

const releaseDir = join(ROOT, "releases", `v${newVersion}`);
mkdirSync(releaseDir, { recursive: true });

let winDownloadPath = null;

if (existsSync(nsisExe)) {
  const dest = join(releaseDir, "Melora-Setup.exe");
  copyFileSync(nsisExe, dest);
  winDownloadPath = `releases/v${newVersion}/Melora-Setup.exe`;
  console.log(`✓ Copied NSIS installer → ${winDownloadPath}`);
} else if (existsSync(msiExe)) {
  const dest = join(releaseDir, "Melora-Setup.msi");
  copyFileSync(msiExe, dest);
  winDownloadPath = `releases/v${newVersion}/Melora-Setup.msi`;
  console.log(`✓ Copied MSI installer → ${winDownloadPath}`);
} else {
  console.warn(`⚠  Could not find installer in bundle/nsis or bundle/msi — update versions.json manually.`);
}

// 5. Update versions.json
const versions = readJson(VERSIONS_FILE);

const releaseEntry = {
  version: newVersion,
  label: bumpType === "major" ? `v${newVersion.split(".")[0]}` : `v${newVersion}`,
  date: today(),
  notes: [
    "See changelog for details",
  ],
  downloads: {
    windows: winDownloadPath,
    mac: null,
  },
};

versions.releases.unshift(releaseEntry);
versions.latest = newVersion;
writeJson(VERSIONS_FILE, versions);
console.log(`✓ versions.json updated\n`);

console.log(`🚀  Release v${newVersion} ready!`);
console.log(`   Edit releases/versions.json to add proper release notes.`);
console.log(`   Host download.html + releases/ anywhere to publish.\n`);
