# agent-browser-plugin-example

A practical plugin demo for table extraction and reporting in `agent-browser`.

## What this demo does

This plugin now supports a complete mini workflow:

- Inspect table structure (`table.describe`)
- Read one row as plain text (`table.getRow`)
- Read one row as structured cells (`table.getRowCells`)
- Search rows by keyword (`table.findRows`)
- Export table to markdown (`table.toMarkdown`)

## Build

```bash
cd .agent-browser/plugins/agent-browser-plugin-example
pnpm exec tsc -p tsconfig.json
```

After rebuilding, restart daemon once:

```bash
agent-browser close
```

## Quick run demo

```bash
agent-browser open "data:text/html,
<table id='orders'>
    <thead><tr><th>ID</th><th>User</th><th>Status</th><th>Total</th></tr></thead>
    <tbody>
        <tr><td>1001</td><td>Alice</td><td>Paid</td><td>49.50</td></tr>
        <tr><td>1002</td><td>Bob</td><td>Pending</td><td>19.99</td></tr>
        <tr><td>1003</td><td>Carol</td><td>Paid</td><td>99.00</td></tr>
        <tr><td>1004</td><td>Dave</td><td>Failed</td><td>12.00</td></tr>
    </tbody>
</table>"

agent-browser example table.describe "#orders" 3 false
agent-browser example table.getRow "#orders" 1
agent-browser example table.getRowCells "#orders" 2 false
agent-browser example table.findRows "#orders" "Paid" 10 false false
agent-browser example table.toMarkdown "#orders" 20 false
```

## Commands

### `table.describe <selector> [sampleRows] [includeHidden]`

Returns:

- table selector
- header names
- row count
- inferred column count
- sample rows

### `table.getRow <selector> [index]`

Returns text content of the row at `index` (compatible with old demo behavior).

### `table.getRowCells <selector> [index] [includeHidden]`

Returns structured row data:

- `cells`: ordered cell array
- `headers`: table headers
- `headerMap`: key/value mapping using header names

### `table.findRows <selector> <query> [limit] [caseSensitive] [includeHidden]`

Find rows where joined row text contains the query string.

### `table.toMarkdown <selector> [maxRows] [includeHidden]`

Exports a markdown table string that can be copied directly into docs/reports.

## Notes

- For row extraction, the plugin prefers `tbody tr`; if missing, it falls back to non-header `tr` rows.
- `includeHidden=false` ignores rows hidden via `display:none` or `visibility:hidden`.

## Troubleshooting

### `Unknown plugin: example`

Rebuild plugin and restart daemon:

```bash
cd .agent-browser/plugins/agent-browser-plugin-example
pnpm exec tsc -p tsconfig.json
agent-browser close
```

### `Table not found`

- Check selector correctness.
- Ensure page is loaded before command execution.

### `row index out of range`

Run `table.describe` first to confirm available row count.
