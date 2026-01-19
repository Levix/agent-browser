# Selector Fallback Strategy

This document explains the selector fallback and retry mechanism in the Semantic Actions system.

## Overview

The selector fallback strategy provides automatic degradation when primary selectors fail to find elements. This is crucial for maintaining robustness across:

- Different component versions
- Browser variations
- DOM structure changes
- Dynamic content loading

## Basic Concepts

### Selector Definition Types

**Simple String Selector:**
```yaml
selectors:
  submit: "button[data-testid='submit']"
```

**Selector with Fallback Chain:**
```yaml
selectors:
  submit:
    primary: "button[data-testid='submit']"
    fallback:
      - "button.submit-button"
      - "button:has-text('Submit')"
      - "button[type='submit']"
```

### Execution Flow

1. **Primary Attempt**: Try the primary selector first
2. **Fallback Chain**: If primary fails, try each fallback in order
3. **Success**: Return the first successful locator
4. **Failure**: Throw error or return failure result

## Usage Examples

### Basic Usage

```typescript
import { executeWithFallback } from './actions/selectors.js';

// Execute with fallback
const result = await executeWithFallback(
  page,
  {
    primary: '[data-testid="submit"]',
    fallback: ['button.submit', 'button:has-text("Submit")']
  },
  { timeout: 5000 }
);

if (result.success) {
  await result.locator!.click();
}
```

### Convenience Function

```typescript
import { findWithFallback } from './actions/selectors.js';

// Returns locator or null (never throws)
const button = await findWithFallback(page, {
  primary: '[data-testid="submit"]',
  fallback: ['button.submit']
});

if (button) {
  await button.click();
}
```

### Retry with Fallback

```typescript
import { retryWithFallback } from './actions/selectors.js';

// Execute action with automatic retry
const result = await retryWithFallback(
  async (locator) => {
    await locator.click();
    return { clicked: true };
  },
  page,
  { primary: 'button', fallback: ['.btn'] },
  {
    timeout: 3000,
    maxRetries: 2,
    retryDelay: 1000,
    debugMode: true
  }
);
```

## Configuration Options

### SelectorExecutionOptions

```typescript
interface SelectorExecutionOptions {
  /** Timeout for each selector attempt (default: 5000ms) */
  timeout?: number;

  /** Whether to throw error if all selectors fail (default: true) */
  throwOnFailure?: boolean;

  /** Debug mode - log each attempt (default: false) */
  debugMode?: boolean;

  /** Maximum number of fallback attempts (default: unlimited) */
  maxFallbacks?: number;
}
```

### Example with Options

```typescript
const result = await executeWithFallback(
  page,
  selectorDef,
  {
    timeout: 3000,           // 3s per selector
    throwOnFailure: false,   // Return failure instead of throwing
    debugMode: true,         // Log all attempts
    maxFallbacks: 2          // Try primary + 2 fallbacks max
  }
);
```

## Integration with Version Overrides

Selector fallback works seamlessly with version-specific overrides:

```yaml
namespace: eresh
version: "3.0.0"

selectors:
  dialog_close:
    primary: "[data-testid='dialog-close']"
    fallback:
      - "button.dialog-close"
      - "[aria-label='Close']"

compatibility:
  min_version: "2.0.0"
  version_overrides:
    "2.x":
      selectors:
        # Override for v2.x - different fallback chain
        dialog_close:
          primary: ".modal-close-btn"
          fallback:
            - "button:has-text('×')"
            - "[role='button'][aria-label='Close']"
```

## Validation

Validate selector chains before execution:

```typescript
import { validateSelectorChain, isValidSelectorChain } from './actions/selectors.js';

// Get detailed validation errors
const errors = validateSelectorChain({
  primary: 'button',
  fallback: ['button', '.btn'] // Duplicate!
});

if (errors.length > 0) {
  console.error('Invalid selector chain:', errors);
}

// Simple boolean check
if (!isValidSelectorChain(selectorDef)) {
  throw new Error('Invalid selector chain');
}
```

## Statistics & Monitoring

Track selector execution statistics:

```typescript
import { SelectorStatsTracker } from './actions/selectors.js';

const tracker = new SelectorStatsTracker();

// Execute selectors
const result1 = await executeWithFallback(page, def1);
tracker.record(result1);

const result2 = await executeWithFallback(page, def2);
tracker.record(result2);

// Get statistics
const stats = tracker.getStats();
console.log('Success rate:', tracker.getSuccessRate());
console.log('Fallback usage:', tracker.getFallbackRate());
console.log('Avg execution time:', stats.avgExecutionTime);
```

## Error Handling

### SelectorFallbackError

When all selectors fail, a `SelectorFallbackError` is thrown (if `throwOnFailure: true`):

```typescript
try {
  await executeWithFallback(page, selectorDef);
} catch (error) {
  if (error instanceof SelectorFallbackError) {
    console.error('Attempted selectors:', error.attempted);
    console.error('Errors:', error.errors);
    console.error('Total time:', error.executionTime);
  }
}
```

### Execution Result

When `throwOnFailure: false`, examine the result:

```typescript
const result = await executeWithFallback(page, selectorDef, {
  throwOnFailure: false
});

if (!result.success) {
  console.log('Failed after trying:', result.attempted);
  console.log('Errors:', result.errors);
  console.log('Took', result.executionTime, 'ms');
}
```

## Best Practices

### 1. Order Fallbacks by Specificity

Start with the most specific, stable selector:

```yaml
selectors:
  submit:
    primary: "[data-testid='submit-button']"  # Most stable
    fallback:
      - "#submitBtn"                           # ID selector
      - "button.submit"                        # Class selector
      - "button[type='submit']"                # Generic fallback
```

### 2. Limit Fallback Chain Length

Keep fallback chains manageable (3-5 selectors):

```yaml
selectors:
  button:
    primary: "[data-testid='btn']"
    fallback:
      - ".btn-primary"
      - "button.btn"
      - "button:has-text('Click')"
    # Avoid: too many fallbacks = slower failure detection
```

### 3. Use Version Overrides for Major Changes

Don't pack all versions into one fallback chain:

```yaml
# BAD: Mixing all versions in fallback
selectors:
  button:
    primary: "[data-v3='button']"
    fallback:
      - "[data-v2='button']"
      - "[data-v1='button']"
      - ".legacy-button"

# GOOD: Use version overrides
selectors:
  button:
    primary: "[data-v3='button']"
    fallback: [".btn-primary"]

compatibility:
  version_overrides:
    "2.x":
      selectors:
        button:
          primary: "[data-v2='button']"
          fallback: [".btn-v2"]
```

### 4. Enable Debug Mode for Development

```typescript
const result = await executeWithFallback(page, selectorDef, {
  debugMode: true  // Logs each attempt to console
});
```

### 5. Set Appropriate Timeouts

```typescript
// Quick check
await executeWithFallback(page, def, { timeout: 1000 });

// Patient wait for slow-loading content
await executeWithFallback(page, def, { timeout: 10000 });
```

### 6. Monitor Fallback Usage

High fallback rates indicate selector instability:

```typescript
const tracker = new SelectorStatsTracker();

// ... execute actions ...

if (tracker.getFallbackRate() > 0.5) {
  console.warn('Over 50% of selectors needed fallbacks!');
  console.warn('Consider updating primary selectors.');
}
```

## Integration with Action Executor

The executor uses selector fallback automatically:

```yaml
steps:
  - action: click
    args:
      selector: submit  # References selector with fallback chain
```

The executor will:
1. Resolve `submit` selector from action/namespace definitions
2. Apply version overrides if configured
3. Execute with fallback chain automatically
4. Record which selector succeeded for tracing

## Testing

Mock selector behavior for testing:

```typescript
import { executeWithFallback } from './actions/selectors.js';

// Mock page with predictable behavior
const mockPage = {
  locator: (selector: string) => ({
    waitFor: async () => {
      if (selector === 'button.primary') {
        throw new Error('Not found');
      }
      // Fallback succeeds
    }
  })
};

const result = await executeWithFallback(
  mockPage as any,
  { primary: 'button.primary', fallback: ['button.fallback'] }
);

expect(result.selector).toBe('button.fallback');
expect(result.selectorIndex).toBe(1);
```

## Performance Considerations

- **Fast Failures**: Each selector attempt respects the timeout
- **No Unnecessary Attempts**: Stops at first success
- **Parallel Potential**: Future enhancement could try selectors in parallel
- **Caching**: Selector resolution is cached per action execution

## Future Enhancements

Planned improvements:

1. **Parallel Selector Execution**: Try multiple selectors simultaneously
2. **Smart Fallback Ordering**: Learn which selectors succeed most often
3. **Selector Health Metrics**: Track success rates per selector
4. **Automatic Selector Updates**: Suggest primary selector changes based on usage
