#!/usr/bin/env node
/**
 * Melora Linux build
 *
 * Usage:
 *   npm run build:linux
 *
 * Builds the portable AppImage (the Linux counterpart of the standalone .exe)
 * and drops it in releases/latest/, where `node scripts/release.mjs ...` picks
 * it up and attaches it to the GitHub Release alongside the .exe and .apk.
 *
 * Unlike the .exe and .apk, the AppImage is NOT committed: it carries its own
 * WebKitGTK and GStreamer and lands around 170 MB, well past GitHub's 100 MB
 * per-file limit. The download page links to the GitHub Release asset instead.
 *
 * Cargo artifacts go to src-tauri/target-linux/ instead of the shared target/,
 * so a Linux build never invalidates the Windows one on a dual-boot checkout.
 */

import { readFileSync, writeFileSync, readdirSync, copyFileSync, mkdirSync, chmodSync, statSync } from "fs";
import { execSync } from "child_process";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { platform } from "os";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DESKTOP_DIR = join(ROOT, "apps", "desktop");
const TAURI_CONF = join(DESKTOP_DIR, "src-tauri", "tauri.conf.json");
const TARGET_DIR = process.env.CARGO_TARGET_DIR || join(DESKTOP_DIR, "src-tauri", "target-linux");

if (platform() !== "linux") {
  console.error(`\nThis script builds the Linux bundle and has to run on Linux (found: ${platform()}).\n`);
  process.exit(1);
}

const version = JSON.parse(readFileSync(TAURI_CONF, "utf8")).version;
console.log(`\n🐧  Melora ${version} — Linux build\n`);

// Rust lives in ~/.cargo/bin, which a non-login shell may not have on PATH.
// NO_STRIP: linuxdeploy bundles an old binutils whose `strip` chokes on the
// `.relr.dyn` sections modern distro libraries ship ("unknown type [0x13]"),
// which fails the whole bundle. Skipping the strip pass costs a few MB.
const env = {
  ...process.env,
  CARGO_TARGET_DIR: TARGET_DIR,
  NO_STRIP: "true",
  PATH: `${join(process.env.HOME || "", ".cargo", "bin")}:${process.env.PATH}`,
};

console.log(`🔨  Building AppImage (this takes a while on a cold cargo cache)...`);
execSync("npx tauri build --bundles appimage", { cwd: DESKTOP_DIR, stdio: "inherit", env });

// Tauri names it Melora_{version}_amd64.AppImage; glob so a rename can't break us.
const bundleDir = join(TARGET_DIR, "release", "bundle", "appimage");
const built = readdirSync(bundleDir).filter((f) => f.endsWith(".AppImage"));
if (built.length !== 1) {
  console.error(`\nExpected exactly one .AppImage in ${bundleDir}, found: ${built.join(", ") || "none"}\n`);
  process.exit(1);
}
const appImage = join(bundleDir, built[0]);

const latestDir = join(ROOT, "releases", "latest");
mkdirSync(latestDir, { recursive: true });
const dest = join(latestDir, "Melora.AppImage");
copyFileSync(appImage, dest);
chmodSync(dest, 0o755);

// Marker so release.mjs (run from Windows) can tell whether the AppImage sitting
// in releases/latest/ was built from the version it is about to ship.
writeFileSync(
  join(latestDir, "linux.json"),
  JSON.stringify({ version, date: new Date().toISOString().slice(0, 10) }, null, 2) + "\n",
  "utf8",
);

const mb = (statSync(appImage).size / 1024 / 1024).toFixed(1);
console.log(`\n✓ Melora.AppImage (${mb} MB) → releases/latest/ (not committed)`);
console.log(`  Run it with: ./releases/latest/Melora.AppImage\n`);
