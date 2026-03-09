import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { BrowserManager } from '../browser.js';
import { executePluginCommand } from './plugin-registry.js';

describe('executePluginCommand', () => {
  const previousPluginsDir = process.env.AGENT_BROWSER_PLUGINS_DIR;

  beforeAll(() => {
    process.env.AGENT_BROWSER_PLUGINS_DIR = path.join(
      process.cwd(),
      '.agent-browser',
      'plugins',
      'agent-browser-plugin-example'
    );
  });

  afterAll(() => {
    if (previousPluginsDir === undefined) {
      delete process.env.AGENT_BROWSER_PLUGINS_DIR;
      return;
    }
    process.env.AGENT_BROWSER_PLUGINS_DIR = previousPluginsDir;
  });

  it('should execute local .agent-browser plugin command via plugin runtime', async () => {
    const browser = {
      getPage: () => ({
        locator: () => ({
          nth: () => ({
            innerText: async () => 'row-0',
          }),
        }),
      }),
    } as unknown as BrowserManager;

    const result = await executePluginCommand(
      'example',
      'table.getRow',
      { selector: '.table', index: 0 },
      browser
    );

    expect(result).toEqual({
      text: 'row-0',
    });
  });
});
