// Builds the zip the Chrome Web Store accepts: `npm run package`.
//
// The store takes the extension and nothing else. This repository also holds
// the backend, the tests, the screenshot tooling and the docs site, none of
// which belong in a package a user installs, and one of which holds the server
// that talks to the API key. Listing what goes in, rather than what stays out,
// means a new directory is excluded by default instead of shipping by accident.
import { rm, mkdir, cp, readFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join } from "node:path";

const run = promisify(execFile);
const ROOT = new URL("..", import.meta.url).pathname;
const BUILD = join(ROOT, "build");

// Every file the extension needs at runtime. web_accessible_resources and the
// content script are checked against this below, so the list cannot fall behind
// the manifest without the build failing.
const SHIP = [
  "manifest.json",
  "background.js",
  "listener.js",
  "content.js",
  "ui.css",
  // Named one by one rather than as a directory. icon-512 is for the store
  // listing, not the extension, and shipping the folder whole put 215KB of it
  // into a 326KB package for nothing.
  "icons/icon-16.png",
  "icons/icon-32.png",
  "icons/icon-48.png",
  "icons/icon-128.png",
];

const manifest = JSON.parse(await readFile(join(ROOT, "manifest.json"), "utf8"));

// A file the manifest names but the package omits is a broken install that
// looks fine until someone opens the panel, so check before zipping rather
// than after a rejection.
const named = [
  ...(manifest.content_scripts || []).flatMap((s) => s.js || []),
  ...(manifest.web_accessible_resources || []).flatMap((r) => r.resources || []),
  manifest.background?.service_worker,
  ...Object.values(manifest.icons || {}),
  ...Object.values(manifest.action?.default_icon || {}),
].filter(Boolean);

const missing = named.filter((f) => !SHIP.some((s) => f === s || f.startsWith(`${s}/`)));
if (missing.length) {
  console.error(`manifest names files the package does not ship: ${missing.join(", ")}`);
  process.exit(1);
}

await rm(BUILD, { recursive: true, force: true });
await mkdir(BUILD, { recursive: true });
for (const item of SHIP) {
  const dest = join(BUILD, item);
  if (item.includes("/")) await mkdir(join(dest, ".."), { recursive: true });
  await cp(join(ROOT, item), dest, { recursive: true });
}

const zip = join(ROOT, `eternal-summary-${manifest.version}.zip`);
await rm(zip, { force: true });
// -r recurse, -q quiet, -X drop the resource forks and finder metadata macOS
// would otherwise bury in the archive.
await run("zip", ["-rqX", zip, ...SHIP], { cwd: BUILD });
await rm(BUILD, { recursive: true, force: true });

const { stdout } = await run("unzip", ["-l", zip]);
console.log(stdout.trim());
console.log(`\nready to upload: ${zip}`);
