#!/usr/bin/env node

// installer/src/install.ts
import { copyFile, readFile, writeFile as writeFile2 } from "node:fs/promises";
import { homedir as homedir2 } from "node:os";

// installer/src/fetch-plugins.ts
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

// plugins/_loader/src/shared/version.ts
function parseVersion(v) {
  const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(v);
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

// plugins/_loader/src/shared/dist.ts
var DIST_OWNER = "namdseasygoingvn";
var DIST_REPO = "ezg-figma-tools-dist";
var DIST_BRANCH = "main";
var RAW_ORIGIN = "https://raw.githubusercontent.com";
var CHECK_INTERVAL_MS = 60 * 60 * 1e3;
var INSTALL_DIR_PARTS = [".ezg", "figma-tools"];
var DIST_FILES = {
  index: "index.json",
  version: "version.json",
  installer: "install.mjs"
};
var PLUGIN_FILES = {
  manifest: "manifest.json",
  code: "code.js",
  ui: "ui.html",
  bundle: "bundle.json"
};
function distUrl(path) {
  return `${RAW_ORIGIN}/${DIST_OWNER}/${DIST_REPO}/${DIST_BRANCH}/${path}`;
}
function pluginPath(plugin, file) {
  return `plugins/${plugin}/${file}`;
}
var DIR_PATTERN = /^[a-z0-9-]+$/;
function asRecord(raw) {
  return typeof raw === "object" && raw !== null && !Array.isArray(raw) ? raw : null;
}
function validVersion(v) {
  return typeof v === "string" && parseVersion(v) !== null;
}
function parsePlugin(raw) {
  const r = asRecord(raw);
  if (!r) return null;
  const { dir, name, id } = r;
  if (typeof dir !== "string" || !DIR_PATTERN.test(dir)) return null;
  if (typeof name !== "string" || typeof id !== "string") return null;
  return { dir, name, id };
}
function parseIndex(raw) {
  const r = asRecord(raw);
  if (!r || !validVersion(r.version) || !Array.isArray(r.plugins)) return null;
  const plugins = [];
  for (const item of r.plugins) {
    const plugin = parsePlugin(item);
    if (!plugin) return null;
    plugins.push(plugin);
  }
  return { version: r.version, plugins };
}

// installer/src/fetch-plugins.ts
async function download(path) {
  const url = distUrl(path);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed (${res.status}): ${url}`);
  return res.text();
}
async function installPlugin(root, plugin) {
  const dir = join(root, plugin.dir);
  const tmp = `${dir}.tmp`;
  const files = [PLUGIN_FILES.manifest, PLUGIN_FILES.code, PLUGIN_FILES.ui];
  await rm(tmp, { recursive: true, force: true });
  await mkdir(tmp, { recursive: true });
  try {
    for (const file of files) {
      const text = await download(pluginPath(plugin.dir, file));
      await writeFile(join(tmp, file), text);
    }
    await rm(dir, { recursive: true, force: true });
    await rename(tmp, dir);
  } catch (error) {
    await rm(tmp, { recursive: true, force: true });
    throw error;
  }
  return {
    manifestPath: join(dir, PLUGIN_FILES.manifest),
    codePath: join(dir, PLUGIN_FILES.code),
    uiPath: join(dir, PLUGIN_FILES.ui),
    name: plugin.name,
    id: plugin.id
  };
}
async function fetchPlugins(home) {
  const index = parseIndex(JSON.parse(await download(DIST_FILES.index)));
  if (!index) throw new Error(`${DIST_FILES.index} has an unexpected format`);
  const root = join(home, ...INSTALL_DIR_PARTS);
  await mkdir(root, { recursive: true });
  const plugins = [];
  for (const plugin of index.plugins) {
    plugins.push(await installPlugin(root, plugin));
  }
  return { version: index.version, plugins };
}

// installer/src/figma-app.ts
import { execFileSync, spawn } from "node:child_process";
import { homedir } from "node:os";
import { join as join2 } from "node:path";
var POLL_MS = 500;
function unsupported() {
  throw new Error("macOS and Windows only");
}
function run(file, args) {
  try {
    return execFileSync(file, args, { encoding: "utf8", stdio: "pipe" });
  } catch {
    return "";
  }
}
function settingsPath() {
  if (process.platform === "darwin") {
    return join2(
      homedir(),
      "Library",
      "Application Support",
      "Figma",
      "settings.json"
    );
  }
  if (process.platform === "win32") {
    const appData = process.env.APPDATA ?? join2(homedir(), "AppData", "Roaming");
    return join2(appData, "Figma", "settings.json");
  }
  return unsupported();
}
function isFigmaRunning() {
  if (process.platform === "darwin") {
    return run("pgrep", ["-x", "Figma"]).trim() !== "";
  }
  if (process.platform === "win32") {
    const out = run("tasklist", ["/FI", "IMAGENAME eq Figma.exe"]);
    return out.toLowerCase().includes("figma.exe");
  }
  return unsupported();
}
function requestQuit(force) {
  if (process.platform === "darwin") {
    run("osascript", ["-e", 'quit app "Figma"']);
  } else if (process.platform === "win32") {
    run("taskkill", ["/IM", "Figma.exe", ...force ? ["/F"] : []]);
  } else {
    unsupported();
  }
}
var sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function waitForExit(ms) {
  for (let waited = 0; waited < ms; waited += POLL_MS) {
    if (!isFigmaRunning()) return true;
    await sleep(POLL_MS);
  }
  return !isFigmaRunning();
}
async function quitFigma(timeoutMs = 2e4) {
  if (!isFigmaRunning()) return;
  requestQuit(false);
  if (await waitForExit(timeoutMs)) return;
  if (process.platform === "win32") {
    requestQuit(true);
    if (await waitForExit(5e3)) return;
  }
  throw new Error("Figma is still running. Quit it and run again");
}
function openFigma() {
  if (process.platform === "darwin") {
    spawn("open", ["-a", "Figma"], { detached: true, stdio: "ignore" }).unref();
  } else if (process.platform === "win32") {
    const localAppData = process.env.LOCALAPPDATA ?? join2(homedir(), "AppData", "Local");
    const exe = join2(localAppData, "Figma", "Figma.exe");
    spawn(exe, [], { detached: true, stdio: "ignore" }).unref();
  } else {
    unsupported();
  }
}

// installer/src/figma-settings.ts
var SettingsFormatError = class extends Error {
};
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function isEntry(value) {
  return isRecord(value) && typeof value.id === "number" && typeof value.manifestPath === "string";
}
function readEntries(settings) {
  if (!isRecord(settings)) {
    throw new SettingsFormatError("settings.json is not a JSON object");
  }
  const list = settings.localFileExtensions;
  if (list === void 0) return { root: settings, entries: [] };
  if (!Array.isArray(list) || !list.every(isEntry)) {
    throw new SettingsFormatError(
      "localFileExtensions has an unexpected format"
    );
  }
  return { root: settings, entries: list };
}
function isManifestEntry(entry) {
  return isRecord(entry.fileMetadata) && entry.fileMetadata.type === "manifest";
}
function missingPlugins(settings, plugins) {
  const { entries } = readEntries(settings);
  const registered = new Set(
    entries.filter(isManifestEntry).map((entry) => entry.manifestPath)
  );
  return plugins.filter((plugin) => !registered.has(plugin.manifestPath));
}
function entriesFor(plugin, firstId) {
  const [manifestId, codeId, uiId] = [firstId, firstId + 1, firstId + 2];
  return [
    {
      id: manifestId,
      manifestPath: plugin.manifestPath,
      lastKnownName: plugin.name,
      lastKnownPluginId: plugin.id,
      fileMetadata: {
        type: "manifest",
        codeFileId: codeId,
        uiFileIds: [uiId]
      },
      cachedContainsWidget: false
    },
    {
      id: codeId,
      manifestPath: plugin.codePath,
      fileMetadata: { type: "code", manifestFileId: manifestId }
    },
    {
      id: uiId,
      manifestPath: plugin.uiPath,
      fileMetadata: { type: "ui", manifestFileId: manifestId }
    }
  ];
}
function registerPlugins(settings, plugins) {
  const { root, entries } = readEntries(settings);
  const added = [];
  let nextId = Math.max(0, ...entries.map((entry) => entry.id)) + 1;
  for (const plugin of missingPlugins(settings, plugins)) {
    added.push(...entriesFor(plugin, nextId));
    nextId += 3;
  }
  return { ...root, localFileExtensions: [...entries, ...added] };
}

// installer/src/install.ts
async function readSettings(path) {
  let raw;
  try {
    raw = await readFile(path, "utf8");
  } catch {
    throw new Error(
      "Figma settings not found. Open Figma desktop once, then run again"
    );
  }
  try {
    return { raw, json: JSON.parse(raw) };
  } catch {
    throw new SettingsFormatError("settings.json is not valid JSON");
  }
}
function indentOf(raw) {
  return /^\{\r?\n([ \t]+)"/.exec(raw)?.[1] ?? 2;
}
async function main() {
  console.log("> Downloading EZG Figma plugins\u2026");
  const { version, plugins } = await fetchPlugins(homedir2());
  for (const plugin of plugins) console.log(`  ok ${plugin.name}`);
  console.log("> Registering in Figma\u2026");
  const path = settingsPath();
  const missing = missingPlugins((await readSettings(path)).json, plugins);
  if (missing.length === 0) {
    console.log(`  ok already registered (v${version})`);
    console.log("Done. Open Figma \u2192 Plugins \u2192 Development.");
    return;
  }
  if (isFigmaRunning()) await quitFigma();
  const { raw, json } = await readSettings(path);
  const next = registerPlugins(json, plugins);
  await copyFile(path, `${path}.ezg-bak`);
  await writeFile2(path, JSON.stringify(next, null, indentOf(raw)));
  openFigma();
  console.log(`  ok ${missing.length} plugin added (Figma restarted)`);
  console.log("Done. Open Figma \u2192 Plugins \u2192 Development.");
}
main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Error: ${message}`);
  process.exit(1);
});
