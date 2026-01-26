/**
 * 调试工具测试
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { DryRunner, DebugLogger, DebugLevel, StepTracer, ContextDumper } from './debug.js';
import { ActionDefinition, ActionStep, ExecutionContext } from './types.js';

describe('debug', () => {
  describe('DryRunner', () => {
    const simpleDefinition: ActionDefinition = {
      name: 'test:action',
      fullName: 'test:test:action',
      namespace: 'test',
      description: 'Test action',
      params: {},
      steps: [
        {
          action: 'click',
          args: {
            selector: '${selectors.button}',
          },
        },
        {
          action: 'wait',
          when: '${params.wait}',
          args: { waitFor: 'networkidle' },
        },
      ],
      sourcePath: '/test/action.yaml',
    };

    it('should analyze steps without variable resolution', () => {
      const result = DryRunner.analyze(simpleDefinition, { wait: true });

      expect(result.action).toBe('test:action');
      expect(result.namespace).toBe('test');
      expect(result.totalSteps).toBe(2);
      expect(result.steps[0].action).toBe('click');
      expect(result.steps[0].args?.selector).toBe('${selectors.button}');
    });

    it('should resolve variables when option enabled', () => {
      const result = DryRunner.analyze(
        simpleDefinition,
        { wait: true },
        { resolveVariables: true }
      );

      // args 会被解析
      expect(result.steps[1].args).toEqual({ waitFor: 'networkidle' });
    });

    it('should evaluate conditions when option enabled', () => {
      const result = DryRunner.analyze(
        simpleDefinition,
        { wait: true },
        { resolveVariables: true, evaluateConditions: true }
      );

      expect(result.steps[0].willExecute).toBe(true);
      expect(result.steps[1].willExecute).toBe(true);
    });

    it('should mark step as not executing when condition is false', () => {
      const result = DryRunner.analyze(
        simpleDefinition,
        { wait: false },
        { resolveVariables: true, evaluateConditions: true }
      );

      expect(result.steps[1].willExecute).toBe(false);
    });

    it('should analyze fallback steps', () => {
      const definitionWithFallback: ActionDefinition = {
        ...simpleDefinition,
        steps: [
          {
            action: 'click',
            args: {
              selector: '#primary',
            },
            fallback: [
              {
                action: 'click',
                args: {
                  selector: '#fallback',
                },
              },
            ],
          },
        ],
      };

      const result = DryRunner.analyze(definitionWithFallback, {});

      expect(result.steps[0].fallback).toBeDefined();
      expect(result.steps[0].fallback![0].action).toBe('click');
      expect(result.steps[0].fallback![0].args?.selector).toBe('#fallback');
    });

    it('should count steps to execute correctly', () => {
      const result = DryRunner.analyze(
        simpleDefinition,
        { wait: false },
        { resolveVariables: true, evaluateConditions: true }
      );

      expect(result.totalSteps).toBe(2);
      expect(result.stepsToExecute).toBe(1); // only first step
    });

    it('should format result as readable text', () => {
      const result = DryRunner.analyze(simpleDefinition, { wait: true });
      const formatted = DryRunner.format(result);

      expect(formatted).toContain('Dry-Run: test:test:action');
      expect(formatted).toContain('Execution Plan');
      expect(formatted).toContain('click');
      expect(formatted).toContain('wait');
    });

    it('should show verbose info when requested', () => {
      const result = DryRunner.analyze(
        {
          ...simpleDefinition,
          steps: [
            {
              action: 'click',
              args: {
                selector: '#btn',
              },
              timeout: 5000,
              retry: 2,
              onError: 'abort',
              output: 'clicked',
            },
          ],
        },
        {}
      );

      const formatted = DryRunner.format(result, { verbose: true });

      expect(formatted).toContain('Timeout: 5000ms');
      expect(formatted).toContain('Retry: 2');
      expect(formatted).toContain('OnError: abort');
      expect(formatted).toContain('Output: clicked');
    });
  });

  describe('DebugLogger', () => {
    let logger: DebugLogger;

    beforeEach(() => {
      logger = new DebugLogger(DebugLevel.DEBUG);
    });

    it('should log messages at correct level', () => {
      logger.error('error message');
      logger.warn('warn message');
      logger.info('info message');
      logger.debug('debug message');

      const logs = logger.getLogs();
      expect(logs).toHaveLength(4);
      expect(logs[0].level).toBe(DebugLevel.ERROR);
      expect(logs[1].level).toBe(DebugLevel.WARN);
      expect(logs[2].level).toBe(DebugLevel.INFO);
      expect(logs[3].level).toBe(DebugLevel.DEBUG);
    });

    it('should respect log level filtering', () => {
      logger.setLevel(DebugLevel.WARN);

      logger.error('error');
      logger.warn('warn');
      logger.info('info');
      logger.debug('debug');

      const logs = logger.getLogs();
      expect(logs).toHaveLength(2); // only ERROR and WARN
    });

    it('should format messages with arguments', () => {
      logger.info('Message', { foo: 'bar' }, 123);

      const logs = logger.getLogs();
      expect(logs[0].message).toContain('foo');
      expect(logs[0].message).toContain('123');
    });

    it('should clear logs', () => {
      logger.info('test');
      expect(logger.getLogs()).toHaveLength(1);

      logger.clear();
      expect(logger.getLogs()).toHaveLength(0);
    });

    it('should sanitize secret parameters', () => {
      const params = {
        username: 'user123',
        password: 'secret123',
        nested: {
          apiKey: 'key123',
          publicData: 'visible',
        },
      };

      const secretKeys = new Set(['password', 'apiKey']);
      const sanitized = DebugLogger.sanitize(params, secretKeys);

      expect(sanitized.username).toBe('user123');
      expect(sanitized.password).toBe('***');
      expect((sanitized.nested as Record<string, unknown>).apiKey).toBe('***');
      expect((sanitized.nested as Record<string, unknown>).publicData).toBe('visible');
    });
  });

  describe('StepTracer', () => {
    let tracer: StepTracer;

    beforeEach(() => {
      tracer = new StepTracer();
      tracer.start();
    });

    it('should trace step execution', () => {
      const step: ActionStep = { action: 'click', args: { selector: '#btn' } };

      tracer.stepStart(0, step);
      tracer.stepSuccess(0, 'clicked');

      const traces = tracer.getTraces();
      expect(traces).toHaveLength(1);
      expect(traces[0].index).toBe(0);
      expect(traces[0].action).toBe('click');
      expect(traces[0].success).toBe(true);
      expect(traces[0].output).toBe('clicked');
    });

    it('should record step failure', () => {
      const step: ActionStep = { action: 'click', args: { selector: '#btn' } };

      tracer.stepStart(0, step);
      tracer.stepFailure(0, new Error('Click failed'));

      const traces = tracer.getTraces();
      expect(traces[0].success).toBe(false);
      expect(traces[0].error).toBe('Click failed');
    });

    it('should record step skipped', () => {
      const step: ActionStep = { action: 'wait', when: '${false}', args: {} };

      tracer.stepStart(0, step);
      tracer.stepSkipped(0, 'Condition not met');

      const traces = tracer.getTraces();
      expect(traces[0].success).toBe(false);
      expect(traces[0].error).toBe('Condition not met');
    });

    it('should calculate duration', async () => {
      const step: ActionStep = { action: 'wait', args: {} };

      tracer.stepStart(0, step);

      // Wait using Promise to avoid blocking
      await new Promise((resolve) => setTimeout(resolve, 10));

      tracer.stepSuccess(0);

      const traces = tracer.getTraces();
      const duration = traces[0].endTime - traces[0].startTime;
      expect(duration).toBeGreaterThanOrEqual(5); // Allow some margin
    });

    it('should generate timeline', () => {
      tracer.stepStart(0, { action: 'click', args: { selector: '#btn' } });
      tracer.stepSuccess(0);

      tracer.stepStart(1, { action: 'wait', args: {} });
      tracer.stepFailure(1, new Error('Timeout'));

      const timeline = tracer.getTimeline();

      expect(timeline).toContain('Execution Timeline');
      expect(timeline).toContain('✓ Step 0: click');
      expect(timeline).toContain('✗ Step 1: wait');
      expect(timeline).toContain('Total Duration:');
    });

    it('should calculate statistics', () => {
      tracer.stepStart(0, { action: 'click', args: {} });
      tracer.stepSuccess(0);

      tracer.stepStart(1, { action: 'wait', args: {} });
      tracer.stepFailure(1, new Error('Failed'));

      tracer.stepStart(2, { action: 'type', args: {} });
      tracer.stepSkipped(2, 'Condition not met');

      const stats = tracer.getStats();

      expect(stats.total).toBe(3);
      expect(stats.success).toBe(1);
      expect(stats.failed).toBe(2); // both failed and skipped count as failed
    });
  });

  describe('ContextDumper', () => {
    it('should dump execution context', () => {
      const context: ExecutionContext = {
        params: {
          username: 'testuser',
          password: 'secret',
        },
        selectors: {
          button: '#btn',
        },
        env: {
          NODE_ENV: 'test',
          AGENT_BROWSER_DEBUG: 'true',
        },
        steps: {
          0: { success: true },
        },
        depth: 0,
        startTime: Date.now(),
        actionTimeout: 300000,
        stepTimeout: 30000,
        debugMode: true,
        dryRun: false,
      };

      const dump = ContextDumper.dump(context);

      expect(dump).toContain('Execution Context');
      expect(dump).toContain('Parameters:');
      expect(dump).toContain('testuser');
      expect(dump).toContain('Selectors:');
      expect(dump).toContain('#btn');
      expect(dump).toContain('Step Outputs:');
      expect(dump).toContain('Environment Variables:');
      expect(dump).toContain('AGENT_BROWSER_DEBUG');
    });

    it('should sanitize secret parameters', () => {
      const context: ExecutionContext = {
        params: {
          username: 'testuser',
          password: 'secret123',
        },
        selectors: {},
        env: {},
        steps: {},
        depth: 0,
        startTime: Date.now(),
        actionTimeout: 300000,
        stepTimeout: 30000,
        debugMode: false,
        dryRun: false,
      };

      const secretKeys = new Set(['password']);
      const dump = ContextDumper.dump(context, secretKeys);

      expect(dump).toContain('testuser');
      expect(dump).not.toContain('secret123');
      expect(dump).toContain('***');
    });

    it('should filter environment variables', () => {
      const context: ExecutionContext = {
        params: {},
        selectors: {},
        env: {
          PATH: '/usr/bin',
          HOME: '/home/user',
          AGENT_BROWSER_DEBUG: 'true',
          AGENT_BROWSER_TIMEOUT: '5000',
        },
        steps: {},
        depth: 0,
        startTime: Date.now(),
        actionTimeout: 300000,
        stepTimeout: 30000,
        debugMode: false,
        dryRun: false,
      };

      const dump = ContextDumper.dump(context);

      expect(dump).toContain('AGENT_BROWSER_DEBUG');
      expect(dump).toContain('AGENT_BROWSER_TIMEOUT');
      expect(dump).not.toContain('PATH');
      expect(dump).not.toContain('HOME');
    });
  });
});
