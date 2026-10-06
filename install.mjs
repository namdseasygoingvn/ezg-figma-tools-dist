#!/usr/bin/env node

// installer/src/install.ts
import { copyFile as copyFile2, readFile as readFile2, rm as rm4, writeFile as writeFile4 } from "node:fs/promises";
import { homedir as homedir3 } from "node:os";
import { dirname as dirname4, join as join7 } from "node:path";

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
var CHECK_INTERVAL_MS = 10 * 60 * 1e3;
var INSTALL_DIR_PARTS = [".ezg", "figma-tools"];
var BRIDGE_DIR = "_bridge";
var BRIDGE_MCP_NAME = "ezg-figma-bridge";
var BRIDGE_HUB_FLAG = "--hub-only";
var BRIDGE_HUB_LABEL = "vn.easygoing.ezg-figma-bridge";
var SKILL_DIR_PARTS = [".claude", "skills", "ezg-figma-bridge"];
var DIST_FILES = {
  index: "index.json",
  version: "version.json",
  installer: "install.mjs",
  bridgeServer: "bridge-server.mjs",
  bridgeSkill: "bridge-skill.md"
};
var PLUGIN_FILES = {
  manifest: "manifest.json",
  code: "code.js",
  ui: "ui.html",
  bundle: "bundle.json",
  desktopUi: "desktop-ui.html"
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

// installer/src/fetch-bridge.ts
import { mkdir as mkdir2, rename as rename2, rm as rm2, writeFile as writeFile2 } from "node:fs/promises";
import { dirname, join as join2 } from "node:path";

// installer/src/fetch-plugins.ts
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
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

// installer/src/fetch-bridge.ts
async function writeAtomic(target, text) {
  const tmp = `${target}.tmp`;
  await mkdir2(dirname(target), { recursive: true });
  try {
    await writeFile2(tmp, text);
    await rename2(tmp, target);
  } catch (error) {
    await rm2(tmp, { force: true });
    throw error;
  }
}
async function downloadText(name) {
  const text = await download(name);
  if (text.trim() === "") throw new Error(`${name} is empty`);
  return text;
}
async function fetchBridge(home) {
  const server = join2(
    home,
    ...INSTALL_DIR_PARTS,
    BRIDGE_DIR,
    DIST_FILES.bridgeServer
  );
  const skill = join2(home, ...SKILL_DIR_PARTS, "SKILL.md");
  const serverText = await downloadText(DIST_FILES.bridgeServer);
  const skillText = await downloadText(DIST_FILES.bridgeSkill);
  await writeAtomic(server, serverText);
  await writeAtomic(skill, skillText);
  return { server, skill };
}

// installer/src/hub-service.ts
import { spawnSync } from "node:child_process";
import { rm as rm3 } from "node:fs/promises";
import { join as join3 } from "node:path";

// installer/src/hub-files.ts
function hubProcessFilter(server) {
  const pattern = `*${server}*${BRIDGE_HUB_FLAG}*`.replace(/'/g, "''");
  return `Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'node.exe' -and $_.CommandLine -like '${pattern}' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }`;
}

// installer/src/hub-service.ts
async function removeMac(home) {
  spawnSync("launchctl", [
    "bootout",
    `gui/${process.getuid()}/${BRIDGE_HUB_LABEL}`
  ]);
  await rm3(join3(home, "Library", "LaunchAgents", `${BRIDGE_HUB_LABEL}.plist`), {
    force: true
  });
}
async function removeWindows(home) {
  const server = join3(
    home,
    ...INSTALL_DIR_PARTS,
    BRIDGE_DIR,
    DIST_FILES.bridgeServer
  );
  spawnSync(
    "powershell",
    ["-NoProfile", "-Command", hubProcessFilter(server)],
    { stdio: "ignore", timeout: 3e4 }
  );
  const appData = process.env.APPDATA;
  if (!appData) return;
  await rm3(
    join3(
      appData,
      "Microsoft",
      "Windows",
      "Start Menu",
      "Programs",
      "Startup",
      `${BRIDGE_HUB_LABEL}.vbs`
    ),
    { force: true }
  );
}
async function removeHub(home) {
  if (process.platform === "darwin") await removeMac(home);
  else if (process.platform === "win32") await removeWindows(home);
}

// installer/src/figma-app.ts
import { execFileSync, spawn } from "node:child_process";
import { homedir } from "node:os";
import { join as join4 } from "node:path";
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
    return join4(
      homedir(),
      "Library",
      "Application Support",
      "Figma",
      "settings.json"
    );
  }
  if (process.platform === "win32") {
    const appData = process.env.APPDATA ?? join4(homedir(), "AppData", "Roaming");
    return join4(appData, "Figma", "settings.json");
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
    const localAppData = process.env.LOCALAPPDATA ?? join4(homedir(), "AppData", "Local");
    const exe = join4(localAppData, "Figma", "Figma.exe");
    spawn(exe, [], { detached: true, stdio: "ignore" }).unref();
  } else {
    unsupported();
  }
}

// installer/src/figma-settings.ts
import { dirname as dirname3 } from "node:path";

// installer/src/stale-dirs.ts
import { dirname as dirname2, relative, sep } from "node:path";
function isPluginDirIn(dir, root) {
  const rel = relative(root, dir);
  return rel !== "" && !rel.startsWith("..") && !rel.includes(sep);
}
function staleDirs(manifestPaths, root) {
  return manifestPaths.map(dirname2).filter((dir) => isPluginDirIn(dir, root));
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
function movedManifests(entries, plugins, installRoot) {
  const paths = new Set(plugins.map((plugin) => plugin.manifestPath));
  const ids = new Set(plugins.map((plugin) => plugin.id));
  return entries.filter(
    (entry) => isManifestEntry(entry) && ids.has(String(entry.lastKnownPluginId)) && !paths.has(entry.manifestPath) && isPluginDirIn(dirname3(entry.manifestPath), installRoot)
  );
}
function movedManifestPaths(settings, plugins, installRoot) {
  const { entries } = readEntries(settings);
  return movedManifests(entries, plugins, installRoot).map(
    (entry) => entry.manifestPath
  );
}
function isPartOf(entry, manifest) {
  const meta = isRecord(manifest.fileMetadata) ? manifest.fileMetadata : {};
  const uiIds = Array.isArray(meta.uiFileIds) ? meta.uiFileIds : [];
  return entry.id === manifest.id || entry.id === meta.codeFileId || uiIds.includes(entry.id) || isRecord(entry.fileMetadata) && entry.fileMetadata.manifestFileId === manifest.id;
}
function registerPlugins(settings, plugins, installRoot) {
  const { root, entries: all } = readEntries(settings);
  const moved = movedManifests(all, plugins, installRoot);
  const entries = all.filter((entry) => !moved.some((m) => isPartOf(entry, m)));
  const added = [];
  let nextId = Math.max(0, ...all.map((entry) => entry.id)) + 1;
  for (const plugin of missingPlugins(settings, plugins)) {
    added.push(...entriesFor(plugin, nextId));
    nextId += 3;
  }
  return { ...root, localFileExtensions: [...entries, ...added] };
}

// installer/src/install-plan.ts
function planInstall(settings, plugins, installRoot) {
  const missing = missingPlugins(settings, plugins);
  const moved = movedManifestPaths(settings, plugins, installRoot);
  return {
    missing,
    stale: staleDirs(moved, installRoot),
    rewrite: missing.length > 0 || moved.length > 0
  };
}

// installer/src/node-info.ts
import { mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join as join5 } from "node:path";
var NODE_INFO_FILE = "node.json";
function writeNodeInfo(bridgeDir) {
  const file = join5(bridgeDir, NODE_INFO_FILE);
  const temp = `${file}.tmp`;
  const info = { path: process.execPath, version: process.version };
  try {
    mkdirSync(bridgeDir, { recursive: true });
    writeFileSync(temp, JSON.stringify(info));
    renameSync(temp, file);
  } catch (error) {
    rmSync(temp, { force: true });
    throw error;
  }
}

// installer/src/register-desktop.ts
import {
  copyFile,
  readFile,
  readdir,
  rename as rename3,
  writeFile as writeFile3
} from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir as homedir2 } from "node:os";
import { join as join6 } from "node:path";

// installer/src/desktop-config.ts
var DesktopConfigError = class extends Error {
};
var isObject = (v) => typeof v === "object" && v !== null && !Array.isArray(v);
function withBridgeServer(config, spec) {
  if (!isObject(config)) {
    throw new DesktopConfigError("claude_desktop_config.json is not an object");
  }
  const servers = config.mcpServers ?? {};
  if (!isObject(servers)) {
    throw new DesktopConfigError("mcpServers is not an object");
  }
  return {
    ...config,
    mcpServers: {
      ...servers,
      [spec.name]: { command: spec.node, args: [spec.server] }
    }
  };
}

// installer/src/register-desktop.ts
var CONFIG = "claude_desktop_config.json";
async function windowsDirs() {
  const home = homedir2();
  const appData = process.env.APPDATA ?? join6(home, "AppData", "Roaming");
  const local = process.env.LOCALAPPDATA ?? join6(home, "AppData", "Local");
  const dirs = [join6(appData, "Claude")];
  const packages = join6(local, "Packages");
  const names = await readdir(packages).catch(() => []);
  for (const name of names.filter((n) => n.startsWith("Claude_")))
    dirs.push(join6(packages, name, "LocalCache", "Roaming", "Claude"));
  return dirs;
}
async function configDirs() {
  const dirs = process.platform === "win32" ? await windowsDirs() : [join6(homedir2(), "Library", "Application Support", "Claude")];
  return dirs.filter((d) => existsSync(d));
}
async function readConfig(path) {
  let raw;
  try {
    raw = await readFile(path, "utf8");
  } catch {
    return {};
  }
  if (raw.trim() === "") return {};
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error(`${path} is not valid JSON; fix it, then re-run`);
  }
}
async function register(dir, server) {
  const path = join6(dir, CONFIG);
  const next = withBridgeServer(await readConfig(path), {
    name: BRIDGE_MCP_NAME,
    node: process.execPath,
    server
  });
  if (existsSync(path)) await copyFile(path, `${path}.ezg-bak`);
  await writeFile3(`${path}.tmp`, JSON.stringify(next, null, 2));
  await rename3(`${path}.tmp`, path);
}
async function registerDesktop(server) {
  const dirs = await configDirs();
  if (dirs.length === 0) {
    console.log("  skip Claude Desktop not found");
    return;
  }
  for (const dir of dirs) {
    try {
      await register(dir, server);
      console.log(`  ok Claude Desktop: registered ezg-figma-bridge (${dir})`);
    } catch (error) {
      const why = error instanceof Error ? error.message : String(error);
      console.log(`  warn Claude Desktop: could not register (${why})`);
    }
  }
  console.log(
    "  Quit Claude Desktop fully and open it again to load the bridge."
  );
}

// installer/src/register-mcp.ts
import { spawnSync as spawnSync2 } from "node:child_process";

// installer/src/mcp-args.ts
var NAME = /^[A-Za-z0-9_-]+$/;
var BARE = /^[A-Za-z0-9_\-.:\\/=]+$/;
function assertName(name) {
  if (!NAME.test(name)) throw new Error(`bad mcp server name: ${name}`);
}
function removeArgs(name) {
  assertName(name);
  return ["mcp", "remove", name, "-s", "user"];
}
function addArgs(spec) {
  assertName(spec.name);
  return [
    "mcp",
    "add",
    "--scope",
    "user",
    spec.name,
    "--",
    spec.node,
    spec.server
  ];
}
function quoteForShell(arg, platform) {
  if (platform !== "win32") return arg;
  if (arg === "") return '""';
  if (BARE.test(arg)) return arg;
  const escaped = arg.replace(/(\\*)"/g, (_, slashes) => `${slashes}${slashes}\\"`).replace(/(\\+)$/, "$1$1");
  return `"${escaped}"`;
}

// installer/src/register-mcp.ts
var WIN = process.platform === "win32";
function run2(cmd, args) {
  return spawnSync2(
    cmd,
    args.map((a) => quoteForShell(a, process.platform)),
    { shell: WIN, encoding: "utf8", stdio: "pipe", timeout: 3e4 }
  );
}
function hasClaude() {
  if (WIN) return run2("where", ["claude"]).status === 0;
  return spawnSync2("sh", ["-c", "command -v claude"], { stdio: "ignore" }).status === 0;
}
function firstLine(text) {
  return (text ?? "").split(/\r?\n/).find((l) => l.trim() !== "") ?? "";
}
function reason(r) {
  const text = firstLine(r.stderr) || firstLine(r.stdout) || r.error?.message || `exit ${r.status}`;
  return text.trim().slice(0, 120);
}
function fail(why) {
  console.log(`Claude Code: could not register ezg-figma-bridge (${why})`);
  return "failed";
}
function registerMcp(server) {
  try {
    if (!hasClaude()) {
      console.log(
        "Claude Code not found. Install it, then re-run this installer to register ezg-figma-bridge."
      );
      return "no-claude";
    }
    run2("claude", removeArgs(BRIDGE_MCP_NAME));
    const add = run2(
      "claude",
      addArgs({ name: BRIDGE_MCP_NAME, node: process.execPath, server })
    );
    if (add.status !== 0) return fail(reason(add));
    const get = run2("claude", ["mcp", "get", BRIDGE_MCP_NAME]);
    if (get.status !== 0) {
      return fail("added but claude mcp get failed: " + reason(get));
    }
    console.log("Claude Code: registered ezg-figma-bridge");
    return "registered";
  } catch (e) {
    return fail(String(e));
  }
}

// installer/src/install.ts
async function readSettings(path) {
  let raw;
  try {
    raw = await readFile2(path, "utf8");
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
var messageOf = (error) => error instanceof Error ? error.message : String(error);
async function installBridge(home) {
  let server;
  try {
    server = (await fetchBridge(home)).server;
  } catch (error) {
    console.log(`  warn Claude bridge failed: ${messageOf(error)}`);
    return;
  }
  registerMcp(server);
  await registerDesktop(server);
  try {
    await removeHub(home);
    console.log("  ok no login hub left");
  } catch (error) {
    console.log(`  warn login hub removal failed: ${messageOf(error)}`);
  }
  try {
    writeNodeInfo(dirname4(server));
    console.log("  ok node path saved for EZG Desktop");
  } catch (error) {
    console.log(`  warn node path not saved: ${messageOf(error)}`);
  }
}
async function main() {
  console.log("> Downloading EZG Figma plugins\u2026");
  const { version, plugins } = await fetchPlugins(homedir3());
  for (const plugin of plugins) console.log(`  ok ${plugin.name}`);
  console.log("> Setting up the Claude bridge\u2026");
  await installBridge(homedir3());
  console.log("> Registering in Figma\u2026");
  const path = settingsPath();
  const installRoot = join7(homedir3(), ...INSTALL_DIR_PARTS);
  const plan = planInstall(
    (await readSettings(path)).json,
    plugins,
    installRoot
  );
  if (!plan.rewrite) {
    for (const dir of plan.stale)
      await rm4(dir, { recursive: true, force: true });
    console.log(`  ok already registered (v${version})`);
    console.log("Done. Open Figma \u2192 Plugins \u2192 Development.");
    return;
  }
  if (isFigmaRunning()) await quitFigma();
  const { raw, json } = await readSettings(path);
  const next = registerPlugins(json, plugins, installRoot);
  await copyFile2(path, `${path}.ezg-bak`);
  await writeFile4(path, JSON.stringify(next, null, indentOf(raw)));
  for (const dir of plan.stale) await rm4(dir, { recursive: true, force: true });
  openFigma();
  console.log(`  ok ${plan.missing.length} plugin added (Figma restarted)`);
  console.log("Done. Open Figma \u2192 Plugins \u2192 Development.");
}
main().catch((error) => {
  console.error(`Error: ${messageOf(error)}`);
  process.exit(1);
});
