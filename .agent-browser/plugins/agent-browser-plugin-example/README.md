# agent-browser-plugin-example

Example table helpers plugin for agent-browser.

## Description

This plugin provides utility commands for working with HTML tables in web pages. It demonstrates how to create custom extensions for the agent-browser CLI.

## Installation

This plugin is already installed in your local `.agent-browser/plugins/` directory.

### Building from Source

Since this plugin is written in TypeScript, you need to compile it before use:

```bash
cd .agent-browser/plugins/agent-browser-plugin-example
npx tsc
```

This will generate the `dist/` folder with the compiled JavaScript files.

## Commands

### table.getRow

Get the text content of a specific row in a table.

**Syntax:**
```bash
agent-browser example table.getRow <selector> [index]
```

**Arguments:**
- `selector` (string, required): CSS selector for the table element
- `index` (integer, optional): Zero-based row index. Default: `0`

**Returns:** The text content of the specified table row.

## Usage Examples

### Example 1: Get the first row from a table

```bash
# Navigate to a page with a table
agent-browser goto "https://example.com/data"

# Get the first row (index 0)
agent-browser example table.getRow "table.data-table" 0
```

### Example 2: Get the third row from a table

```bash
# Get the third row (index 2)
agent-browser example table.getRow "table.data-table" 2
```

### Example 3: Test with inline HTML

```bash
# Navigate to test HTML
agent-browser goto "data:text/html,<table><tbody><tr><td>Row 1</td></tr><tr><td>Row 2</td></tr><tr><td>Row 3</td></tr></tbody></table>"

# Get first row
agent-browser example table.getRow "table" 0
# Output: Row 1

# Get second row
agent-browser example table.getRow "table" 1
# Output: Row 2
```

### Example 4: Using with complex selectors

```bash
# Use a specific table by class or ID
agent-browser example table.getRow "#users-table" 0
agent-browser example table.getRow ".product-list" 5
```

## How It Works

The plugin uses Playwright's locator API to:
1. Find the table element using the provided CSS selector
2. Locate the `<tbody> <tr>` elements within that table
3. Get the nth row based on the index parameter
4. Extract and return the inner text of that row

## Development

### Project Structure

```
agent-browser-plugin-example/
├── extension.json      # Plugin manifest
├── package.json        # Node.js package configuration
├── tsconfig.json       # TypeScript configuration
├── src/
│   └── index.ts        # Plugin source code
└── dist/               # Compiled JavaScript (generated)
    └── index.js
```

### Modifying the Plugin

1. Edit the source code in `src/index.ts`
2. Rebuild the plugin: `npx tsc`
3. Restart the agent-browser daemon: `agent-browser close`
4. Test your changes

## Requirements

- agent-browser CLI version >= 0.8.4
- Node.js and npm/npx (for building)
- TypeScript (installed automatically via npx)

## Troubleshooting

### "Unknown extension: example" error

This means the plugin hasn't been built yet or the daemon needs to be restarted:

1. Build the plugin: `cd .agent-browser/plugins/agent-browser-plugin-example && npx tsc`
2. Restart the daemon: `agent-browser close`
3. Try your command again

### "selector is required" error

You must provide a CSS selector as the first argument:
```bash
# Wrong
agent-browser example table.getRow

# Correct
agent-browser example table.getRow "table"
```

### Timeout errors

If you get a timeout error, verify that:
- The page has finished loading
- The table selector matches an actual table element
- The table has `<tbody>` and `<tr>` elements
- The row index exists in the table

## License

This is an example plugin for demonstration purposes.
