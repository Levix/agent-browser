/**
 * Mock Browser Adapter for testing
 * 
 * Simulates browser interactions without a real browser instance.
 * Records all actions for verification in tests.
 */

import type { Page, Locator, ElementHandle } from 'playwright-core';

/**
 * Call record for tracking method invocations
 */
export interface CallRecord {
  method: string;
  args: any[];
  timestamp: number;
  result?: any;
  error?: Error;
}

/**
 * Configuration for mock responses
 */
export interface MockConfig {
  /** Mock evaluation results for expressions */
  evaluateResults?: Map<string, any>;
  /** Mock element visibility state */
  visibility?: Map<string, boolean>;
  /** Mock element count */
  elementCount?: Map<string, number>;
  /** Simulate failures for specific selectors */
  failures?: Map<string, Error>;
  /** Simulate delays (ms) for specific methods */
  delays?: Map<string, number>;
}

/**
 * Mock Browser Adapter
 */
export class MockBrowserAdapter {
  private callHistory: CallRecord[] = [];
  private config: MockConfig;
  private pageUrl = 'https://example.com';
  private pageTitle = 'Test Page';

  constructor(config: MockConfig = {}) {
    this.config = {
      evaluateResults: new Map(),
      visibility: new Map(),
      elementCount: new Map(),
      failures: new Map(),
      delays: new Map(),
      ...config,
    };
  }

  /**
   * Get all recorded calls
   */
  getCalls(): CallRecord[] {
    return [...this.callHistory];
  }

  /**
   * Get calls for a specific method
   */
  getCallsFor(method: string): CallRecord[] {
    return this.callHistory.filter((call) => call.method === method);
  }

  /**
   * Clear call history
   */
  clearHistory(): void {
    this.callHistory = [];
  }

  /**
   * Record a method call
   */
  private recordCall(method: string, args: any[], result?: any, error?: Error): void {
    this.callHistory.push({
      method,
      args: JSON.parse(JSON.stringify(args)), // Deep clone
      timestamp: Date.now(),
      result,
      error,
    });
  }

  /**
   * Simulate delay if configured
   */
  private async simulateDelay(method: string): Promise<void> {
    const delay = this.config.delays?.get(method);
    if (delay) {
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  /**
   * Check for configured failure
   */
  private checkFailure(selector: string): void {
    const error = this.config.failures?.get(selector);
    if (error) {
      throw error;
    }
  }

  /**
   * Create a mock page
   */
  createMockPage(): Page {
    const self = this;

    const mockLocator: Partial<Locator> = {
      async click(options?: any) {
        await self.simulateDelay('click');
        self.recordCall('locator.click', [options]);
        return undefined;
      },

      async fill(value: string, options?: any) {
        await self.simulateDelay('fill');
        self.recordCall('locator.fill', [value, options]);
        return undefined;
      },

      async pressSequentially(text: string, options?: any) {
        await self.simulateDelay('type');
        self.recordCall('locator.pressSequentially', [text, options]);
        return undefined;
      },

      async press(key: string, options?: any) {
        await self.simulateDelay('press');
        self.recordCall('locator.press', [key, options]);
        return undefined;
      },

      async waitFor(options?: any) {
        await self.simulateDelay('waitFor');
        self.recordCall('locator.waitFor', [options]);
        return undefined;
      },

      async count() {
        const selector = (this as any).__selector;
        const count = self.config.elementCount?.get(selector) ?? 1;
        self.recordCall('locator.count', []);
        return count;
      },

      async isVisible() {
        const selector = (this as any).__selector;
        const visible = self.config.visibility?.get(selector) ?? true;
        self.recordCall('locator.isVisible', []);
        return visible;
      },

      first() {
        self.recordCall('locator.first', []);
        return this as Locator;
      },

      nth(index: number) {
        self.recordCall('locator.nth', [index]);
        return this as Locator;
      },
    };

    const mockPage: Partial<Page> = {
      async goto(url: string, options?: any) {
        await self.simulateDelay('goto');
        self.pageUrl = url;
        self.recordCall('page.goto', [url, options]);
        return null as any;
      },

      locator(selector: string) {
        self.checkFailure(selector);
        self.recordCall('page.locator', [selector]);
        // Store selector for later use
        (mockLocator as any).__selector = selector;
        return mockLocator as Locator;
      },

      async title() {
        self.recordCall('page.title', []);
        return self.pageTitle;
      },

      url() {
        self.recordCall('page.url', []);
        return self.pageUrl;
      },

      async evaluate(pageFunction: any, arg?: any) {
        await self.simulateDelay('evaluate');
        const script = typeof pageFunction === 'function' 
          ? pageFunction.toString() 
          : String(pageFunction);
        
        // Check for configured result
        const configuredResult = self.config.evaluateResults?.get(script);
        const result = configuredResult !== undefined ? configuredResult : null;
        
        self.recordCall('page.evaluate', [script, arg], result);
        return result;
      },

      async waitForLoadState(state?: any, options?: any) {
        await self.simulateDelay('waitForLoadState');
        self.recordCall('page.waitForLoadState', [state, options]);
        // Mock implementation: assume load state is immediately reached
        // In a real browser, this would wait for the actual state
        return Promise.resolve();
      },

      async waitForTimeout(timeout: number) {
        await self.simulateDelay('waitForTimeout');
        self.recordCall('page.waitForTimeout', [timeout]);
        return undefined;
      },

      async screenshot(options?: any) {
        await self.simulateDelay('screenshot');
        self.recordCall('page.screenshot', [options]);
        return Buffer.from('mock-screenshot');
      },

      keyboard: {
        async press(key: string, options?: any) {
          await self.simulateDelay('keyboard.press');
          self.recordCall('keyboard.press', [key, options]);
          return undefined;
        },
      } as any,
    };

    return mockPage as Page;
  }

  /**
   * Configure mock behaviors
   */
  configure(config: Partial<MockConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Set page URL
   */
  setUrl(url: string): void {
    this.pageUrl = url;
  }

  /**
   * Set page title
   */
  setTitle(title: string): void {
    this.pageTitle = title;
  }

  /**
   * Set evaluation result for a specific script
   */
  setEvaluateResult(script: string, result: any): void {
    if (!this.config.evaluateResults) {
      this.config.evaluateResults = new Map();
    }
    this.config.evaluateResults.set(script, result);
  }

  /**
   * Set visibility for a selector
   */
  setVisibility(selector: string, visible: boolean): void {
    if (!this.config.visibility) {
      this.config.visibility = new Map();
    }
    this.config.visibility.set(selector, visible);
  }

  /**
   * Set element count for a selector
   */
  setElementCount(selector: string, count: number): void {
    if (!this.config.elementCount) {
      this.config.elementCount = new Map();
    }
    this.config.elementCount.set(selector, count);
  }

  /**
   * Simulate failure for a selector
   */
  simulateFailure(selector: string, error: Error): void {
    if (!this.config.failures) {
      this.config.failures = new Map();
    }
    this.config.failures.set(selector, error);
  }

  /**
   * Set delay for a method
   */
  setDelay(method: string, ms: number): void {
    if (!this.config.delays) {
      this.config.delays = new Map();
    }
    this.config.delays.set(method, ms);
  }

  /**
   * Assert that a method was called
   */
  assertCalled(method: string, times?: number): void {
    const calls = this.getCallsFor(method);
    if (times !== undefined) {
      if (calls.length !== times) {
        throw new Error(
          `Expected ${method} to be called ${times} times, but was called ${calls.length} times`
        );
      }
    } else if (calls.length === 0) {
      throw new Error(`Expected ${method} to be called at least once`);
    }
  }

  /**
   * Assert that a method was called with specific arguments
   */
  assertCalledWith(method: string, expectedArgs: any[]): void {
    const calls = this.getCallsFor(method);
    const found = calls.some((call) =>
      JSON.stringify(call.args) === JSON.stringify(expectedArgs)
    );
    
    if (!found) {
      throw new Error(
        `Expected ${method} to be called with ${JSON.stringify(expectedArgs)}, ` +
        `but actual calls were: ${JSON.stringify(calls.map((c) => c.args))}`
      );
    }
  }

  /**
   * Assert that no methods were called
   */
  assertNoCalls(): void {
    if (this.callHistory.length > 0) {
      throw new Error(
        `Expected no calls, but found ${this.callHistory.length} calls: ` +
        JSON.stringify(this.callHistory.map((c) => c.method))
      );
    }
  }
}
