/**
 * Action execution engine
 *
 * This module provides the core execution engine for semantic actions:
 * - Step-by-step execution with condition evaluation
 * - Variable interpolation and context management
 * - Error handling, retry, and fallback mechanisms
 * - Recursion depth and resource limits
 * - Dry-run and debug tracing
 *
 * @module actions/executor
 */

import type { Page } from 'playwright-core';
import type {
  ActionDefinition,
  ActionStep,
  ActionResult,
  ActionError,
  ExecutionContext,
  StepTrace,
  ActionErrorCode,
  DryRunResult,
  ResolvedStep,
  ActionRegistry,
} from './types.js';
import { resolveObject, evaluateExpression } from './vars.js';
import { executeWithFallback } from './selectors.js';

// ============================================================================
// Error Classes
// ============================================================================

/**
 * Custom error class for action execution errors
 */
class ActionExecutionError extends Error implements ActionError {
  code: ActionErrorCode;
  action: string;
  step?: number;
  stepAction?: string;
  details?: Record<string, unknown>;
  suggestion?: string;

  constructor(error: ActionError) {
    super(error.message);
    this.name = 'ActionExecutionError';
    this.code = error.code;
    this.action = error.action;
    this.step = error.step;
    this.stepAction = error.stepAction;
    this.details = error.details;
    this.suggestion = error.suggestion;

    // Preserve stack trace if provided
    if (error.stack) {
      this.stack = error.stack;
    }
  }
}

// ============================================================================
// Configuration & Limits
// ============================================================================

/**
 * Execution configuration options
 */
export interface ExecutorConfig {
  /** Maximum recursion depth for nested action calls (default: 10) */
  maxDepth?: number;

  /** Maximum steps per action execution (default: 100) */
  maxSteps?: number;

  /** Default timeout for each step (milliseconds, default: 30000) */
  stepTimeout?: number;

  /** Total action timeout (milliseconds, default: 300000 = 5min) */
  actionTimeout?: number;

  /** Enable debug mode (detailed logging) */
  debugMode?: boolean;

  /** Enable dry-run mode (parse only, no execution) */
  dryRun?: boolean;
}

/**
 * Default configuration values
 */
export const DEFAULT_EXECUTOR_CONFIG: Required<ExecutorConfig> = {
  maxDepth: 10,
  maxSteps: 100,
  stepTimeout: 30000,
  actionTimeout: 300000,
  debugMode: false,
  dryRun: false,
};

// ============================================================================
// Executor Class
// ============================================================================

/**
 * Action executor that orchestrates step execution
 */
export class ActionExecutor {
  private config: Required<ExecutorConfig>;
  private registry: ActionRegistry | null = null;
  private page: Page | null = null;

  constructor(config: ExecutorConfig = {}) {
    this.config = { ...DEFAULT_EXECUTOR_CONFIG, ...config };
  }

  /**
   * Set the action registry for resolving nested actions
   */
  setRegistry(registry: ActionRegistry): void {
    this.registry = registry;
  }

  /**
   * Set the page context for browser operations
   */
  setPage(page: Page): void {
    this.page = page;
  }

  /**
   * Execute an action with the given parameters
   */
  async execute(
    action: ActionDefinition,
    params: Record<string, unknown>,
    env: Record<string, string> = {}
  ): Promise<ActionResult> {
    const startTime = Date.now();

    // Initialize execution context
    const context: ExecutionContext = {
      params,
      env,
      selectors: {}, // Will be populated with resolved selectors
      steps: {},
      depth: 0,
      startTime,
      actionTimeout: this.config.actionTimeout,
      stepTimeout: this.config.stepTimeout,
      debugMode: this.config.debugMode,
      dryRun: this.config.dryRun,
    };

    const trace: StepTrace[] = [];

    // Create timeout promise
    const timeoutPromise = new Promise<ActionResult>((_, reject) => {
      setTimeout(() => {
        reject(new Error(`Action timeout exceeded (${this.config.actionTimeout}ms)`));
      }, this.config.actionTimeout);
    });

    // Execute with timeout
    const executionPromise = this.executeInternal(action, context, trace);

    try {
      return await Promise.race([executionPromise, timeoutPromise]);
    } catch (error) {
      if (this.config.debugMode) {
        console.error(`[Executor] Action failed: ${action.fullName}`, error);
      }

      const actionError = this.normalizeError(error, action.fullName);

      return {
        success: false,
        error: actionError,
        trace,
      };
    }
  }

  /**
   * Internal execution logic (called by execute)
   */
  private async executeInternal(
    action: ActionDefinition,
    context: ExecutionContext,
    trace: StepTrace[]
  ): Promise<ActionResult> {
    try {
      // Resolve selectors (extract from action's namespace)
      // TODO: Apply version overrides if needed
      context.selectors = this.resolveSelectors(action);

      if (this.config.debugMode) {
        console.log(`[Executor] Starting action: ${action.fullName}`);
        console.log(`[Executor] Parameters:`, context.params);
        console.log(`[Executor] Selectors:`, context.selectors);
      }

      // Check total timeout
      this.checkActionTimeout(context);

      // Execute steps sequentially
      for (let i = 0; i < action.steps.length; i++) {
        const step = action.steps[i];

        // Check step limit
        if (trace.length >= this.config.maxSteps) {
          throw this.createError(
            'MAX_STEPS_EXCEEDED',
            `Maximum steps limit exceeded (${this.config.maxSteps})`,
            action.fullName,
            i,
            step.action
          );
        }

        // Execute step
        const stepTrace = await this.executeStep(step, i, action, context);
        trace.push(stepTrace);

        // Stop on error if not continuing
        if (!stepTrace.success && step.onError !== 'continue') {
          break;
        }
      }

      // Check if any step failed (and we should abort)
      // Only fail if the step doesn't have onError: 'continue'
      const failedStep = trace.find((t, idx) => {
        const step = action.steps[idx];
        return !t.success && step.onError !== 'continue';
      });

      if (failedStep) {
        const step = action.steps[failedStep.index];
        throw this.createError(
          'STEP_FAILED',
          failedStep.error || 'Step execution failed',
          action.fullName,
          failedStep.index,
          step.action
        );
      }

      // Evaluate return values
      const data = this.evaluateReturns(action, context);

      // Verify post-conditions
      if (action.verify) {
        this.verifyConditions(action, context);
      }

      if (this.config.debugMode) {
        console.log(`[Executor] Action completed: ${action.fullName}`);
        console.log(`[Executor] Return data:`, data);
      }

      return {
        success: true,
        data,
        trace,
      };
    } catch (error) {
      // Re-throw to let execute() handle it
      throw error;
    }
  }

  /**
   * Perform a dry-run (parse and validate without execution)
   */
  async dryRun(
    action: ActionDefinition,
    params: Record<string, unknown>,
    env: Record<string, string> = {}
  ): Promise<DryRunResult> {
    // Create execution context
    const context: ExecutionContext = {
      params,
      env,
      selectors: this.resolveSelectors(action),
      steps: {},
      depth: 0,
      startTime: Date.now(),
      actionTimeout: this.config.actionTimeout,
      stepTimeout: this.config.stepTimeout,
      debugMode: true,
      dryRun: true,
    };

    try {
      // Resolve all steps
      const steps: ResolvedStep[] = [];

      for (let i = 0; i < action.steps.length; i++) {
        const step = action.steps[i];

        // Resolve arguments
        const resolvedArgs = resolveObject(step.args, context);

        // Evaluate when condition
        let willExecute = true;
        let skipReason: string | undefined;

        if (step.when) {
          try {
            // Resolve variables first
            const resolvedCondition = resolveObject({ when: step.when }, context).when as string;
            // Then evaluate
            const result = evaluateExpression(resolvedCondition, context);
            willExecute = this.toBoolean(result);
            if (!willExecute) {
              skipReason = `Condition not met: ${step.when}`;
            }
          } catch (err) {
            willExecute = false;
            skipReason = `Condition evaluation error: ${err}`;
          }
        }

        steps.push({
          index: i,
          action: step.action,
          args: resolvedArgs,
          willExecute,
          skipReason,
        });
      }

      return {
        success: true,
        action,
        context,
        steps,
      };
    } catch (error) {
      return {
        success: false,
        action,
        context,
        steps: [],
        error: this.normalizeError(error, action.fullName),
      };
    }
  }

  // ==========================================================================
  // Step Execution
  // ==========================================================================

  /**
   * Execute a single step
   */
  private async executeStep(
    step: ActionStep,
    index: number,
    action: ActionDefinition,
    context: ExecutionContext
  ): Promise<StepTrace> {
    const stepStartTime = Date.now();

    if (this.config.debugMode) {
      console.log(`[Executor] Step ${index}: ${step.action}`, step.args);
    }

    try {
      // Evaluate when condition
      if (step.when) {
        try {
          // First resolve any ${} variables in the condition
          const resolvedCondition = resolveObject({ when: step.when }, context).when as string;
          // Then evaluate the expression
          const result = evaluateExpression(resolvedCondition, context);
          const shouldExecute = this.toBoolean(result);
          if (!shouldExecute) {
            if (this.config.debugMode) {
              console.log(`[Executor] Step ${index} skipped (condition: ${step.when})`);
            }

            return {
              index,
              action: step.action,
              startTime: stepStartTime,
              endTime: Date.now(),
              success: true,
              output: undefined,
            };
          }
        } catch (err) {
          throw new Error(`Failed to evaluate condition: ${step.when}: ${err}`);
        }
      }

      // Check timeout
      this.checkActionTimeout(context);

      // Execute with retry
      const result = await this.executeWithRetry(step, index, action, context);

      // Store output in context
      if (step.output) {
        context.steps[step.output] = result;
      }

      if (this.config.debugMode) {
        console.log(`[Executor] Step ${index} completed:`, result);
      }

      return {
        index,
        action: step.action,
        startTime: stepStartTime,
        endTime: Date.now(),
        success: true,
        output: result,
      };
    } catch (error) {
      if (this.config.debugMode) {
        console.error(`[Executor] Step ${index} failed:`, error);
      }

      // If it's a critical error (MAX_DEPTH_EXCEEDED, MAX_STEPS_EXCEEDED, etc.), rethrow immediately
      if (error instanceof ActionExecutionError) {
        const criticalCodes: ActionErrorCode[] = [
          'MAX_DEPTH_EXCEEDED' as ActionErrorCode,
          'MAX_STEPS_EXCEEDED' as ActionErrorCode,
          'ACTION_NOT_FOUND' as ActionErrorCode,
        ];
        if (criticalCodes.includes(error.code)) {
          throw error;
        }
      }

      const errorMessage = error instanceof Error ? error.message : String(error);

      // Handle error based on strategy
      if (step.onError === 'continue') {
        return {
          index,
          action: step.action,
          startTime: stepStartTime,
          endTime: Date.now(),
          success: false,
          error: errorMessage,
        };
      }

      // Try fallback if available
      if (step.onError === 'fallback' && step.fallback && step.fallback.length > 0) {
        if (this.config.debugMode) {
          console.log(`[Executor] Trying fallback for step ${index}`);
        }

        try {
          const fallbackResult = await this.executeFallback(step.fallback, action, context);

          // Store fallback result
          if (step.output) {
            context.steps[step.output] = fallbackResult;
          }

          return {
            index,
            action: step.action,
            startTime: stepStartTime,
            endTime: Date.now(),
            success: true,
            output: fallbackResult,
          };
        } catch (fallbackError) {
          // Fallback also failed
          return {
            index,
            action: step.action,
            startTime: stepStartTime,
            endTime: Date.now(),
            success: false,
            error: fallbackError instanceof Error ? fallbackError.message : String(fallbackError),
          };
        }
      }

      // Default: propagate error
      return {
        index,
        action: step.action,
        startTime: stepStartTime,
        endTime: Date.now(),
        success: false,
        error: errorMessage,
      };
    }
  }

  /**
   * Execute step with retry mechanism
   */
  private async executeWithRetry(
    step: ActionStep,
    index: number,
    action: ActionDefinition,
    context: ExecutionContext
  ): Promise<unknown> {
    const maxAttempts = (step.retry || 0) + 1;
    const retryDelay = step.retryDelay || 1000;

    let lastError: Error | null = null;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        if (attempt > 0) {
          if (this.config.debugMode) {
            console.log(`[Executor] Retry attempt ${attempt} for step ${index}`);
          }

          // Wait before retry
          await this.sleep(retryDelay * Math.pow(2, attempt - 1)); // Exponential backoff
        }

        return await this.executeStepAction(step, context);
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        if (attempt === maxAttempts - 1) {
          // Last attempt failed
          throw lastError;
        }

        if (this.config.debugMode) {
          console.warn(`[Executor] Step ${index} failed (attempt ${attempt + 1}):`, error);
        }
      }
    }

    throw lastError || new Error('Execution failed');
  }

  /**
   * Execute fallback steps
   */
  private async executeFallback(
    fallbackSteps: ActionStep[],
    action: ActionDefinition,
    context: ExecutionContext
  ): Promise<unknown> {
    let lastResult: unknown;

    for (let i = 0; i < fallbackSteps.length; i++) {
      const step = fallbackSteps[i];
      const trace = await this.executeStep(step, i, action, context);

      if (!trace.success) {
        throw new Error(trace.error || 'Fallback step failed');
      }

      lastResult = trace.output;
    }

    return lastResult;
  }

  // ==========================================================================
  // Step Action Handlers
  // ==========================================================================

  /**
   * Execute a step action (dispatch to appropriate handler)
   */
  private async executeStepAction(step: ActionStep, context: ExecutionContext): Promise<unknown> {
    // Resolve arguments with variable interpolation
    const args = resolveObject(step.args, context);

    // Dry-run mode: just return resolved args
    if (context.dryRun) {
      return { action: step.action, args };
    }

    // Dispatch to handler
    switch (step.action) {
      case 'open':
        return await this.handleOpen(args, step, context);

      case 'click':
        return await this.handleClick(args, step, context);

      case 'fill':
        return await this.handleFill(args, step, context);

      case 'type':
        return await this.handleType(args, step, context);

      case 'press':
        return await this.handlePress(args, step, context);

      case 'wait':
        return await this.handleWait(args, step, context);

      case 'snapshot':
        return await this.handleSnapshot(args, step, context);

      case 'eval':
        return await this.handleEval(args, step, context);

      case 'find':
        return await this.handleFind(args, step, context);

      case 'run':
        return await this.handleRun(args, step, context);

      case 'fail':
        return await this.handleFail(args, step, context);

      default:
        throw new Error(`Unknown step action: ${step.action}`);
    }
  }

  /**
   * Handle 'open' action (navigate to URL)
   */
  private async handleOpen(
    args: Record<string, unknown>,
    step: ActionStep,
    context: ExecutionContext
  ): Promise<unknown> {
    if (!this.page) {
      throw new Error('Page not available');
    }

    const url = String(args.url || args.to || '');
    if (!url) {
      throw new Error('Missing required argument: url');
    }

    const timeout = (step.timeout || context.stepTimeout) as number;

    await this.page.goto(url, { timeout });

    return { url };
  }

  /**
   * Handle 'click' action
   */
  private async handleClick(
    args: Record<string, unknown>,
    step: ActionStep,
    context: ExecutionContext
  ): Promise<unknown> {
    if (!this.page) {
      throw new Error('Page not available');
    }

    const selector = this.getSelector(args, context);
    const timeout = (step.timeout || context.stepTimeout) as number;

    // Use selector fallback mechanism
    const result = await executeWithFallback(this.page, selector, {
      timeout,
      debugMode: context.debugMode,
    });

    if (!result.success) {
      throw new Error(result.errors[0]?.error || 'Click failed');
    }

    // Execute click on the found locator
    await result.locator!.click({ timeout });
    return { clicked: true };
  }

  /**
   * Handle 'fill' action
   */
  private async handleFill(
    args: Record<string, unknown>,
    step: ActionStep,
    context: ExecutionContext
  ): Promise<unknown> {
    if (!this.page) {
      throw new Error('Page not available');
    }

    const selector = this.getSelector(args, context);
    const value = String(args.value || '');
    const timeout = (step.timeout || context.stepTimeout) as number;

    const result = await executeWithFallback(this.page, selector, {
      timeout,
      debugMode: context.debugMode,
    });

    if (!result.success) {
      throw new Error(result.errors[0]?.error || 'Fill failed');
    }

    await result.locator!.fill(value, { timeout });
    return { filled: true, value };
  }

  /**
   * Handle 'type' action
   */
  private async handleType(
    args: Record<string, unknown>,
    step: ActionStep,
    context: ExecutionContext
  ): Promise<unknown> {
    if (!this.page) {
      throw new Error('Page not available');
    }

    const selector = this.getSelector(args, context);
    const text = String(args.text || args.value || '');
    const delay = Number(args.delay || 0);
    const timeout = (step.timeout || context.stepTimeout) as number;

    const result = await executeWithFallback(this.page, selector, {
      timeout,
      debugMode: context.debugMode,
    });

    if (!result.success) {
      throw new Error(result.errors[0]?.error || 'Type failed');
    }

    await result.locator!.pressSequentially(text, { delay, timeout });
    return { typed: true, text };
  }

  /**
   * Handle 'press' action (keyboard key)
   */
  private async handlePress(
    args: Record<string, unknown>,
    step: ActionStep,
    context: ExecutionContext
  ): Promise<unknown> {
    if (!this.page) {
      throw new Error('Page not available');
    }

    const key = String(args.key || '');
    if (!key) {
      throw new Error('Missing required argument: key');
    }

    const selector = args.selector ? this.getSelector(args, context) : undefined;

    if (selector) {
      // Press key on specific element
      const timeout = (step.timeout || context.stepTimeout) as number;

      const result = await executeWithFallback(this.page, selector, {
        timeout,
        debugMode: context.debugMode,
      });

      if (!result.success) {
        throw new Error(result.errors[0]?.error || 'Press failed');
      }

      await result.locator!.press(key, { timeout });
      return { pressed: true, key };
    } else {
      // Press key globally
      await this.page.keyboard.press(key);
      return { pressed: true, key };
    }
  }

  /**
   * Handle 'wait' action
   */
  private async handleWait(
    args: Record<string, unknown>,
    step: ActionStep,
    context: ExecutionContext
  ): Promise<unknown> {
    if (!this.page) {
      throw new Error('Page not available');
    }

    // Wait for time
    if (args.time || args.ms) {
      const ms = Number(args.time || args.ms);
      await this.sleep(ms);
      return { waited: ms };
    }

    // Wait for selector
    if (args.selector) {
      const selector = this.getSelector(args, context);
      const timeout = (step.timeout || context.stepTimeout) as number;

      const result = await executeWithFallback(this.page, selector, {
        timeout,
        debugMode: context.debugMode,
      });

      if (!result.success) {
        throw new Error(result.errors[0]?.error || 'Wait for selector failed');
      }

      // Element already found and visible by executeWithFallback
      return { found: true };
    }

    // Wait for load state
    if (args.load || args.state || args.for) {
      const state = String(args.load || args.state || args.for) as
        | 'load'
        | 'domcontentloaded'
        | 'networkidle';
      const timeout = (step.timeout || context.stepTimeout) as number;
      await this.page.waitForLoadState(state, { timeout });
      return { state };
    }

    throw new Error('Wait action requires time, selector, or load state');
  }

  /**
   * Handle 'snapshot' action
   */
  private async handleSnapshot(
    args: Record<string, unknown>,
    step: ActionStep,
    context: ExecutionContext
  ): Promise<unknown> {
    if (!this.page) {
      throw new Error('Page not available');
    }

    // This would integrate with the existing snapshot system
    // For now, return basic page info
    const title = await this.page.title();
    const url = this.page.url();

    return {
      title,
      url,
      timestamp: Date.now(),
    };
  }

  /**
   * Handle 'eval' action (evaluate JavaScript)
   */
  private async handleEval(
    args: Record<string, unknown>,
    step: ActionStep,
    context: ExecutionContext
  ): Promise<unknown> {
    if (!this.page) {
      throw new Error('Page not available');
    }

    const expression = String(args.expression || args.script || '');
    if (!expression) {
      throw new Error('Missing required argument: expression');
    }

    const timeout = (step.timeout || context.stepTimeout) as number;

    // Evaluate in page context
    const result = await this.page.evaluate(expression, { timeout } as any);

    return result;
  }

  /**
   * Handle 'find' action (semantic locator)
   */
  private async handleFind(
    args: Record<string, unknown>,
    step: ActionStep,
    context: ExecutionContext
  ): Promise<unknown> {
    if (!this.page) {
      throw new Error('Page not available');
    }

    const selector = this.getSelector(args, context);
    const timeout = (step.timeout || context.stepTimeout) as number;

    const result = await executeWithFallback(this.page, selector, {
      timeout,
      debugMode: context.debugMode,
      throwOnFailure: false,
    });

    if (!result.success) {
      return { found: false, count: 0, visible: false };
    }

    const count = await result.locator!.count();
    const visible = count > 0 ? await result.locator!.first().isVisible() : false;

    return {
      found: count > 0,
      count,
      visible,
    };
  }

  /**
   * Handle 'run' action (call another action)
   */
  private async handleRun(
    args: Record<string, unknown>,
    step: ActionStep,
    context: ExecutionContext
  ): Promise<unknown> {
    if (!this.registry) {
      throw new Error('Registry not available for nested action calls');
    }

    const actionName = String(args.action || '');
    if (!actionName) {
      throw new Error('Missing required argument: action');
    }

    // Check recursion depth BEFORE increment
    if (context.depth >= this.config.maxDepth) {
      throw this.createError(
        'MAX_DEPTH_EXCEEDED',
        `Maximum recursion depth exceeded (${this.config.maxDepth})`,
        actionName
      );
    }

    // Get action definition
    const action = this.registry.index.get(actionName);
    if (!action) {
      throw this.createError('ACTION_NOT_FOUND', `Action not found: ${actionName}`, actionName);
    }

    // Extract parameters for nested call
    // If args.params exists, use it as the parameters
    // Otherwise, use all args except 'action' as parameters
    const nestedParams = args.params
      ? typeof args.params === 'object'
        ? (args.params as Record<string, unknown>)
        : {}
      : (() => {
          const params = { ...args };
          delete params.action;
          return params;
        })();

    // Execute nested action recursively using executeNestedAction
    const result = await this.executeNestedAction(action, nestedParams, context);

    if (!result.success) {
      // If the nested action has an error, propagate it
      if (result.error) {
        throw new ActionExecutionError(result.error);
      }
      throw new Error('Nested action failed');
    }

    return result.data;
  }

  /**
   * Execute a nested action with incremented depth
   */
  private async executeNestedAction(
    action: ActionDefinition,
    params: Record<string, unknown>,
    parentContext: ExecutionContext
  ): Promise<ActionResult> {
    // Create nested context with incremented depth
    const nestedContext: ExecutionContext = {
      params,
      env: parentContext.env,
      selectors: {}, // Will be populated in executeInternal
      steps: {},
      depth: parentContext.depth + 1, // IMPORTANT: increment depth
      startTime: parentContext.startTime, // Share same timeout
      actionTimeout: parentContext.actionTimeout,
      stepTimeout: parentContext.stepTimeout,
      debugMode: parentContext.debugMode,
      dryRun: parentContext.dryRun,
    };

    const trace: StepTrace[] = [];

    try {
      return await this.executeInternal(action, nestedContext, trace);
    } catch (error) {
      const actionError = this.normalizeError(error, action.fullName);
      return {
        success: false,
        error: actionError,
        trace,
      };
    }
  }

  /**
   * Handle 'fail' action (explicit failure)
   */
  private async handleFail(
    args: Record<string, unknown>,
    step: ActionStep,
    context: ExecutionContext
  ): Promise<unknown> {
    const message = String(args.message || 'Action failed');
    throw new Error(message);
  }

  // ==========================================================================
  // Helper Methods
  // ==========================================================================

  /**
   * Get selector from args (either direct or from selectors context)
   */
  private getSelector(args: Record<string, unknown>, context: ExecutionContext): string | any {
    // Direct selector
    if (args.selector) {
      return String(args.selector);
    }

    // Named selector from context
    if (args.use) {
      const selectorName = String(args.use);
      const selector = context.selectors[selectorName];

      if (!selector) {
        throw new Error(`Selector not found: ${selectorName}`);
      }

      return selector;
    }

    throw new Error('Missing selector argument (selector or use)');
  }

  /**
   * Resolve selectors from action definition
   */
  private resolveSelectors(action: ActionDefinition): Record<string, any> {
    // Get namespace definition to access selectors
    if (!this.registry) {
      return {};
    }

    const namespace = this.registry.namespaces.get(action.namespace);
    if (!namespace) {
      return {};
    }

    return namespace.selectors;
  }

  /**
   * Evaluate return value expressions
   */
  private evaluateReturns(
    action: ActionDefinition,
    context: ExecutionContext
  ): Record<string, unknown> {
    if (!action.returns) {
      return {};
    }

    // Handle string returns (single expression)
    if (typeof action.returns === 'string') {
      try {
        // Resolve variables in the string
        const resolved = resolveObject({ value: action.returns }, context).value as string;
        // Try to parse as JSON if it looks like an object
        if (resolved.trim().startsWith('{')) {
          try {
            return JSON.parse(resolved);
          } catch {
            // If parsing fails, return as a single value
            return { value: resolved };
          }
        }
        // For non-object strings, evaluate as expression
        const result = evaluateExpression(resolved, context);
        return typeof result === 'object' && result !== null
          ? (result as Record<string, unknown>)
          : { value: result };
      } catch (err) {
        if (this.config.debugMode) {
          console.warn(`[Executor] Failed to evaluate return expression:`, err);
        }
        return {};
      }
    }

    // Handle object returns (key-value pairs)
    const data: Record<string, unknown> = {};

    for (const [key, expression] of Object.entries(action.returns)) {
      try {
        // Check if expression is a simple variable reference (e.g., "${steps.number}")
        const simpleVarMatch = /^\$\{([^}]+)\}$/.exec(expression);
        if (simpleVarMatch) {
          // Direct variable reference - preserve原始类型
          const varPath = simpleVarMatch[1].trim();
          const parts = varPath.split('.');
          const scope = parts[0];

          let value: unknown;
          if (scope === 'params') {
            value = this.resolvePathInObject(context.params, parts.slice(1));
          } else if (scope === 'env') {
            value = this.resolvePathInObject(context.env, parts.slice(1));
          } else if (scope === 'selectors') {
            value = this.resolvePathInObject(context.selectors, parts.slice(1));
          } else if (scope === 'steps') {
            value = this.resolvePathInObject(context.steps, parts.slice(1));
          } else {
            value = undefined;
          }
          data[key] = value;
        } else {
          // Complex expression - use resolveObject (may convert to string)
          const resolved = resolveObject({ value: expression }, context);
          data[key] = resolved.value;
        }
      } catch (err) {
        if (this.config.debugMode) {
          console.warn(`[Executor] Failed to resolve return value '${key}':`, err);
        }
        data[key] = undefined;
      }
    }

    return data;
  }

  /**
   * Resolve a path in an object (helper for evaluateReturns)
   */
  private resolvePathInObject(obj: Record<string, unknown>, path: string[]): unknown {
    let current: any = obj;
    for (const part of path) {
      if (current === null || current === undefined) {
        return undefined;
      }
      current = current[part];
    }
    return current;
  }

  /**
   * Verify post-execution conditions
   */
  private verifyConditions(action: ActionDefinition, context: ExecutionContext): void {
    if (!action.verify) {
      return;
    }

    for (const condition of action.verify) {
      try {
        // Resolve variables first
        const resolvedCondition = resolveObject({ condition: condition.condition }, context)
          .condition as string;
        // Then evaluate
        const result = evaluateExpression(resolvedCondition, context);
        const passed = this.toBoolean(result);
        if (!passed) {
          throw this.createError(
            'VERIFY_FAILED',
            condition.message || `Verification failed: ${condition.condition}`,
            action.fullName
          );
        }
      } catch (err) {
        // If it's already a VERIFY_FAILED error, rethrow it
        if (
          typeof err === 'object' &&
          err !== null &&
          'code' in err &&
          err.code === 'VERIFY_FAILED'
        ) {
          throw err;
        }
        // Otherwise wrap it as EXPRESSION_ERROR
        throw this.createError('EXPRESSION_ERROR', `Verification error: ${err}`, action.fullName);
      }
    }
  }

  /**
   * Check if action has exceeded timeout
   */
  private checkActionTimeout(context: ExecutionContext): void {
    const elapsed = Date.now() - context.startTime;
    if (elapsed > context.actionTimeout) {
      throw new Error(`Action timeout exceeded (${context.actionTimeout}ms)`);
    }
  }

  /**
   * Sleep for specified milliseconds
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Convert value to boolean using JavaScript truthiness rules
   */
  private toBoolean(value: unknown): boolean {
    if (typeof value === 'boolean') {
      return value;
    }
    if (typeof value === 'number') {
      return value !== 0 && !isNaN(value);
    }
    if (typeof value === 'string') {
      return value.length > 0;
    }
    if (value === null || value === undefined) {
      return false;
    }
    return true; // Objects, arrays, etc. are truthy
  }

  /**
   * Create a standardized action error
   */
  private createError(
    code: ActionErrorCode | string,
    message: string,
    action: string,
    step?: number,
    stepAction?: string
  ): ActionExecutionError {
    return new ActionExecutionError({
      code: code as ActionErrorCode,
      message,
      action,
      step,
      stepAction,
    });
  }

  /**
   * Normalize various error types into ActionError
   */
  private normalizeError(error: unknown, actionName: string): ActionError {
    // Check if it's already an ActionExecutionError
    if (error instanceof ActionExecutionError) {
      return error;
    }

    // Check if it has ActionError structure
    if (typeof error === 'object' && error !== null && 'code' in error && 'action' in error) {
      return error as ActionError;
    }

    const message = error instanceof Error ? error.message : String(error);
    const stack = error instanceof Error ? error.stack : undefined;

    return {
      code: 'STEP_FAILED' as ActionErrorCode,
      message,
      action: actionName,
      stack,
    };
  }
}
