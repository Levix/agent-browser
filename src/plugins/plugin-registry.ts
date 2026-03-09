import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { BrowserManager } from '../browser.js';
import type { PluginCommandHandler, PluginContext, PluginModule } from './plugin-api.js';

interface PluginManifest {
  name: string;
  entry?: string;
  commands?: Array<{ name: string }>;
  permissions?: string[];
}

interface PluginRuntime {
  manifest: PluginManifest;
  commands: Record<string, PluginCommandHandler>;
}

let cachedRegistry: Map<string, PluginRuntime> | null = null;
let cachedAllowedPermissions: Set<string> | null | undefined = undefined;

export async function executePluginCommand(
  pluginName: string,
  commandName: string,
  args: Record<string, unknown>,
  browser: BrowserManager
): Promise<unknown> {
  const registry = await loadRegistry();
  const runtime = registry.get(pluginName);
  if (!runtime) {
    throw new Error(`Unknown plugin: ${pluginName}`);
  }

  enforcePermissions(runtime.manifest);

  if (
    runtime.manifest.commands &&
    !runtime.manifest.commands.some((cmd) => cmd.name === commandName)
  ) {
    throw new Error(`Unknown plugin command: ${commandName}`);
  }

  const handler = runtime.commands[commandName];
  if (!handler) {
    throw new Error(`Missing handler for command: ${commandName}`);
  }

  const context: PluginContext = {
    browser,
    page: browser.getPage(),
  };
  return await handler(context, args ?? {});
}

async function loadRegistry(): Promise<Map<string, PluginRuntime>> {
  if (cachedRegistry) {
    return cachedRegistry;
  }

  const registry = new Map<string, PluginRuntime>();
  for (const root of discoverPluginRoots()) {
    await loadPluginsFromRoot(root, registry);
  }
  await loadPluginsFromNodeModules(path.join(process.cwd(), 'node_modules'), registry);
  cachedRegistry = registry;
  return registry;
}

function enforcePermissions(manifest: PluginManifest) {
  const allowed = getAllowedPermissions();
  if (allowed === null) {
    return;
  }

  const requested = manifest.permissions ?? [];
  for (const perm of requested) {
    if (!allowed.has(perm)) {
      throw new Error(`Plugin permission denied: ${perm}`);
    }
  }
}

function getAllowedPermissions(): Set<string> | null {
  if (cachedAllowedPermissions !== undefined) {
    return cachedAllowedPermissions;
  }

  const fromEnv = process.env.AGENT_BROWSER_PLUGIN_PERMS;
  if (fromEnv && fromEnv.trim().length > 0) {
    cachedAllowedPermissions = new Set(parsePermList(fromEnv));
    return cachedAllowedPermissions;
  }

  const config = loadPermissionsConfig();
  if (config) {
    cachedAllowedPermissions = new Set(config);
    return cachedAllowedPermissions;
  }

  cachedAllowedPermissions = null;
  return cachedAllowedPermissions;
}

function parsePermList(value: string): string[] {
  return value
    .split(',')
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
}

function loadPermissionsConfig(): string[] | null {
  const configPaths = [path.join(process.cwd(), '.agent-browser', 'plugins.json')];

  const configDir =
    process.env.APPDATA ||
    process.env.XDG_CONFIG_HOME ||
    (os.homedir() ? path.join(os.homedir(), '.config') : '');
  if (configDir) {
    configPaths.push(path.join(configDir, 'agent-browser', 'plugins.json'));
  }

  for (const configPath of configPaths) {
    if (!fs.existsSync(configPath)) {
      continue;
    }
    try {
      const raw = fs.readFileSync(configPath, 'utf8');
      const parsed = JSON.parse(raw) as { allow?: string[] };
      if (Array.isArray(parsed.allow)) {
        return parsed.allow;
      }
    } catch {
      return null;
    }
  }

  return null;
}

function discoverPluginRoots(): string[] {
  const roots: string[] = [];
  // User override for plugin discovery root.
  const override = process.env.AGENT_BROWSER_PLUGINS_DIR;
  if (override && override.length > 0) {
    roots.push(override);
  }

  roots.push(path.join(process.cwd(), '.agent-browser', 'plugins'));

  const configDir =
    process.env.APPDATA ||
    process.env.XDG_CONFIG_HOME ||
    (os.homedir() ? path.join(os.homedir(), '.config') : '');
  if (configDir) {
    roots.push(path.join(configDir, 'agent-browser', 'plugins'));
  }

  return roots;
}

async function loadPluginsFromRoot(root: string, registry: Map<string, PluginRuntime>) {
  if (!fs.existsSync(root)) {
    return;
  }

  const rootManifest = path.join(root, 'plugin.json');
  if (fs.existsSync(rootManifest)) {
    const runtime = await loadPlugin(rootManifest);
    if (runtime) {
      registry.set(runtime.manifest.name, runtime);
    }
  }

  const rootNodeModules = path.join(root, 'node_modules');
  await loadPluginsFromNodeModules(rootNodeModules, registry);

  const entries = fs.readdirSync(root, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const manifestPath = path.join(root, entry.name, 'plugin.json');
    if (!fs.existsSync(manifestPath)) continue;
    const runtime = await loadPlugin(manifestPath);
    if (runtime) {
      registry.set(runtime.manifest.name, runtime);
    }
  }
}

async function loadPluginsFromNodeModules(root: string, registry: Map<string, PluginRuntime>) {
  if (!fs.existsSync(root)) {
    return;
  }

  const entries = fs.readdirSync(root, { withFileTypes: true });
  for (const entry of entries) {
    const name = entry.name;
    const entryPath = path.join(root, name);
    if (entry.isDirectory() && isPluginPackageName(name)) {
      const manifestPath = path.join(entryPath, 'plugin.json');
      if (!fs.existsSync(manifestPath)) continue;
      const runtime = await loadPlugin(manifestPath);
      if (runtime) {
        registry.set(runtime.manifest.name, runtime);
      }
    }
  }
}

function isPluginPackageName(name: string): boolean {
  const base = stripPackageVersion(name);
  if (!base) return false;
  if (base.startsWith('@')) {
    const parts = base.split('/');
    if (parts.length !== 2) return false;
    return parts[1].startsWith('agent-browser-plugin-');
  }
  return base.startsWith('agent-browser-plugin-');
}

function stripPackageVersion(name: string): string | null {
  if (name.startsWith('@') || name.length === 0) {
    return null;
  }
  const atIndex = name.lastIndexOf('@');
  if (atIndex === -1) return name;
  return name.slice(0, atIndex);
}

async function loadPlugin(manifestPath: string): Promise<PluginRuntime | null> {
  const raw = fs.readFileSync(manifestPath, 'utf8');
  let manifest: PluginManifest;
  try {
    manifest = JSON.parse(raw) as PluginManifest;
  } catch {
    return null;
  }
  if (!manifest.name) {
    return null;
  }

  const baseDir = path.dirname(manifestPath);
  const entry = manifest.entry ?? './index.js';
  const entryPath = path.resolve(baseDir, entry);
  if (!fs.existsSync(entryPath)) {
    return null;
  }

  const mod = (await import(pathToFileURL(entryPath).href)) as PluginModule;
  const commands = mod.commands ?? mod.default?.commands ?? {};

  if (!commands || Object.keys(commands).length === 0) {
    return null;
  }

  return { manifest, commands };
}
