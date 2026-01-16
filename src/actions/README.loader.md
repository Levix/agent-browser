# Action Loader

The action loader is responsible for discovering and loading action definitions from multiple sources.

## Features

- **Multi-path loading**: Loads actions from built-in, user-level, project-level, and custom paths
- **Directory scanning**: Recursively scans directories for YAML files
- **Configuration inheritance**: Supports `_config.yaml` for extending and overriding settings
- **Error handling**: Comprehensive error reporting with source tracking
- **Hot reloading**: Supports reloading actions without restarting

## Loading Paths

Actions are loaded from the following locations (in order of precedence):

1. **Built-in actions** (lowest priority)
   - Path: `<install-dir>/actions/`
   - Contains common actions shipped with agent-browser

2. **User-level actions**
   - Path: `~/.agent-browser/actions/`
   - User-specific actions that apply to all projects

3. **Project-level actions**
   - Path: `<project-root>/.agent-browser/actions/`
   - Project-specific actions

4. **Environment variable paths**
   - Set via `AGENT_BROWSER_ACTIONS_PATH`
   - Multiple paths separated by system path delimiter (`:` on Unix, `;` on Windows)
   - Example: `export AGENT_BROWSER_ACTIONS_PATH="/custom/actions:/more/actions"`

5. **Custom paths from configuration** (highest priority)
   - Specified in `config.yaml` under `actions.paths`
   - Can be absolute or relative paths

Later paths override earlier ones when namespaces conflict.

## Configuration Inheritance

### _config.yaml

Each directory can contain a `_config.yaml` file to customize action definitions:

```yaml
# Extend parent configuration
extends: ../parent/_config.yaml

# Override selectors
selectors:
  button: "button.custom-class"
  input: "input.my-input"
```

### Features

- **Extends**: Inherit configuration from parent directories
- **Multiple inheritance**: Extend from multiple parent configurations
- **Selector overrides**: Replace selectors without modifying original files
- **Circular reference protection**: Prevents infinite loops in inheritance chain

## API Usage

### Load All Actions

```typescript
import { loadActions } from './loader.js';

const result = await loadActions({
  paths: ['/custom/actions'],
  debug: true,
  basePath: process.cwd()
});

// Access loaded namespaces
for (const [name, namespace] of result.namespaces) {
  console.log(`Loaded namespace: ${name} v${namespace.version}`);
  console.log(`Actions: ${Object.keys(namespace.actions).length}`);
}

// Check for errors
if (result.errors.length > 0) {
  console.error('Errors during loading:');
  result.errors.forEach(error => {
    console.error(`- ${error.path}: ${error.message}`);
  });
}

// Check for warnings
if (result.warnings.length > 0) {
  console.warn('Warnings:');
  result.warnings.forEach(warning => {
    console.warn(`- ${warning.message}`);
  });
}
```

### Load Single File

```typescript
import { loadActionFile } from './loader.js';

const result = await loadActionFile('/path/to/actions.yaml');

if ('type' in result) {
  // Error occurred
  console.error(`Failed to load: ${result.message}`);
} else {
  // Successfully loaded
  console.log(`Loaded namespace: ${result.namespace}`);
}
```

### Get Action Paths

```typescript
import { getActionPaths } from './loader.js';

const paths = getActionPaths({
  paths: ['/custom/actions'],
  basePath: '/project'
});

console.log('Scanning paths:', paths);
```

### Discover Files

```typescript
import { discoverFiles } from './loader.js';

const files = await discoverFiles([
  '/path/to/actions',
  '/another/path'
]);

console.log(`Found ${files.length} YAML files`);
```

### Reload Actions

```typescript
import { reloadActions } from './loader.js';

// Reload with same configuration
const result = await reloadActions({
  debug: true
});

console.log(`Reloaded ${result.namespaces.size} namespaces`);
```

## Error Types

The loader reports the following error types:

- `file_not_found`: File does not exist
- `parse_error`: YAML parsing failed
- `validation_error`: Schema validation failed
- `io_error`: File system error

## Path Utilities

### normalizePath

Convert path separators to forward slashes (POSIX style):

```typescript
import { normalizePath } from './loader.js';

const normalized = normalizePath('C:\\Users\\test\\file.txt');
// Result: 'C:/Users/test/file.txt'
```

### expandTilde

Expand `~` to home directory:

```typescript
import { expandTilde } from './loader.js';

const expanded = expandTilde('~/actions/custom.yaml');
// Result: '/home/user/actions/custom.yaml' (on Unix)
```

## Examples

### Example 1: Load Actions with Custom Path

```typescript
const result = await loadActions({
  paths: ['/workspace/custom-actions'],
  basePath: process.cwd()
});

if (result.namespaces.has('custom')) {
  const customNs = result.namespaces.get('custom');
  console.log(`Loaded ${Object.keys(customNs.actions).length} custom actions`);
}
```

### Example 2: Load with Environment Variable

```bash
export AGENT_BROWSER_ACTIONS_PATH="/opt/actions:/usr/local/actions"
```

```typescript
const result = await loadActions();
// Will include actions from environment paths
```

### Example 3: Hot Reload During Development

```typescript
let loadedActions = await loadActions({ debug: true });

// Later, when files change...
loadedActions = await reloadActions({ debug: true });
console.log('Actions reloaded');
```

## Testing

The loader includes comprehensive tests:

```bash
npm test -- src/actions/loader.test.ts
```

Test coverage includes:
- Path resolution
- File discovery
- YAML parsing
- Schema validation
- Configuration inheritance
- Error handling
- Multi-path loading
- Override behavior

## See Also

- [types.ts](./types.ts) - Type definitions
- [validator.ts](./validator.ts) - Schema validation
- [../../docs/plan.md](../../docs/plan.md) - Implementation plan
