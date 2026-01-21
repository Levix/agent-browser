# Action Executor

Core execution engine for semantic actions that orchestrates step-by-step execution with variable interpolation, error handling, and resource management.

## Overview

The Action Executor is responsible for:

- **Step-by-step execution** - Sequential execution of action steps with condition evaluation
- **Variable interpolation** - Dynamic resolution of `${params}`, `${env}`, `${steps}`, and `${selectors}`
- **Error handling** - Retry mechanisms, fallback strategies, and error propagation
- **Resource limits** - Recursion depth, step count, and timeout enforcement
- **Debug & dry-run** - Detailed tracing and validation without execution

## Architecture

```
ActionExecutor
├── Configuration (ExecutorConfig)
├── Registry Integration (ActionRegistry)
├── Page Context (Playwright Page)
└── Execution Pipeline
    ├── Context Initialization
    ├── Step Execution Loop
    │   ├── Condition Evaluation (when)
    │   ├── Variable Resolution (${...})
    │   ├── Retry Logic
    │   ├── Fallback Handling
    │   └── Output Storage
    ├── Return Value Evaluation
    └── Post-condition Verification
```

## Quick Start

### Basic Usage

```typescript
import { ActionExecutor } from './executor.js';
import { ActionRegistry } from './registry.js';
import { chromium } from 'playwright-core';

// Create executor
const executor = new ActionExecutor({
  maxDepth: 10,
  maxSteps: 100,
  stepTimeout: 30000,
  debugMode: true
});

// Set up registry and page
const registry = new ActionRegistry();
await registry.load('path/to/actions');
executor.setRegistry(registry);

const browser = await chromium.launch();
const page = await browser.newPage();
executor.setPage(page);

// Execute action
const result = await executor.execute(
  action,
  { username: 'test@example.com', password: 'secret' },
  { API_URL: 'https://api.example.com' }
);

if (result.success) {
  console.log('Action completed:', result.data);
} else {
  console.error('Action failed:', result.error);
}
```

### Dry-Run Mode

```typescript
// Validate action without execution
const dryRunResult = await executor.dryRun(
  action,
  { url: 'https://example.com' }
);

if (dryRunResult.success) {
  console.log('Action is valid');
  console.log('Steps to execute:', dryRunResult.steps.length);
  
  dryRunResult.steps.forEach(step => {
    console.log(`- ${step.action}:`, step.willExecute ? 'will run' : step.skipReason);
  });
}
```

## Configuration

### ExecutorConfig Options

```typescript
interface ExecutorConfig {
  /** Maximum recursion depth for nested action calls (default: 10) */
  maxDepth?: number;

  /** Maximum steps per action execution (default: 100) */
  maxSteps?: number;

  /** Default timeout for each step in milliseconds (default: 30000) */
  stepTimeout?: number;

  /** Total action timeout in milliseconds (default: 300000 = 5min) */
  actionTimeout?: number;

  /** Enable debug mode with detailed logging (default: false) */
  debugMode?: boolean;

  /** Enable dry-run mode - parse only, no execution (default: false) */
  dryRun?: boolean;
}
```

### Default Values

```typescript
{
  maxDepth: 10,
  maxSteps: 100,
  stepTimeout: 30000,      // 30 seconds
  actionTimeout: 300000,   // 5 minutes
  debugMode: false,
  dryRun: false
}
```

## Step Execution

### Supported Actions

The executor handles these built-in step actions:

| Action | Description | Required Args | Optional Args |
|--------|-------------|---------------|---------------|
| `open` | Navigate to URL | `url` | - |
| `click` | Click element | `selector` or `use` | - |
| `fill` | Fill input field | `selector`/`use`, `value` | - |
| `type` | Type text with delay | `selector`/`use`, `text` | `delay` |
| `press` | Press keyboard key | `key` | `selector`/`use` |
| `wait` | Wait for condition | `time`/`selector`/`load` | - |
| `snapshot` | Capture page state | - | - |
| `eval` | Evaluate JavaScript | `expression` | - |
| `find` | Find element | `selector` or `use` | - |
| `run` | Call nested action | `action`, ...params | - |
| `fail` | Explicit failure | `message` | - |

### Condition Evaluation

Steps can include `when` conditions for conditional execution:

```yaml
steps:
  - action: click
    use: submitButton
    when: "${steps.username.filled} && ${steps.password.filled}"
```

Conditions support:
- Variable references: `${params.enabled}`, `${steps.result.success}`
- Comparison operators: `==`, `!=`, `>`, `<`, `>=`, `<=`
- Logical operators: `&&`, `||`, `!`
- JavaScript expressions: evaluated with expression evaluator

### Variable Interpolation

Variables are resolved using `${scope.path}` syntax:

```yaml
steps:
  - action: open
    args:
      url: "${env.BASE_URL}/login"
  
  - action: fill
    use: emailInput
    args:
      value: "${params.email}"
    output: emailFilled
  
  - action: click
    use: submitButton
    when: "${steps.emailFilled.filled}"
```

Available scopes:
- `params` - Action parameters
- `env` - Environment variables
- `steps` - Previous step outputs
- `selectors` - Named selectors from namespace

## Error Handling

### Error Strategies

Configure error handling per step using `onError`:

```yaml
steps:
  # Abort on error (default)
  - action: click
    use: optionalButton
    onError: abort
  
  # Continue execution despite error
  - action: click
    use: dismissModal
    onError: continue
  
  # Try fallback steps
  - action: click
    use: primaryButton
    onError: fallback
    fallback:
      - action: click
        use: secondaryButton
```

### Retry Mechanism

Configure retries with exponential backoff:

```yaml
steps:
  - action: click
    use: flakySaveButton
    retry: 3              # Try up to 4 times total (1 + 3 retries)
    retryDelay: 1000      # Start with 1 second, doubles each retry
```

Retry delays: 1s → 2s → 4s

### Error Types

```typescript
interface ActionError {
  code: ActionErrorCode;
  message: string;
  action: string;
  step?: number;
  stepAction?: string;
  details?: Record<string, unknown>;
  suggestion?: string;
}

type ActionErrorCode =
  | 'ACTION_NOT_FOUND'
  | 'STEP_FAILED'
  | 'MAX_DEPTH_EXCEEDED'
  | 'MAX_STEPS_EXCEEDED'
  | 'TIMEOUT'
  | 'VERIFY_FAILED'
  | 'EXPRESSION_ERROR'
  | 'SELECTOR_NOT_FOUND';
```

## Nested Action Calls

Execute other actions using the `run` step:

```yaml
actions:
  login:
    steps:
      - action: run
        args:
          action: auth/navigateToLogin
          url: "${env.BASE_URL}"
      
      - action: run
        args:
          action: auth/fillCredentials
          username: "${params.username}"
          password: "${params.password}"
      
      - action: run
        args:
          action: auth/submitForm
```

**Recursion Limits:**
- Default max depth: 10 levels
- Configurable via `maxDepth` option
- Throws `MAX_DEPTH_EXCEEDED` error when exceeded

## Return Values

Actions can return data using the `returns` field:

```yaml
actions:
  getUserProfile:
    returns:
      userId: "${steps.extractId.output}"
      username: "${params.username}"
      success: "${steps.verify.found}"
    
    steps:
      - action: find
        use: userIdElement
        output: extractId
      
      - action: find
        use: profileLoaded
        output: verify
```

**Type Preservation:**
- Direct variable references preserve original types
- Complex expressions may convert to strings
- Use simple `${steps.name}` for type safety

## Post-condition Verification

Verify action results after execution:

```yaml
actions:
  createAccount:
    steps:
      # ... account creation steps
    
    verify:
      - condition: "${steps.accountCreated.success}"
        message: "Account creation failed"
      
      - condition: "${steps.confirmationShown.found}"
        message: "Confirmation page not displayed"
```

Verification failures throw `VERIFY_FAILED` errors.

## Execution Context

Context flows through the execution pipeline:

```typescript
interface ExecutionContext {
  params: Record<string, unknown>;      // Action parameters
  env: Record<string, string>;          // Environment variables
  selectors: Record<string, any>;       // Resolved selectors
  steps: Record<string, unknown>;       // Step outputs
  depth: number;                        // Current recursion depth
  startTime: number;                    // Execution start timestamp
  actionTimeout: number;                // Total timeout (ms)
  stepTimeout: number;                  // Per-step timeout (ms)
  debugMode: boolean;                   // Debug logging enabled
  dryRun: boolean;                      // Dry-run mode enabled
}
```

## Execution Trace

Every execution returns a detailed trace:

```typescript
interface ActionResult {
  success: boolean;
  data?: Record<string, unknown>;     // Return values
  error?: ActionError;                 // Error details
  trace: StepTrace[];                  // Execution trace
}

interface StepTrace {
  index: number;                       // Step index
  action: string;                      // Step action type
  startTime: number;                   // Start timestamp
  endTime: number;                     // End timestamp
  success: boolean;                    // Success flag
  output?: unknown;                    // Step output
  error?: string;                      // Error message
}
```

Use traces for:
- Debugging failed executions
- Performance analysis
- Audit trails
- Replay/reproduction

## Debug Mode

Enable debug mode for detailed logging:

```typescript
const executor = new ActionExecutor({
  debugMode: true
});
```

Debug output includes:
- Action start/completion
- Step execution details
- Parameter values
- Selector resolution
- Variable interpolation
- Error details
- Timing information

## Timeout Management

### Action-level Timeout

Overall timeout for entire action execution:

```typescript
const executor = new ActionExecutor({
  actionTimeout: 300000  // 5 minutes total
});
```

Throws error if exceeded, regardless of step progress.

### Step-level Timeout

Default timeout for each step:

```typescript
const executor = new ActionExecutor({
  stepTimeout: 30000  // 30 seconds per step
});
```

Can be overridden per step:

```yaml
steps:
  - action: wait
    args:
      load: networkidle
    timeout: 60000  # 60 seconds for this step
```

## Selector Integration

The executor integrates with the selector fallback system:

```typescript
// Uses executeWithFallback from selectors.ts
const result = await executeWithFallback(page, selector, {
  timeout,
  debugMode: context.debugMode
});
```

**Selector Resolution:**
1. Direct selectors: `{ selector: "button.submit" }`
2. Named selectors: `{ use: "submitButton" }` from namespace
3. Fallback chains: automatic fallback through selector alternatives

See [README.selectors.md](./README.selectors.md) for details.

## Integration Example

Complete example with registry and page:

```typescript
import { ActionExecutor } from './executor.js';
import { ActionRegistry } from './registry.js';
import { chromium } from 'playwright-core';

async function runAction() {
  // Initialize
  const registry = new ActionRegistry();
  await registry.load('./actions');
  
  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage();
  
  const executor = new ActionExecutor({
    maxDepth: 10,
    stepTimeout: 30000,
    debugMode: process.env.DEBUG === 'true'
  });
  
  executor.setRegistry(registry);
  executor.setPage(page);
  
  // Execute
  try {
    const action = registry.get('auth/login');
    if (!action) {
      throw new Error('Action not found');
    }
    
    const result = await executor.execute(
      action,
      {
        username: 'user@example.com',
        password: 'secret123'
      },
      {
        BASE_URL: 'https://app.example.com'
      }
    );
    
    if (result.success) {
      console.log('Login successful:', result.data);
    } else {
      console.error('Login failed:', result.error);
      console.log('Trace:', result.trace);
    }
  } finally {
    await browser.close();
  }
}

runAction().catch(console.error);
```

## Best Practices

### 1. Set Appropriate Limits

```typescript
const executor = new ActionExecutor({
  maxDepth: 5,        // Limit nesting for complex flows
  maxSteps: 50,       // Prevent infinite loops
  stepTimeout: 15000, // Faster feedback for tests
});
```

### 2. Use Dry-Run for Validation

```typescript
// Validate before executing
const dryRun = await executor.dryRun(action, params);
if (!dryRun.success) {
  console.error('Validation failed:', dryRun.error);
  return;
}

// Execute if valid
const result = await executor.execute(action, params);
```

### 3. Store Step Outputs

```yaml
steps:
  - action: fill
    use: emailInput
    args:
      value: "${params.email}"
    output: emailStep  # Store for later reference
  
  - action: click
    use: submitButton
    when: "${steps.emailStep.filled}"
```

### 4. Handle Errors Gracefully

```yaml
steps:
  # Try primary path
  - action: click
    use: cookieAccept
    onError: continue  # Don't fail if cookie banner absent
  
  # Critical step with retries
  - action: click
    use: submitButton
    retry: 2
    retryDelay: 1000
    onError: abort
```

### 5. Use Verification

```yaml
actions:
  checkout:
    steps:
      # ... checkout steps
    
    verify:
      - condition: "${steps.confirmation.found}"
        message: "Order confirmation not shown"
      
      - condition: "${steps.orderId.output}"
        message: "Order ID not captured"
```

## Troubleshooting

### Common Issues

**Q: "Maximum recursion depth exceeded"**

A: Reduce `maxDepth` or check for circular action references. Review nested `run` calls.

**Q: "Action timeout exceeded"**

A: Increase `actionTimeout` or optimize slow steps. Check for unnecessary waits.

**Q: "Selector not found"**

A: Verify selector definitions in namespace. Use fallback selectors. Enable `debugMode` to see resolution attempts.

**Q: "Variable not resolved"**

A: Check variable scope (`params`, `env`, `steps`, `selectors`). Ensure previous steps have `output` field.

**Q: "Step failed but should continue"**

A: Add `onError: continue` to step. Consider using fallback for alternative paths.

## Related Documentation

- [README.registry.md](./README.registry.md) - Action registry system
- [README.selectors.md](./README.selectors.md) - Selector fallback mechanism
- [README.loader.md](./README.loader.md) - YAML action loading
- [README.tokenizer.md](./README.tokenizer.md) - Variable interpolation details

## API Reference

### ActionExecutor

#### Constructor

```typescript
constructor(config?: ExecutorConfig)
```

#### Methods

```typescript
setRegistry(registry: ActionRegistry): void
setPage(page: Page): void
execute(action: ActionDefinition, params: Record<string, unknown>, env?: Record<string, string>): Promise<ActionResult>
dryRun(action: ActionDefinition, params: Record<string, unknown>, env?: Record<string, string>): Promise<DryRunResult>
```

### Types

See [types.ts](./types.ts) for complete type definitions:
- `ActionDefinition`
- `ActionStep`
- `ActionResult`
- `ActionError`
- `ExecutionContext`
- `StepTrace`
- `DryRunResult`
