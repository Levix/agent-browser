import type { Page } from 'playwright-core';
import type { BrowserManager } from '../browser.js';

export interface PluginContext {
  browser: BrowserManager;
  page: Page;
}

export type PluginArgs = Record<string, unknown>;

export type PluginCommandHandler<Args extends PluginArgs = PluginArgs, Result = unknown> = (
  ctx: PluginContext,
  args: Args
) => Promise<Result> | Result;

export interface PluginModule {
  commands?: Record<string, PluginCommandHandler>;
  default?: {
    commands?: Record<string, PluginCommandHandler>;
  };
}

/**
 * Stable protocol helpers exported for third-party plugins.
 * New plugins should return data directly (or throw on failure). These helpers
 * are retained for backward compatibility with older plugin implementations.
 */
export { successResponse, errorResponse } from '../protocol.js';

export type { BrowserManager } from '../browser.js';
export type { Response } from '../types.js';
