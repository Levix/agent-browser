/**
 * 错误处理与错误类型定义
 * 提供统一的错误码、错误映射和错误建议功能
 */

/**
 * 操作错误码枚举
 */
export enum ActionErrorCode {
  // 基础错误
  ACTION_NOT_FOUND = 'ACTION_NOT_FOUND',
  VALIDATION_ERROR = 'VALIDATION_ERROR',

  // 参数错误
  PARAM_MISSING = 'PARAM_MISSING',
  PARAM_TYPE_ERROR = 'PARAM_TYPE_ERROR',
  PARAM_INVALID = 'PARAM_INVALID',

  // 选择器错误
  SELECTOR_NOT_FOUND = 'SELECTOR_NOT_FOUND',
  ELEMENT_NOT_FOUND = 'ELEMENT_NOT_FOUND',
  MULTIPLE_ELEMENTS_FOUND = 'MULTIPLE_ELEMENTS_FOUND',

  // 执行错误
  TIMEOUT = 'TIMEOUT',
  STEP_FAILED = 'STEP_FAILED',
  VERIFY_FAILED = 'VERIFY_FAILED',

  // 表达式错误
  EXPRESSION_ERROR = 'EXPRESSION_ERROR',
  EXPRESSION_SYNTAX_ERROR = 'EXPRESSION_SYNTAX_ERROR',
  EXPRESSION_EVAL_ERROR = 'EXPRESSION_EVAL_ERROR',

  // 资源限制错误
  MAX_DEPTH_EXCEEDED = 'MAX_DEPTH_EXCEEDED',
  MAX_STEPS_EXCEEDED = 'MAX_STEPS_EXCEEDED',
  ACTION_TIMEOUT = 'ACTION_TIMEOUT',

  // 循环引用错误
  CIRCULAR_DEPENDENCY = 'CIRCULAR_DEPENDENCY',
  RECURSIVE_CALL = 'RECURSIVE_CALL',

  // 网络错误
  NETWORK_ERROR = 'NETWORK_ERROR',
  NAVIGATION_ERROR = 'NAVIGATION_ERROR',

  // 浏览器错误
  BROWSER_ERROR = 'BROWSER_ERROR',
  PAGE_CRASHED = 'PAGE_CRASHED',

  // 文件错误
  FILE_NOT_FOUND = 'FILE_NOT_FOUND',
  FILE_READ_ERROR = 'FILE_READ_ERROR',
  FILE_PARSE_ERROR = 'FILE_PARSE_ERROR',

  // 未知错误
  UNKNOWN_ERROR = 'UNKNOWN_ERROR',
}

/**
 * 操作错误接口
 */
export interface ActionError extends Error {
  code: ActionErrorCode;
  step?: string | number;
  action?: string;
  sourcePath?: string;
  details?: Record<string, unknown>;
  suggestion?: string;
  stack?: string;
  cause?: Error;
}

/**
 * 创建操作错误
 */
export function createActionError(
  code: ActionErrorCode,
  message: string,
  options?: {
    step?: string | number;
    action?: string;
    sourcePath?: string;
    details?: Record<string, unknown>;
    suggestion?: string;
    cause?: Error;
  }
): ActionError {
  const error = new Error(message) as ActionError;
  error.code = code;
  error.step = options?.step;
  error.action = options?.action;
  error.sourcePath = options?.sourcePath;
  error.details = options?.details;
  error.suggestion = options?.suggestion;
  error.cause = options?.cause;

  // 保留原始错误堆栈
  if (options?.cause) {
    error.stack = `${error.stack}\nCaused by: ${options.cause.stack}`;
  }

  return error;
}

/**
 * Playwright 错误映射表
 */
const PLAYWRIGHT_ERROR_PATTERNS: Array<{
  pattern: RegExp;
  code: ActionErrorCode;
  getSuggestion?: (match: RegExpMatchArray) => string;
}> = [
  {
    pattern: /Timeout \d+ms exceeded/i,
    code: ActionErrorCode.TIMEOUT,
    getSuggestion: () => '尝试增加 timeout 参数，或检查选择器是否正确',
  },
  {
    pattern: /waiting for (selector|locator) "(.*?)" to be visible/i,
    code: ActionErrorCode.ELEMENT_NOT_FOUND,
    getSuggestion: (match) =>
      `元素选择器 "${match[2]}" 未找到，请检查选择器是否正确或等待时间是否足够`,
  },
  {
    pattern: /strict mode violation: (.*?) resolved to (\d+) elements/i,
    code: ActionErrorCode.MULTIPLE_ELEMENTS_FOUND,
    getSuggestion: (match) =>
      `选择器 "${match[1]}" 匹配了 ${match[2]} 个元素，请使用更精确的选择器`,
  },
  {
    pattern: /Navigation failed because page was closed/i,
    code: ActionErrorCode.PAGE_CRASHED,
    getSuggestion: () => '页面已关闭，可能是浏览器崩溃或页面被意外关闭',
  },
  {
    pattern: /net::ERR_/i,
    code: ActionErrorCode.NETWORK_ERROR,
    getSuggestion: () => '网络请求失败，请检查网络连接或目标 URL 是否正确',
  },
  {
    pattern: /Navigation timeout of \d+ms exceeded/i,
    code: ActionErrorCode.NAVIGATION_ERROR,
    getSuggestion: () => '页面导航超时，尝试增加超时时间或检查目标 URL',
  },
  {
    pattern: /Target page, context or browser has been closed/i,
    code: ActionErrorCode.BROWSER_ERROR,
    getSuggestion: () => '浏览器、上下文或页面已被关闭',
  },
];

/**
 * 将 Playwright 错误映射为 ActionError
 */
export function mapPlaywrightError(
  error: Error,
  options?: {
    step?: string | number;
    action?: string;
    sourcePath?: string;
  }
): ActionError {
  const errorMessage = error.message;

  // 尝试匹配已知的 Playwright 错误模式
  for (const { pattern, code, getSuggestion } of PLAYWRIGHT_ERROR_PATTERNS) {
    const match = errorMessage.match(pattern);
    if (match) {
      return createActionError(code, errorMessage, {
        ...options,
        suggestion: getSuggestion?.(match),
        cause: error,
      });
    }
  }

  // 未匹配到已知模式，返回通用错误
  return createActionError(ActionErrorCode.BROWSER_ERROR, errorMessage, {
    ...options,
    suggestion: '浏览器操作失败，请查看详细错误信息',
    cause: error,
  });
}

/**
 * 错误建议生成器
 */
export class ErrorSuggestionGenerator {
  /**
   * 为错误生成修复建议
   */
  static generate(error: ActionError): string {
    // 如果已有建议，直接返回
    if (error.suggestion) {
      return error.suggestion;
    }

    // 根据错误码生成建议
    switch (error.code) {
      case ActionErrorCode.ACTION_NOT_FOUND:
        return '使用 `action list` 命令查看可用的操作';

      case ActionErrorCode.VALIDATION_ERROR:
        return '使用 `action validate <file>` 命令检查 YAML 文件是否符合 schema';

      case ActionErrorCode.PARAM_MISSING:
        return '使用 `action describe <action>` 查看必需的参数列表';

      case ActionErrorCode.PARAM_TYPE_ERROR:
        return '检查参数类型是否匹配，使用 `action describe <action>` 查看参数定义';

      case ActionErrorCode.SELECTOR_NOT_FOUND:
        return '检查 selectors 定义中是否包含引用的选择器';

      case ActionErrorCode.ELEMENT_NOT_FOUND:
        return '尝试使用 fallback 选择器，或增加等待时间';

      case ActionErrorCode.TIMEOUT:
        return '增加 timeout 参数值，或优化选择器以更快找到元素';

      case ActionErrorCode.VERIFY_FAILED:
        return '检查 verify 条件是否正确，使用 dry-run 模式预览执行流程';

      case ActionErrorCode.EXPRESSION_ERROR:
        return '检查表达式语法是否正确，避免使用不支持的操作符';

      case ActionErrorCode.MAX_DEPTH_EXCEEDED:
        return '减少递归调用层数，或增加 max_depth 配置';

      case ActionErrorCode.MAX_STEPS_EXCEEDED:
        return '简化操作步骤，或增加 max_steps 配置';

      case ActionErrorCode.CIRCULAR_DEPENDENCY:
        return '检查 action 定义中是否存在循环依赖';

      case ActionErrorCode.NETWORK_ERROR:
        return '检查网络连接，确认目标服务是否可访问';

      case ActionErrorCode.FILE_NOT_FOUND:
        return '检查文件路径是否正确，确认文件是否存在';

      default:
        return '查看详细错误信息，使用 debug 模式获取更多诊断信息';
    }
  }

  /**
   * 生成错误上下文信息
   */
  static formatContext(error: ActionError): string {
    const parts: string[] = [];

    if (error.action) {
      parts.push(`Action: ${error.action}`);
    }

    if (error.step !== undefined) {
      parts.push(`Step: ${error.step}`);
    }

    if (error.sourcePath) {
      parts.push(`Source: ${error.sourcePath}`);
    }

    if (error.details && Object.keys(error.details).length > 0) {
      parts.push(`Details: ${JSON.stringify(error.details, null, 2)}`);
    }

    return parts.join('\n');
  }

  /**
   * 格式化错误信息（用于输出）
   */
  static format(error: ActionError, options?: { includeStack?: boolean }): string {
    const lines: string[] = [];

    // 错误标题
    lines.push(`\n[${error.code}] ${error.message}\n`);

    // 上下文信息
    const context = this.formatContext(error);
    if (context) {
      lines.push(context);
      lines.push('');
    }

    // 建议
    const suggestion = this.generate(error);
    if (suggestion) {
      lines.push(`💡 Suggestion: ${suggestion}`);
      lines.push('');
    }

    // 堆栈信息（可选）
    if (options?.includeStack && error.stack) {
      lines.push('Stack Trace:');
      lines.push(error.stack);
    }

    return lines.join('\n');
  }
}

/**
 * 检查是否为 ActionError
 */
export function isActionError(error: unknown): error is ActionError {
  return (
    error instanceof Error && 'code' in error && typeof (error as ActionError).code === 'string'
  );
}

/**
 * 将任意错误转换为 ActionError
 */
export function normalizeError(
  error: unknown,
  options?: {
    step?: string | number;
    action?: string;
    sourcePath?: string;
  }
): ActionError {
  // 已经是 ActionError
  if (isActionError(error)) {
    return error;
  }

  // Error 对象
  if (error instanceof Error) {
    return mapPlaywrightError(error, options);
  }

  // 字符串错误
  if (typeof error === 'string') {
    return createActionError(ActionErrorCode.UNKNOWN_ERROR, error, options);
  }

  // 其他类型
  return createActionError(ActionErrorCode.UNKNOWN_ERROR, String(error), options);
}
