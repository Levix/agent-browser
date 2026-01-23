import { describe, it, expect } from 'vitest';
import { ActionExecutor } from '../src/actions/executor.js';
import { MockBrowserAdapter } from './mocks/browser.js';
import type { ActionDefinition } from '../src/actions/types.js';

describe('Simple Test', () => {
  it('should execute wait action quickly', async () => {
    const mockBrowser = new MockBrowserAdapter();
    const mockPage = mockBrowser.createMockPage();

    const executor = new ActionExecutor({
      debugMode: true,
      stepTimeout: 1000,
      actionTimeout: 5000,
    });
    executor.setPage(mockPage);
    executor.setRegistry({
      namespaces: new Map(),
      index: new Map(),
    });

    const action: ActionDefinition = {
      name: 'test_login_with_selectors',
      namespace: 'test',
      fullName: 'test:test_login_with_selectors',
      description: 'Test login action with selectors',
      params: {
        username: {
          type: 'string',
          required: true,
          description: 'Username',
        },
        password: {
          type: 'string',
          required: true,
          description: 'Password',
        },
      },
      selectors: {
        username_input: '#username',
        password_input: '#password',
        submit_button: '#submit',
      },
      steps: [
        {
          action: 'fill',
          args: { selector: '${selectors.username_input}', value: '${params.username}' },
        },
        {
          action: 'fill',
          args: { selector: '${selectors.password_input}', value: '${params.password}' },
        },
        {
          action: 'click',
          args: { selector: '${selectors.submit_button}' },
        },
        {
          action: 'wait',
          args: { state: 'networkidle' },
        },
      ],
      sourcePath: 'test',
    };

    console.log('[TEST] Starting execution...');
    const result = await executor.execute(action, {
      username: 'testuser',
      password: 'testpass',
    });
    console.log('[TEST] Execution complete:', result);

    expect(result.success).toBe(true);
  }, 10000); // 10 second timeout for this test
});
