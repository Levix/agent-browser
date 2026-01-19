/**
 * Core type definitions for the Semantic Actions system
 *
 * This module defines all the core interfaces and types used throughout
 * the actions system, including registry types, action definitions,
 * execution context, and error types.
 */

// ============================================================================
// Registry Types
// ============================================================================

/**
 * The main registry that holds all loaded action definitions
 */
export interface ActionRegistry {
  /** Namespaces indexed by namespace name */
  namespaces: Map<string, NamespaceDefinition>;

  /** Actions indexed by fully qualified name (e.g., "eresh:dialog:open") */
  index: Map<string, ActionDefinition>;
}

/**
 * A namespace groups related actions and provides shared selectors
 */
export interface NamespaceDefinition {
  /** Namespace identifier (e.g., "eresh", "common") */
  namespace: string;

  /** Semantic version of this namespace */
  version: string;

  /** Human-readable description */
  description: string;

  /** Version compatibility configuration */
  compatibility?: ActionCompatibility;

  /** Shared selector definitions for this namespace */
  selectors: Record<string, SelectorDefinition>;

  /** Action definitions in this namespace */
  actions: Record<string, ActionDefinition>;

  /** Source file path (for debugging) */
  sourcePath: string;
}

// ============================================================================
// Action Definition Types
// ============================================================================

/**
 * Complete definition of a semantic action
 */
export interface ActionDefinition {
  /** Action name within namespace (e.g., "dialog:open") */
  name: string;

  /** Namespace this action belongs to */
  namespace: string;

  /** Fully qualified name (e.g., "eresh:dialog:open") */
  fullName: string;

  /** Human-readable description */
  description: string;

  /** Version when this action was introduced */
  since?: string;

  /** Whether this action is deprecated */
  deprecated?: boolean;

  /** Deprecation message with migration guide */
  deprecatedMessage?: string;

  /** If this is an alias, points to the canonical action */
  aliasOf?: string;

  /** Parameter definitions */
  params: Record<string, ActionParam>;

  /** Execution steps */
  steps: ActionStep[];

  /** Return value mapping (variable expressions) */
  returns?: Record<string, string>;

  /** Post-execution verification conditions */
  verify?: VerifyCondition[];

  /** Version compatibility configuration */
  compatibility?: ActionCompatibility;

  /** Source file path (for debugging) */
  sourcePath: string;
}

/**
 * Parameter definition for an action
 */
export interface ActionParam {
  /** Parameter data type */
  type: 'string' | 'number' | 'boolean' | 'enum' | 'array' | 'object';

  /** Human-readable description */
  description: string;

  /** Whether this parameter is required */
  required: boolean;

  /** Default value if not provided */
  default?: unknown;

  /** Allowed values for enum type */
  values?: string[];

  /** Whether this is a secret (will be masked in logs) */
  secret?: boolean;
}

// ============================================================================
// Action Step Types
// ============================================================================

/**
 * A single execution step within an action
 */
export interface ActionStep {
  /** Step action type (e.g., "click", "fill", "wait", "run") */
  action: string;

  /** Arguments for this step (supports variable interpolation) */
  args: Record<string, unknown>;

  /** Conditional execution expression (e.g., "${method} == 'click'") */
  when?: string;

  /** Output variable name to store step result */
  output?: string;

  /** Step-specific timeout override (milliseconds) */
  timeout?: number;

  /** Number of retry attempts on failure */
  retry?: number;

  /** Delay between retries (milliseconds, default: 1000) */
  retryDelay?: number;

  /** Error handling strategy */
  onError?: 'continue' | 'abort' | 'fallback';

  /** Fallback steps to execute on error */
  fallback?: ActionStep[];
}

// ============================================================================
// Execution Context Types
// ============================================================================

/**
 * Runtime execution context passed through action execution
 */
export interface ExecutionContext {
  /** User-provided parameters */
  params: Record<string, unknown>;

  /** Environment variables */
  env: Record<string, string>;

  /** Resolved selectors (after version override) */
  selectors: Record<string, string>;

  /** Outputs from previous steps */
  steps: Record<string, unknown>;

  /** Current recursion depth (for run action) */
  depth: number;

  /** Action start timestamp */
  startTime: number;

  /** Total action timeout (milliseconds) */
  actionTimeout: number;

  /** Default step timeout (milliseconds) */
  stepTimeout: number;

  /** Whether debug mode is enabled */
  debugMode: boolean;

  /** Whether this is a dry-run (parse only, no execution) */
  dryRun: boolean;
}

/**
 * Result of an action execution
 */
export interface ActionResult {
  /** Whether the action succeeded */
  success: boolean;

  /** Returned data (from returns mapping) */
  data?: Record<string, unknown>;

  /** Error details if failed */
  error?: ActionError;

  /** Execution trace for debugging */
  trace?: StepTrace[];
}

/**
 * Trace record for a single step execution
 */
export interface StepTrace {
  /** Step index */
  index: number;

  /** Step action type */
  action: string;

  /** Start timestamp */
  startTime: number;

  /** End timestamp */
  endTime: number;

  /** Whether the step succeeded */
  success: boolean;

  /** Step output (if any) */
  output?: unknown;

  /** Error (if failed) */
  error?: string;
}

/**
 * Structured error information
 */
export interface ActionError {
  /** Error code for programmatic handling */
  code: ActionErrorCode;

  /** Human-readable error message */
  message: string;

  /** Action that failed (fully qualified name) */
  action: string;

  /** Step index where error occurred (if applicable) */
  step?: number;

  /** Step action that failed (if applicable) */
  stepAction?: string;

  /** Additional error details */
  details?: Record<string, unknown>;

  /** Suggestion for fixing the error */
  suggestion?: string;

  /** Original error stack trace (for debugging) */
  stack?: string;
}

/**
 * Standard error codes
 */
export enum ActionErrorCode {
  /** Action not found in registry */
  ACTION_NOT_FOUND = 'ACTION_NOT_FOUND',

  /** Validation error in action definition */
  VALIDATION_ERROR = 'VALIDATION_ERROR',

  /** Required parameter missing */
  PARAM_MISSING = 'PARAM_MISSING',

  /** Parameter type mismatch */
  PARAM_TYPE_ERROR = 'PARAM_TYPE_ERROR',

  /** Parameter enum value invalid */
  PARAM_ENUM_ERROR = 'PARAM_ENUM_ERROR',

  /** Unknown parameter provided */
  PARAM_UNKNOWN = 'PARAM_UNKNOWN',

  /** Selector not found in definition */
  SELECTOR_NOT_FOUND = 'SELECTOR_NOT_FOUND',

  /** Element not found on page */
  ELEMENT_NOT_FOUND = 'ELEMENT_NOT_FOUND',

  /** Operation timeout */
  TIMEOUT = 'TIMEOUT',

  /** Step execution failed */
  STEP_FAILED = 'STEP_FAILED',

  /** Verification condition failed */
  VERIFY_FAILED = 'VERIFY_FAILED',

  /** Expression evaluation error */
  EXPRESSION_ERROR = 'EXPRESSION_ERROR',

  /** Maximum recursion depth exceeded */
  MAX_DEPTH_EXCEEDED = 'MAX_DEPTH_EXCEEDED',

  /** Maximum steps limit exceeded */
  MAX_STEPS_EXCEEDED = 'MAX_STEPS_EXCEEDED',

  /** Component version incompatible */
  VERSION_INCOMPATIBLE = 'VERSION_INCOMPATIBLE',
}

// ============================================================================
// Selector Types
// ============================================================================

/**
 * Selector definition with optional fallback chain
 */
export type SelectorDefinition = string | SelectorWithFallback;

/**
 * Selector with primary and fallback options
 */
export interface SelectorWithFallback {
  /** Primary selector to try first */
  primary: string;

  /** Fallback selectors to try if primary fails */
  fallback: string[];
}

// ============================================================================
// Compatibility & Version Types
// ============================================================================

/**
 * Component version compatibility configuration
 */
export interface ActionCompatibility {
  /** Minimum compatible version (inclusive) */
  minVersion?: string;

  /** Maximum compatible version (inclusive) */
  maxVersion?: string;

  /** Version-specific overrides */
  versionOverrides?: Record<string, VersionOverride>;
}

/**
 * Version-specific configuration overrides
 */
export interface VersionOverride {
  /** Selector overrides for this version */
  selectors?: Record<string, string>;

  /** Step overrides (future) */
  steps?: Record<string, Partial<ActionStep>>;
}

// ============================================================================
// Verification Types
// ============================================================================

/**
 * Post-execution verification condition
 */
export interface VerifyCondition {
  /** Condition expression to evaluate */
  condition: string;

  /** Error message if condition fails */
  message: string;
}

// ============================================================================
// Validation Types
// ============================================================================

/**
 * Result of validation operation
 */
export interface ValidationResult {
  /** Whether validation passed */
  success: boolean;

  /** Validation errors (if any) */
  errors?: ValidationError[];

  /** Warnings (non-blocking issues) */
  warnings?: ValidationWarning[];
}

/**
 * Validation error details
 */
export interface ValidationError {
  /** Error code */
  code: string;

  /** Error message */
  message: string;

  /** Path to the problematic field */
  path?: string[];

  /** Suggested fix */
  suggestion?: string;
}

/**
 * Validation warning details
 */
export interface ValidationWarning {
  /** Warning code */
  code: string;

  /** Warning message */
  message: string;

  /** Path to the field */
  path?: string[];
}

// ============================================================================
// Configuration Types
// ============================================================================

/**
 * Global configuration for the actions system
 */
export interface ActionsConfig {
  /** Additional paths to load actions from */
  paths?: string[];

  /** NPM packages to load actions from */
  packages?: string[];

  /** Default timeout for actions (milliseconds) */
  defaultTimeout?: number;

  /** Maximum recursion depth */
  maxDepth?: number;

  /** Maximum steps per action */
  maxSteps?: number;

  /** Enable debug mode */
  debug?: boolean;

  /** Enable version detection */
  detectVersion?: boolean;
}

// ============================================================================
// API Response Types
// ============================================================================

/**
 * Response for action.list command
 */
export interface ActionListResponse {
  /** Namespaces and their actions */
  namespaces: NamespaceInfo[];
}

/**
 * Namespace information for listing
 */
export interface NamespaceInfo {
  /** Namespace identifier */
  namespace: string;

  /** Version */
  version: string;

  /** Description */
  description: string;

  /** Number of actions */
  actionCount: number;

  /** Action names */
  actions: string[];
}

/**
 * Response for action.search command
 */
export interface ActionSearchResponse {
  /** Matching actions */
  results: ActionSearchResult[];
}

/**
 * Search result for a single action
 */
export interface ActionSearchResult {
  /** Fully qualified action name */
  fullName: string;

  /** Namespace */
  namespace: string;

  /** Action name */
  name: string;

  /** Description */
  description: string;

  /** Whether deprecated */
  deprecated?: boolean;

  /** Relevance score */
  score: number;
}

/**
 * Response for action.validate command
 */
export interface ValidateResponse {
  /** Whether validation passed */
  success: boolean;

  /** Validation result */
  result: ValidationResult;

  /** File path */
  path: string;
}

/**
 * Response for action.reload command
 */
export interface ReloadResponse {
  /** Whether reload succeeded */
  success: boolean;

  /** Number of namespaces loaded */
  namespaceCount: number;

  /** Number of actions loaded */
  actionCount: number;

  /** Errors during reload (if any) */
  errors?: string[];
}

/**
 * Response for dry-run command
 */
export interface DryRunResult {
  /** Whether dry-run succeeded */
  success: boolean;

  /** Resolved action definition */
  action: ActionDefinition;

  /** Resolved execution context */
  context: ExecutionContext;

  /** Execution plan (resolved steps) */
  steps: ResolvedStep[];

  /** Errors during dry-run (if any) */
  error?: ActionError;
}

/**
 * Resolved step for dry-run
 */
export interface ResolvedStep {
  /** Step index */
  index: number;

  /** Step action */
  action: string;

  /** Resolved arguments (after interpolation) */
  args: Record<string, unknown>;

  /** Whether step will execute (after when condition) */
  willExecute: boolean;

  /** Conditional reason */
  skipReason?: string;
}
