# Expression Evaluator Examples

This document demonstrates the usage of the expression evaluator in the action system.

## Basic Usage

```typescript
import { evaluateExpression, VariableContext } from './vars';

const context: VariableContext = {
  params: {
    age: 25,
    name: 'Alice',
    status: 'active',
  },
  env: {
    DEBUG: 'true',
  },
  selectors: {},
  steps: {
    login: {
      success: true,
      userId: 123,
    },
  },
};

// Simple comparisons
evaluateExpression('params.age > 18', context); // true
evaluateExpression('params.name == "Alice"', context); // true
evaluateExpression('params.status != "inactive"', context); // true

// Logical operators
evaluateExpression('params.age >= 21 && params.status == "active"', context); // true
evaluateExpression('params.age < 18 || params.name == ""', context); // false

// Negation
evaluateExpression('!params.status', context); // false (non-empty string is truthy)
evaluateExpression('!(params.age < 18)', context); // true

// Complex expressions
evaluateExpression(
  '(params.age >= 18 && params.status == "active") || env.DEBUG == "true"',
  context
); // true

// Step outputs
evaluateExpression('steps.login.success == true', context); // true
evaluateExpression('steps.login.userId > 0', context); // true
```

## Use Cases in Action Definitions

### 1. Conditional Step Execution

```yaml
steps:
  - action: click
    selector: selectors.submitButton
    when: params.email != "" && params.password != ""
```

### 2. Retry Logic

```yaml
steps:
  - action: click
    selector: selectors.loginButton
    retry: 3
    when: steps.check_login.success != true
```

### 3. Result Verification

```yaml
verify: steps.api_call.status == 200 && steps.api_call.data.count > 0
```

### 4. Form Validation

```yaml
steps:
  - action: fail
    message: "User must be 18 or older"
    when: params.age < 18

  - action: fill
    selector: selectors.emailInput
    value: params.email
    when: params.email != ""
```

### 5. Environment-Based Behavior

```yaml
steps:
  - action: snapshot
    when: env.DEBUG == "true"

  - action: wait
    duration: 5000
    when: env.SLOW_MODE == "true"
```

## Type Conversion

The evaluator automatically converts types for comparisons:

```typescript
// String to number conversion
evaluateExpression('params.age == "25"', context); // true

// Number to boolean (truthiness)
evaluateExpression('params.age && true', context); // true (25 is truthy)

// Empty string is falsy
evaluateExpression('"" || "default"', context); // "default"

// Zero is falsy
evaluateExpression('0 || 1', context); // 1
```

## Operator Precedence

From lowest to highest:
1. `||` (logical OR)
2. `&&` (logical AND)
3. `==`, `!=` (equality)
4. `>`, `<`, `>=`, `<=` (comparison)
5. `!` (logical NOT)
6. Parentheses `()`

```typescript
// Without parentheses
evaluateExpression('true || false && false', context); // true
// Evaluated as: true || (false && false)

// With parentheses
evaluateExpression('(true || false) && false', context); // false
```

## Short-Circuit Evaluation

Logical operators use short-circuit evaluation for efficiency:

```typescript
// && stops at first falsy value
evaluateExpression('false && params.nonexistent.value', context); // false
// Second operand is never evaluated

// || stops at first truthy value
evaluateExpression('true || params.nonexistent.value', context); // true
// Second operand is never evaluated
```

## Error Handling

The evaluator provides detailed error messages with position information:

```typescript
try {
  evaluateExpression('invalid.scope', context);
} catch (error) {
  console.error(error.message);
  // "Invalid scope "invalid". Must be one of: params, env, selectors, steps at position 0"
  console.error(error.position); // 0
}
```

## Safety Features

### 1. Prototype Pollution Prevention

```typescript
// These will throw errors
evaluateExpression('params.__proto__', context); // Error: Dangerous property
evaluateExpression('params.constructor', context); // Error: Dangerous property
```

### 2. Depth Limit

```typescript
// Prevents stack overflow attacks
let deepExpr = 'true';
for (let i = 0; i < 60; i++) {
  deepExpr = `!${deepExpr}`;
}
evaluateExpression(deepExpr, context); // Error: Maximum expression depth exceeded
```

### 3. No Function Calls

The evaluator does not support function calls, only variable access and operators:

```typescript
// Not supported
evaluateExpression('params.name.toUpperCase()', context); // Parse error
evaluateExpression('Math.random()', context); // Parse error
```

### 4. No Object/Array Literals

Object and array literals are not supported:

```typescript
// Not supported
evaluateExpression('[1, 2, 3]', context); // Parse error
evaluateExpression('{key: "value"}', context); // Parse error
```

## Performance Considerations

- Expressions are parsed and evaluated each time
- For frequently used expressions, consider caching the AST
- Short-circuit evaluation helps avoid unnecessary computation
- Type conversion is performed automatically but may have slight overhead

## Best Practices

1. **Keep expressions simple**: Complex logic should be split into multiple steps
2. **Use meaningful variable names**: Makes expressions self-documenting
3. **Leverage short-circuit evaluation**: Put cheaper checks first
4. **Handle null/undefined**: Use appropriate checks for missing values
5. **Test expressions**: Validate expressions with different input values
