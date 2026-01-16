# Action Registry

The Action Registry is responsible for loading, merging, and indexing action definitions from multiple sources.

## Features

### 1. Multi-Source Loading

The registry loads action definitions from multiple locations in priority order:

1. **Built-in actions** (`actions/` directory) - lowest priority
2. **User-level actions** (`~/.agent-browser/actions/`)
3. **Project-level actions** (`.agent-browser/actions/`)
4. **Environment variable paths** (`AGENT_BROWSER_ACTIONS_PATH`)
5. **Custom paths** (from configuration) - highest priority

### 2. Merge Rules

When multiple sources define the same namespace:

- **Later-loaded definitions override earlier ones**
- **Same-named actions are replaced** (last wins)
- **Same-named selectors are replaced** (last wins)
- **Source paths are tracked** for debugging

Example:

```typescript
// Built-in: actions/common.yaml
namespace: common
actions:
  login:
    description: "Default login"
    
// User: ~/.agent-browser/actions/common.yaml
namespace: common
actions:
  login:
    description: "Custom login" # This wins!
  logout:
    description: "Logout"

// Result: common namespace has both actions
// - login uses the "Custom login" description
// - logout is added from user-level
```

### 3. Fast Indexing

Actions are indexed by fully qualified name (`namespace:component:action`) for O(1) lookup:

```typescript
const action = registry.getAction('eresh:dialog:open');
```

### 4. Powerful Search

Search across action names, descriptions, and parameters:

```typescript
const results = registry.search('login', {
  searchNames: true,
  searchDescriptions: true,
  searchParams: true,
  namespace: 'common', // optional filter
  limit: 10,
});

// Results are sorted by relevance score
```

## Usage

### Basic Usage

```typescript
import { createAndLoadRegistry } from './registry.js';

// Create and load registry
const { registry, result } = await createAndLoadRegistry({
  debug: false,
});

// Check for errors
if (result.errors.length > 0) {
  console.error('Failed to load some actions:', result.errors);
}

// Get statistics
const stats = registry.getStats();
console.log(`Loaded ${stats.actionCount} actions from ${stats.namespaceCount} namespaces`);
```

### Query Actions

```typescript
// Get all namespaces
const namespaces = registry.getNamespaces();

// Get specific namespace
const commonNs = registry.getNamespace('common');

// Get all actions
const allActions = registry.getAllActions();

// Get actions by namespace
const commonActions = registry.getActionsByNamespace('common');

// Get specific action
const loginAction = registry.getAction('common:login');

// Check existence
if (registry.hasAction('common:login')) {
  // Action exists
}
```

### Search

```typescript
// Search all fields
const results = registry.search('dialog');

// Search specific fields
const results = registry.search('email', {
  searchNames: false,
  searchDescriptions: false,
  searchParams: true, // Only search in parameters
});

// Filter by namespace
const results = registry.search('open', {
  namespace: 'eresh',
  limit: 5,
});

// Case-sensitive search
const results = registry.search('Login', {
  caseSensitive: true,
});
```

### Selectors

```typescript
// Get all selectors for a namespace
const selectors = registry.getSelectors('common');

// Get specific selector
const loginButton = registry.getSelector('common', 'loginButton');
```

### Debugging

```typescript
// Get debug information
const debug = registry.getDebugInfo();

console.log('Namespaces:', debug.namespaces);
console.log('Actions:', debug.actions);

// Get raw registry
const raw = registry.getRawRegistry();
```

### Reloading

```typescript
// Reload actions (useful for hot-reloading during development)
const result = await registry.reload();
```

## Configuration

```typescript
import { createRegistry } from './registry.js';

const registry = createRegistry({
  // Additional paths to load actions from
  paths: ['/custom/actions'],
  
  // Enable debug logging
  debug: true,
  
  // Base path for resolving relative paths
  basePath: process.cwd(),
});

await registry.load();
```

## Examples

See [registry.example.ts](./registry.example.ts) for a complete example.

Run the example:

```bash
npx tsx src/actions/registry.example.ts
```

## Testing

The registry is fully tested with 30+ test cases covering:

- Namespace merging (later wins)
- Action and selector overriding
- Index building and updates
- All query methods
- Search functionality with scoring
- Debug information

Run tests:

```bash
npm test -- src/actions/registry.test.ts
```

## Architecture

```
Registry
├── Loader (from loader.ts)
│   ├── Discover YAML files
│   ├── Parse and validate
│   └── Apply configuration inheritance
├── Merge Engine
│   ├── Merge namespaces
│   ├── Override actions
│   └── Override selectors
├── Index Builder
│   └── Build fullName -> Action map
└── Query Engine
    ├── Get operations
    ├── Search with scoring
    └── Debug information
```

## Next Steps

- [ ] Integrate with Executor
- [ ] Add CLI commands (list/describe/run)
- [ ] Implement version management
- [ ] Add selector fallback chains
