# Configuration Management

The Actions system provides a flexible configuration mechanism that allows you to customize behavior through multiple sources with clear priority rules.

## Configuration Sources

Configuration can come from four sources, listed in priority order (highest to lowest):

1. **Environment Variables** - Runtime overrides
2. **Project Config** - `.agent-browser/config.yaml` in project root
3. **User Config** - `~/.agent-browser/config.yaml` in home directory
4. **Built-in Defaults** - Hardcoded sensible defaults

## Configuration Schema

```yaml
actions:
  # Additional paths to load action definitions from
  # Paths can be absolute, relative (to config file), or use ~ for home directory
  paths:
    - ./custom-actions
    - ~/shared-actions
    - /opt/company-actions

  # NPM packages containing action definitions (future feature)
  packages:
    - "@myorg/browser-actions"

  # Default timeout for all actions (milliseconds)
  default_timeout: 30000  # 30 seconds

  # Maximum recursion depth when actions call other actions
  max_depth: 10

  # Maximum number of steps in a single action execution
  max_steps: 100

  # Enable debug mode for detailed logging
  debug: false

  # Enable automatic component version detection
  detect_version: true
```

## Environment Variables

All settings can be overridden by environment variables:

| Variable | Type | Description | Example |
|----------|------|-------------|---------|
| `AGENT_BROWSER_ACTIONS_PATH` | string | Colon-separated (Unix) or semicolon-separated (Windows) paths | `export AGENT_BROWSER_ACTIONS_PATH="~/actions:./local-actions"` |
| `AGENT_BROWSER_ACTIONS_DEBUG` | boolean | Enable debug mode (`true`/`1`) | `export AGENT_BROWSER_ACTIONS_DEBUG=true` |
| `AGENT_BROWSER_ACTIONS_TIMEOUT` | number | Default timeout in milliseconds | `export AGENT_BROWSER_ACTIONS_TIMEOUT=60000` |
| `AGENT_BROWSER_ACTIONS_MAX_DEPTH` | number | Maximum recursion depth | `export AGENT_BROWSER_ACTIONS_MAX_DEPTH=15` |
| `AGENT_BROWSER_ACTIONS_MAX_STEPS` | number | Maximum number of steps | `export AGENT_BROWSER_ACTIONS_MAX_STEPS=200` |
| `AGENT_BROWSER_ACTIONS_DETECT_VERSION` | boolean | Enable version detection (`true`/`1`, `false`/`0`) | `export AGENT_BROWSER_ACTIONS_DETECT_VERSION=false` |

## Path Resolution

Paths in configuration files are resolved relative to the config file's directory:

### Absolute Paths
```yaml
paths:
  - /absolute/path/to/actions
  - C:\Windows\absolute\path  # Windows
```

### Relative Paths
```yaml
paths:
  - ./project-actions        # Relative to config file
  - ../shared/actions        # Parent directory
```

### Tilde Expansion
```yaml
paths:
  - ~/my-actions            # Expands to /home/user/my-actions
  - ~/workspace/actions     # Expands to home directory
```

## Usage Examples

### User-Level Configuration

Create `~/.agent-browser/config.yaml`:

```yaml
actions:
  # Your personal action library
  paths:
    - ~/my-browser-actions
    - ~/workspace/shared-actions

  # Your preferred settings
  default_timeout: 45000
  debug: false
```

### Project-Level Configuration

Create `.agent-browser/config.yaml` in your project root:

```yaml
actions:
  # Project-specific actions
  paths:
    - ./actions
    - ../shared-team-actions

  # Project-specific settings
  default_timeout: 60000  # Longer timeout for slow environments
  debug: true             # Enable debugging in development
```

### Environment-Specific Overrides

For CI/CD or different environments:

```bash
# Development
export AGENT_BROWSER_ACTIONS_DEBUG=true
export AGENT_BROWSER_ACTIONS_TIMEOUT=120000

# Production
export AGENT_BROWSER_ACTIONS_DEBUG=false
export AGENT_BROWSER_ACTIONS_TIMEOUT=30000
```

### Multiple Action Paths

Actions are loaded from multiple paths and merged:

```yaml
actions:
  paths:
    - ./project-actions      # Project-specific (highest priority)
    - ~/personal-actions     # Your personal library
    - /opt/company/actions   # Company-wide actions (lowest priority)
```

Later paths override earlier ones if there are conflicts (same namespace:component:action).

## API Usage

### Load Configuration

```typescript
import { loadConfig, getConfig } from './actions/config.js';

// Load configuration (cached)
const config = await loadConfig();
console.log(config.actions.default_timeout); // 30000

// Force reload
const reloaded = await loadConfig({ reload: true });
```

### Get Action Paths

```typescript
import { getActionPaths } from './actions/config.js';

// Get all paths to load actions from
const paths = await getActionPaths();
// Returns: ['/path/to/actions', '/home/user/.agent-browser/actions', ...]
```

### Debug Configuration

```typescript
import { getConfigSources } from './actions/config.js';

// See which values came from where
const sources = await getConfigSources();
console.log('Defaults:', sources.defaults);
console.log('User config:', sources.user);
console.log('Project config:', sources.project);
console.log('Environment:', sources.env);
console.log('Final merged:', sources.merged);
```

### Clear Cache

```typescript
import { clearConfigCache } from './actions/config.js';

// Clear cache and force reload on next access
clearConfigCache();
```

## Path Utilities

The configuration module provides path resolution utilities:

```typescript
import { expandTilde, normalizePath, resolvePath } from './actions/config.js';

// Expand tilde
expandTilde('~/actions');  // '/home/user/actions'

// Normalize path (POSIX style)
normalizePath('C:\\Users\\test\\actions');  // 'C:/Users/test/actions'

// Resolve relative path
resolvePath('./actions', '/project');  // '/project/actions'
```

## Default Values

When no configuration is provided, these defaults are used:

```typescript
{
  paths: [],
  packages: [],
  default_timeout: 30000,    // 30 seconds
  max_depth: 10,
  max_steps: 100,
  debug: false,
  detect_version: true
}
```

## Best Practices

### 1. Use User Config for Personal Settings
Store your personal action libraries and preferences in `~/.agent-browser/config.yaml`.

### 2. Use Project Config for Team Settings
Store project-specific actions and settings in `.agent-browser/config.yaml` and commit it to version control.

### 3. Use Environment Variables for CI/CD
Override settings for different environments without changing files.

### 4. Organize Actions by Source
```
~/my-actions/           # Personal experiments
~/work-actions/         # Work-related actions
/opt/company/actions/   # Company-wide standards
./project/actions/      # Project-specific
```

### 5. Use Relative Paths in Project Config
Makes the config portable across different machines:

```yaml
# ✅ Good - portable
paths:
  - ./actions
  - ../shared

# ❌ Bad - machine-specific
paths:
  - /Users/john/project/actions
```

### 6. Enable Debug Mode Selectively
```yaml
# Development config
debug: true

# Production config
debug: false
```

Or use environment variables:
```bash
# Enable debugging without changing files
export AGENT_BROWSER_ACTIONS_DEBUG=true
npm start
```

## Troubleshooting

### Configuration Not Loading

Check file locations:
```bash
# User config
ls -la ~/.agent-browser/config.yaml

# Project config
ls -la .agent-browser/config.yaml
```

### Paths Not Resolving

Enable debug mode to see resolved paths:
```bash
export AGENT_BROWSER_ACTIONS_DEBUG=true
agent-browser action list
```

### Environment Variables Not Working

Check variable names and values:
```bash
env | grep AGENT_BROWSER_ACTIONS
```

### Priority Issues

Use `getConfigSources()` to see which source is providing each value:
```typescript
const sources = await getConfigSources();
console.log(sources);
```
