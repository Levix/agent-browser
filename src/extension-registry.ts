import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Page } from 'playwright-core';
import type { BrowserManager } from './browser.js';

export interface ExtensionContext {
  browser: BrowserManager;
  page: Page;
}

export type ExtensionCommandHandler = (
  ctx: ExtensionContext,
  args: Record<string, unknown>
) => Promise<unknown> | unknown;

interface ExtensionModule {
  commands?: Record<string, ExtensionCommandHandler>;
  default?: { commands?: Record<string, ExtensionCommandHandler> };
}

interface ExtensionManifest {
  name: string;
  entry?: string;
  commands?: Array<{ name: string }>;
  permissions?: string[];
}

interface ExtensionRuntime {
  manifest: ExtensionManifest;
  commands: Record<string, ExtensionCommandHandler>;
}

let cachedRegistry: Map<string, ExtensionRuntime> | null = null;
let cachedAllowedPermissions: Set<string> | null | undefined = undefined;

export async function executeExtensionCommand(
  extensionName: string,
  commandName: string,
  args: Record<string, unknown>,
  browser: BrowserManager
): Promise<unknown> {
  const registry = await loadRegistry();
  const runtime = registry.get(extensionName);
  if (!runtime) {
    throw new Error(`Unknown extension: ${extensionName}`);
  }

  enforcePermissions(runtime.manifest);

  if (
    runtime.manifest.commands &&
    !runtime.manifest.commands.some((cmd) => cmd.name === commandName)
  ) {
    throw new Error(`Unknown extension command: ${commandName}`);
  }

  const handler = runtime.commands[commandName];
  if (!handler) {
    throw new Error(`Missing handler for command: ${commandName}`);
  }

  const context: ExtensionContext = {
    browser,
    page: browser.getPage(),
  };
  return await handler(context, args ?? {});
}

async function loadRegistry(): Promise<Map<string, ExtensionRuntime>> {
  if (cachedRegistry) {
    return cachedRegistry;
  }

  const registry = new Map<string, ExtensionRuntime>();
  for (const root of discoverExtensionRoots()) {
    await loadExtensionsFromRoot(root, registry);
  }
  await loadExtensionsFromNodeModules(path.join(process.cwd(), 'node_modules'), registry);
  cachedRegistry = registry;
  return registry;
}

function enforcePermissions(manifest: ExtensionManifest) {
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

function discoverExtensionRoots(): string[] {
  const roots: string[] = [];
  const override = process.env.AGENT_BROWSER_PLUGINS_DIR;
  if (override && override.length > 0) {
    roots.push(override);
  }

  const legacy = process.env.AGENT_BROWSER_EXTENSIONS_DIR;
  if (legacy && legacy.length > 0) {
    roots.push(legacy);
  }

  roots.push(path.join(process.cwd(), '.agent-browser', 'plugins'));
  roots.push(path.join(process.cwd(), '.agent-browser', 'extensions'));

  const configDir =
    process.env.APPDATA ||
    process.env.XDG_CONFIG_HOME ||
    (os.homedir() ? path.join(os.homedir(), '.config') : '');
  if (configDir) {
    roots.push(path.join(configDir, 'agent-browser', 'plugins'));
    roots.push(path.join(configDir, 'agent-browser', 'extensions'));
  }

  return roots;
}

async function loadExtensionsFromRoot(root: string, registry: Map<string, ExtensionRuntime>) {
  if (!fs.existsSync(root)) {
    return;
  }

  const rootManifest = path.join(root, 'extension.json');
  if (fs.existsSync(rootManifest)) {
    const runtime = await loadExtension(rootManifest);
    if (runtime) {
      registry.set(runtime.manifest.name, runtime);
    }
  }

  const rootNodeModules = path.join(root, 'node_modules');
  await loadExtensionsFromNodeModules(rootNodeModules, registry);

  const entries = fs.readdirSync(root, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const manifestPath = path.join(root, entry.name, 'extension.json');
    if (!fs.existsSync(manifestPath)) continue;
    const runtime = await loadExtension(manifestPath);
    if (runtime) {
      registry.set(runtime.manifest.name, runtime);
    }
  }
}

async function loadExtensionsFromNodeModules(
  root: string,
  registry: Map<string, ExtensionRuntime>
) {
  if (!fs.existsSync(root)) {
    return;
  }

  const entries = fs.readdirSync(root, { withFileTypes: true });
  for (const entry of entries) {
    const name = entry.name;
    const entryPath = path.join(root, name);
    if (entry.isDirectory() && name.startsWith('@')) {
      const scopedEntries = fs.readdirSync(entryPath, { withFileTypes: true });
      for (const scopedEntry of scopedEntries) {
        if (!scopedEntry.isDirectory()) continue;
        const pkgName = `${name}/${scopedEntry.name}`;
        if (!isPluginPackageName(pkgName)) continue;
        const manifestPath = path.join(entryPath, scopedEntry.name, 'extension.json');
        if (!fs.existsSync(manifestPath)) continue;
        const runtime = await loadExtension(manifestPath);
        if (runtime) {
          registry.set(runtime.manifest.name, runtime);
        }
      }
      continue;
    }

    if (entry.isDirectory() && isPluginPackageName(name)) {
      const manifestPath = path.join(entryPath, 'extension.json');
      if (!fs.existsSync(manifestPath)) continue;
      const runtime = await loadExtension(manifestPath);
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
  if (name.startsWith('@')) {
    const slashIndex = name.indexOf('/');
    if (slashIndex === -1) return null;
    const rest = name.slice(slashIndex + 1);
    const atIndex = rest.lastIndexOf('@');
    if (atIndex === -1) return name;
    return `${name.slice(0, slashIndex + 1)}${rest.slice(0, atIndex)}`;
  }
  const atIndex = name.lastIndexOf('@');
  if (atIndex === -1) return name;
  return name.slice(0, atIndex);
}

async function loadExtension(manifestPath: string): Promise<ExtensionRuntime | null> {
  const raw = fs.readFileSync(manifestPath, 'utf8');
  let manifest: ExtensionManifest;
  try {
    manifest = JSON.parse(raw) as ExtensionManifest;
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

  const mod = (await import(pathToFileURL(entryPath).href)) as ExtensionModule;
  const commands = mod.commands ?? mod.default?.commands ?? {};

  if (!commands || Object.keys(commands).length === 0) {
    return null;
  }

  return { manifest, commands };
}
