/**
 * 调试工具与追踪功能
 * 提供 Dry-Run、Debug 模式和 Step Tracing 功能
 */

import { ActionDefinition, ActionStep, ExecutionContext, StepTrace } from './types.js';
import { resolveObject, evaluateExpression } from './vars.js';

/**
 * Dry-Run 模式选项
 */
export interface DryRunOptions {
  /** 是否解析变量插值 */
  resolveVariables?: boolean;
  /** 是否评估条件表达式 */
  evaluateConditions?: boolean;
  /** 是否展示详细信息 */
  verbose?: boolean;
}

/**
 * Dry-Run 步骤信息
 */
export interface DryRunStep {
  /** 步骤索引 */
  index: number;
  /** 步骤动作 */
  action: string;
  /** 步骤描述 */
  description?: string;
  /** 选择器（已解析） */
  selector?: string;
  /** 参数（已解析） */
  args?: Record<string, unknown>;
  /** 条件表达式 */
  when?: string;
  /** 是否会执行（基于条件判断） */
  willExecute: boolean;
  /** 超时时间 */
  timeout?: number;
  /** 重试次数 */
  retry?: number;
  /** 错误处理策略 */
  onError?: string;
  /** 输出字段名 */
  output?: string;
  /** 子步骤（fallback） */
  fallback?: DryRunStep[];
}

/**
 * Dry-Run 结果
 */
export interface DryRunResult {
  /** 操作名称 */
  action: string;
  /** 命名空间 */
  namespace: string;
  /** 参数（已解析） */
  params: Record<string, unknown>;
  /** 执行计划 */
  steps: DryRunStep[];
  /** 预期返回值表达式 */
  returns?: string;
  /** 验证条件表达式 */
  verify?: string;
  /** 总步骤数 */
  totalSteps: number;
  /** 将执行的步骤数 */
  stepsToExecute: number;
}

/**
 * Dry-Run 执行器
 */
export class DryRunner {
  /**
   * 执行 Dry-Run 分析
   */
  static analyze(
    definition: ActionDefinition,
    params: Record<string, unknown>,
    options: DryRunOptions = {}
  ): DryRunResult {
    const context: ExecutionContext = {
      params,
      selectors: {},
      env: process.env as Record<string, string>,
      steps: {},
      depth: 0,
      startTime: Date.now(),
      actionTimeout: 300000,
      stepTimeout: 30000,
      debugMode: false,
      dryRun: true,
    };

    const steps = this.analyzeSteps(definition.steps, context, {}, options);

    const result: DryRunResult = {
      action: definition.name || 'unknown',
      namespace: definition.namespace || 'unknown',
      params,
      steps,
      returns: definition.returns ? JSON.stringify(definition.returns) : undefined,
      verify: definition.verify?.[0]?.condition,
      totalSteps: steps.length,
      stepsToExecute: steps.filter((s) => s.willExecute).length,
    };

    return result;
  }

  /**
   * 分析步骤列表
   */
  private static analyzeSteps(
    steps: ActionStep[],
    context: ExecutionContext,
    selectors: Record<string, unknown>,
    options: DryRunOptions,
    depth = 0
  ): DryRunStep[] {
    return steps.map((step, index) => {
      // 判断是否会执行（基于 when 条件）
      let willExecute = true;
      if (step.when && options.evaluateConditions) {
        try {
          const resolved = options.resolveVariables
            ? (resolveObject(step.when, context) as string)
            : step.when;
          const result = evaluateExpression(resolved, context);
          willExecute = Boolean(result);
        } catch {
          // 如果条件评估失败，假定会执行
          willExecute = true;
        }
      }

      // 解析选择器（从 args 中获取）
      let selector: string | undefined;
      const selectorArg = step.args?.selector as string | undefined;
      if (selectorArg) {
        selector = options.resolveVariables
          ? (resolveObject(selectorArg, { ...context, selectors }) as string)
          : selectorArg;
      }

      // 解析参数
      let args: Record<string, unknown> | undefined;
      if (step.args) {
        args = options.resolveVariables
          ? (resolveObject(step.args, context) as Record<string, unknown>)
          : step.args;
      }

      // 分析 fallback 步骤
      let fallback: DryRunStep[] | undefined;
      if (step.fallback && step.fallback.length > 0) {
        fallback = this.analyzeSteps(step.fallback, context, selectors, options, depth + 1);
      }

      return {
        index,
        action: step.action,
        description: (step as any).description,
        selector,
        args,
        when: step.when,
        willExecute,
        timeout: step.timeout,
        retry: step.retry,
        onError: step.onError,
        output: step.output,
        fallback,
      };
    });
  }

  /**
   * 格式化 Dry-Run 结果为可读文本
   */
  static format(result: DryRunResult, options?: { verbose?: boolean }): string {
    const lines: string[] = [];

    lines.push(`\n=== Dry-Run: ${result.namespace}:${result.action} ===\n`);

    // 参数
    if (Object.keys(result.params).length > 0) {
      lines.push('Parameters:');
      for (const [key, value] of Object.entries(result.params)) {
        lines.push(`  ${key}: ${JSON.stringify(value)}`);
      }
      lines.push('');
    }

    // 执行计划
    lines.push(
      `Execution Plan: (${result.stepsToExecute}/${result.totalSteps} steps will execute)`
    );
    lines.push('');

    result.steps.forEach((step, index) => {
      this.formatStep(step, lines, options?.verbose ? 2 : 0, index + 1);
    });

    // 返回值
    if (result.returns) {
      lines.push(`\nReturns: ${result.returns}`);
    }

    // 验证
    if (result.verify) {
      lines.push(`Verify: ${result.verify}`);
    }

    return lines.join('\n');
  }

  /**
   * 格式化单个步骤
   */
  private static formatStep(
    step: DryRunStep,
    lines: string[],
    indent: number,
    number: number
  ): void {
    const prefix = ' '.repeat(indent);
    const status = step.willExecute ? '✓' : '✗';

    lines.push(`${prefix}${number}. [${status}] ${step.action}`);

    if (step.description) {
      lines.push(`${prefix}   Description: ${step.description}`);
    }

    if (step.selector) {
      lines.push(`${prefix}   Selector: ${step.selector}`);
    }

    if (step.args) {
      lines.push(`${prefix}   Args: ${JSON.stringify(step.args)}`);
    }

    if (step.when) {
      lines.push(`${prefix}   When: ${step.when}`);
    }

    if (step.timeout) {
      lines.push(`${prefix}   Timeout: ${step.timeout}ms`);
    }

    if (step.retry) {
      lines.push(`${prefix}   Retry: ${step.retry}`);
    }

    if (step.onError) {
      lines.push(`${prefix}   OnError: ${step.onError}`);
    }

    if (step.output) {
      lines.push(`${prefix}   Output: ${step.output}`);
    }

    if (step.fallback && step.fallback.length > 0) {
      lines.push(`${prefix}   Fallback:`);
      step.fallback.forEach((fb, idx) => {
        this.formatStep(fb, lines, indent + 4, idx + 1);
      });
    }

    lines.push('');
  }
}

/**
 * Debug 日志级别
 */
export enum DebugLevel {
  ERROR = 0,
  WARN = 1,
  INFO = 2,
  DEBUG = 3,
  TRACE = 4,
}

/**
 * Debug 日志器
 */
export class DebugLogger {
  private level: DebugLevel;
  private logs: Array<{ level: DebugLevel; message: string; timestamp: number }> = [];

  constructor(level: DebugLevel = DebugLevel.INFO) {
    this.level = level;
  }

  /**
   * 设置日志级别
   */
  setLevel(level: DebugLevel): void {
    this.level = level;
  }

  /**
   * 记录错误
   */
  error(message: string, ...args: unknown[]): void {
    this.log(DebugLevel.ERROR, message, ...args);
  }

  /**
   * 记录警告
   */
  warn(message: string, ...args: unknown[]): void {
    this.log(DebugLevel.WARN, message, ...args);
  }

  /**
   * 记录信息
   */
  info(message: string, ...args: unknown[]): void {
    this.log(DebugLevel.INFO, message, ...args);
  }

  /**
   * 记录调试信息
   */
  debug(message: string, ...args: unknown[]): void {
    this.log(DebugLevel.DEBUG, message, ...args);
  }

  /**
   * 记录追踪信息
   */
  trace(message: string, ...args: unknown[]): void {
    this.log(DebugLevel.TRACE, message, ...args);
  }

  /**
   * 记录日志
   */
  private log(level: DebugLevel, message: string, ...args: unknown[]): void {
    if (level > this.level) {
      return;
    }

    const timestamp = Date.now();
    const formattedMessage =
      args.length > 0 ? `${message} ${args.map((a) => JSON.stringify(a)).join(' ')}` : message;

    this.logs.push({ level, message: formattedMessage, timestamp });

    // 输出到控制台
    const levelName = DebugLevel[level];
    const prefix = `[${levelName}] [${new Date(timestamp).toISOString()}]`;

    switch (level) {
      case DebugLevel.ERROR:
        console.error(`${prefix} ${formattedMessage}`);
        break;
      case DebugLevel.WARN:
        console.warn(`${prefix} ${formattedMessage}`);
        break;
      default:
        console.log(`${prefix} ${formattedMessage}`);
    }
  }

  /**
   * 获取所有日志
   */
  getLogs(): Array<{ level: DebugLevel; message: string; timestamp: number }> {
    return [...this.logs];
  }

  /**
   * 清空日志
   */
  clear(): void {
    this.logs = [];
  }

  /**
   * 脱敏敏感参数
   */
  static sanitize(
    params: Record<string, unknown>,
    secretKeys: Set<string>
  ): Record<string, unknown> {
    const sanitized: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(params)) {
      if (secretKeys.has(key)) {
        sanitized[key] = '***';
      } else if (typeof value === 'object' && value !== null) {
        sanitized[key] = this.sanitize(value as Record<string, unknown>, secretKeys);
      } else {
        sanitized[key] = value;
      }
    }

    return sanitized;
  }
}

/**
 * Step Tracer - 追踪步骤执行
 */
export class StepTracer {
  private traces: Map<number, StepTrace> = new Map();
  private startTime: number = 0;

  /**
   * 开始追踪
   */
  start(): void {
    this.startTime = Date.now();
    this.traces.clear();
  }

  /**
   * 记录步骤开始
   */
  stepStart(index: number, step: ActionStep): void {
    this.traces.set(index, {
      index,
      action: step.action,
      startTime: Date.now(),
      endTime: 0,
      success: false,
    });
  }

  /**
   * 记录步骤成功
   */
  stepSuccess(index: number, result?: unknown): void {
    const trace = this.traces.get(index);
    if (trace) {
      trace.success = true;
      trace.endTime = Date.now();
      trace.output = result;
    }
  }

  /**
   * 记录步骤失败
   */
  stepFailure(index: number, error: Error): void {
    const trace = this.traces.get(index);
    if (trace) {
      trace.success = false;
      trace.endTime = Date.now();
      trace.error = error.message;
    }
  }

  /**
   * 记录步骤跳过
   */
  stepSkipped(index: number, reason: string): void {
    const trace = this.traces.get(index);
    if (trace) {
      trace.success = false;
      trace.endTime = Date.now();
      trace.error = reason;
    }
  }

  /**
   * 获取所有追踪信息
   */
  getTraces(): StepTrace[] {
    return Array.from(this.traces.values()).sort((a, b) => a.index - b.index);
  }

  /**
   * 获取执行时间线
   */
  getTimeline(): string {
    const traces = this.getTraces();
    const lines: string[] = [];

    lines.push('\n=== Execution Timeline ===\n');

    traces.forEach((trace) => {
      const status = trace.success ? '✓' : '✗';
      const duration = trace.endTime > 0 ? `${trace.endTime - trace.startTime}ms` : 'running';

      lines.push(`${status} Step ${trace.index}: ${trace.action} (${duration})`);

      if (trace.output !== undefined) {
        lines.push(`  Result: ${JSON.stringify(trace.output)}`);
      }

      if (trace.error) {
        lines.push(`  Error: ${trace.error}`);
      }
    });

    const totalDuration = Date.now() - this.startTime;
    lines.push(`\nTotal Duration: ${totalDuration}ms`);

    return lines.join('\n');
  }

  /**
   * 获取统计信息
   */
  getStats(): {
    total: number;
    success: number;
    failed: number;
    totalDuration: number;
    avgDuration: number;
  } {
    const traces = this.getTraces();
    const stats = {
      total: traces.length,
      success: 0,
      failed: 0,
      totalDuration: Date.now() - this.startTime,
      avgDuration: 0,
    };

    let durationSum = 0;
    let durationCount = 0;

    traces.forEach((trace) => {
      if (trace.success) {
        stats.success++;
      } else {
        stats.failed++;
      }

      if (trace.endTime > 0) {
        const duration = trace.endTime - trace.startTime;
        durationSum += duration;
        durationCount++;
      }
    });

    stats.avgDuration = durationCount > 0 ? durationSum / durationCount : 0;

    return stats;
  }
}

/**
 * 上下文转储器
 */
export class ContextDumper {
  /**
   * 转储执行上下文
   */
  static dump(context: ExecutionContext, secretKeys?: Set<string>): string {
    const lines: string[] = [];

    lines.push('\n=== Execution Context ===\n');

    // 参数
    lines.push('Parameters:');
    const params = secretKeys ? DebugLogger.sanitize(context.params, secretKeys) : context.params;
    lines.push(JSON.stringify(params, null, 2));
    lines.push('');

    // 选择器
    if (Object.keys(context.selectors).length > 0) {
      lines.push('Selectors:');
      lines.push(JSON.stringify(context.selectors, null, 2));
      lines.push('');
    }

    // 步骤输出
    if (Object.keys(context.steps).length > 0) {
      lines.push('Step Outputs:');
      lines.push(JSON.stringify(context.steps, null, 2));
      lines.push('');
    }

    // 环境变量（部分）
    const relevantEnv = Object.entries(context.env)
      .filter(([key]) => key.startsWith('AGENT_BROWSER_'))
      .reduce((acc, [key, value]) => ({ ...acc, [key]: value }), {});

    if (Object.keys(relevantEnv).length > 0) {
      lines.push('Environment Variables:');
      lines.push(JSON.stringify(relevantEnv, null, 2));
    }

    return lines.join('\n');
  }
}
