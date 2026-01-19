# Version Management and Compatibility

This module provides comprehensive version detection and compatibility management for action definitions.

## Features

### 1. Version Detection

Detect component versions from web pages using multiple strategies:

```typescript
import { detectComponentVersion } from './version.js';

// Auto-detect using default strategies
const result = await detectComponentVersion(page, 'eresh');
console.log(result.version); // "4.2.1"
console.log(result.method);  // "script" | "selector" | "meta" | "custom" | "none"
```

Default detection strategies:
- JavaScript global: `window.__NAMESPACE_VERSION__`
- Meta tag: `<meta name="namespace:version" content="4.2.1">`
- Element attribute: `<div data-namespace-version="4.2.1">`

### 2. Custom Detection Strategies

Register custom version detection logic:

```typescript
import { registerDetectionStrategy } from './version.js';

registerDetectionStrategy('mylib', {
  versionScript: 'window.MyLib.version',
  versionMeta: 'mylib:ver',
  customDetector: async (page) => {
    // Custom logic
    return await page.evaluate(() => window.MyLib?.getVersion());
  }
});
```

### 3. Compatibility Checking

Check if a detected version is compatible with action constraints:

```typescript
import { isVersionCompatible } from './version.js';

const compatibility = {
  minVersion: '4.0.0',
  maxVersion: '5.0.0'
};

isVersionCompatible('4.2.1', compatibility); // true
isVersionCompatible('3.9.9', compatibility); // false
isVersionCompatible('5.0.1', compatibility); // false
```

### 4. Version Pattern Matching

Match versions against various patterns:

```typescript
import { matchVersion } from './version.js';

matchVersion('4.2.1', '4.2.1');    // Exact match: true
matchVersion('4.2.1', '4.x');      // Major wildcard: true
matchVersion('4.2.1', '4.2.x');    // Minor wildcard: true
matchVersion('4.2.1', '>=4.0.0');  // Semver range: true
matchVersion('4.2.1', '^4.2.0');   // Caret range: true
matchVersion('4.2.1', '~4.2.0');   // Tilde range: true
```

### 5. Version-Specific Overrides

Apply version-specific selector overrides to actions:

```typescript
import { applyVersionOverrides } from './version.js';

const namespace = {
  namespace: 'eresh',
  // ...
  compatibility: {
    versionOverrides: {
      '4.x': {
        selectors: {
          'dialog.closeBtn': '.close-btn-v4',
          'dialog.input': 'input.dialog-input-v4'
        }
      },
      '5.x': {
        selectors: {
          'dialog.closeBtn': '.modal-close-v5',
          'dialog.input': '.modal-input-v5'
        }
      }
    }
  }
};

const action = {
  name: 'dialog:close',
  steps: [
    { action: 'click', args: { selector: '$dialog.closeBtn' } }
  ]
  // ...
};

// Apply version-specific overrides
const overriddenAction = applyVersionOverrides(action, namespace, '4.2.1');
// Step selector is now '.close-btn-v4' instead of '$dialog.closeBtn'
```

### 6. High-Level Integration

#### Get Compatible Action

Combines detection, compatibility checking, and override application:

```typescript
import { getCompatibleAction } from './version.js';

const compatibleAction = await getCompatibleAction(page, action, namespace);

if (compatibleAction) {
  // Action is compatible and has version-specific overrides applied
  await executeAction(compatibleAction);
} else {
  // Action is not compatible with detected version
  console.error('Action not compatible with current version');
}
```

#### Check Namespace Compatibility

```typescript
import { isNamespaceCompatible } from './version.js';

if (await isNamespaceCompatible(page, namespace)) {
  console.log('Namespace is compatible with page version');
} else {
  console.log('Namespace requires different version');
}
```

#### Select Best Action

Choose the most specific compatible action from multiple candidates:

```typescript
import { selectBestAction } from './version.js';

const actions = [
  genericAction,      // No version constraints
  v4SpecificAction,   // minVersion: '4.0.0', maxVersion: '4.9.9'
  v5SpecificAction,   // minVersion: '5.0.0'
];

const bestAction = await selectBestAction(page, actions, namespace);
// Returns the most version-specific action that's compatible
```

## Version Normalization

All versions are normalized to semver format:

```typescript
import { normalizeVersion } from './version.js';

normalizeVersion('4.2.1');    // '4.2.1'
normalizeVersion('v4.2.1');   // '4.2.1'
normalizeVersion('4.2');      // '4.2.0'
normalizeVersion('4');        // '4.0.0'
normalizeVersion('invalid');  // null
```

## Complete Example

```typescript
import {
  detectComponentVersion,
  getCompatibleAction,
  selectBestAction
} from './version.js';

// 1. Detect version from page
const detection = await detectComponentVersion(page, 'eresh');
console.log(`Detected Eresh version: ${detection.version}`);

// 2. Check if single action is compatible
const action = await getCompatibleAction(page, myAction, namespace);
if (!action) {
  throw new Error('Action not compatible with current version');
}

// 3. Or select best action from multiple versions
const bestAction = await selectBestAction(page, [
  genericAction,
  v4Action,
  v5Action
], namespace);

// 4. Execute the compatible action
await executeAction(bestAction);
```

## Implementation Status

### ✅ Completed (3.2 兼容性选择)

- [x] Version detection (script, selector, meta, custom)
- [x] Pluggable detection strategies
- [x] Version normalization
- [x] Compatibility checking (min/max version)
- [x] Version pattern matching (exact, wildcard, semver ranges)
- [x] Version-specific selector overrides
- [x] High-level integration functions
  - [x] `getCompatibleAction` - Get compatible action with overrides
  - [x] `isNamespaceCompatible` - Check namespace compatibility
  - [x] `selectBestAction` - Select best action from candidates
- [x] 43 unit tests (all passing)
- [x] TypeScript errors resolved

### 🔜 Next Steps (3.3 选择器降级策略)

- [ ] Implement selector fallback chains
- [ ] Auto-retry with fallback selectors on failure
- [ ] Selector degradation strategies

## API Reference

See inline JSDoc comments in `version.ts` for detailed API documentation.

## Testing

```bash
pnpm test src/actions/version.test.ts
```

All 43 tests passing ✓
