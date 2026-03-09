import type { Page } from 'playwright-core';

type ExtensionContext = {
  page: Page;
};

type ExtensionCommandHandler = (
  ctx: ExtensionContext,
  args: Record<string, unknown>
) => Promise<unknown> | unknown;

type TableRow = {
  index: number;
  cells: string[];
  text: string;
};

type TableSnapshot = {
  headers: string[];
  rows: TableRow[];
};

function getStringArg(args: Record<string, unknown>, key: string, required = true): string {
  const value = String(args[key] ?? '').trim();
  if (required && !value) {
    throw new Error(`${key} is required`);
  }
  return value;
}

function getIntArg(
  args: Record<string, unknown>,
  key: string,
  fallback: number,
  options?: { min?: number }
): number {
  const raw = args[key];
  const value = raw === undefined ? fallback : Number(raw);
  if (!Number.isInteger(value)) {
    throw new Error(`${key} must be an integer`);
  }
  if (options?.min !== undefined && value < options.min) {
    throw new Error(`${key} must be >= ${options.min}`);
  }
  return value;
}

function getBoolArg(args: Record<string, unknown>, key: string, fallback: boolean): boolean {
  const raw = args[key];
  if (raw === undefined) {
    return fallback;
  }
  if (typeof raw === 'boolean') {
    return raw;
  }
  if (typeof raw === 'string') {
    if (raw === 'true') return true;
    if (raw === 'false') return false;
  }
  throw new Error(`${key} must be a boolean`);
}

async function readTableSnapshot(
  page: Page,
  selector: string,
  includeHidden: boolean
): Promise<TableSnapshot> {
  const snapshot = await page.evaluate(
    ({ selector: target, includeHiddenRows }) => {
      const table = document.querySelector(target);
      if (!table) {
        throw new Error(`Table not found: ${target}`);
      }

      const isVisible = (el: Element): boolean => {
        if (includeHiddenRows) {
          return true;
        }
        const htmlEl = el as HTMLElement;
        const style = window.getComputedStyle(htmlEl);
        return style.display !== 'none' && style.visibility !== 'hidden';
      };

      const normalize = (text: string): string => text.replace(/\s+/g, ' ').trim();

      const headerNodes = Array.from(table.querySelectorAll('thead th'));
      const headers = headerNodes.map((cell) => normalize(cell.textContent ?? ''));

      const bodyRows = Array.from(table.querySelectorAll('tbody tr'));
      const fallbackRows = Array.from(table.querySelectorAll('tr')).filter(
        (row) => !row.closest('thead')
      );
      const rowNodes = (bodyRows.length > 0 ? bodyRows : fallbackRows).filter(isVisible);

      const rows = rowNodes.map((row, rowIndex) => {
        const cells = Array.from(row.querySelectorAll('th, td')).map((cell) =>
          normalize(cell.textContent ?? '')
        );

        return {
          index: rowIndex,
          cells,
          text: cells.join(' | '),
        };
      });

      return {
        headers,
        rows,
      };
    },
    { selector, includeHiddenRows: includeHidden }
  );

  return snapshot as TableSnapshot;
}

const getRow: ExtensionCommandHandler = async ({ page }, args) => {
  const selector = getStringArg(args, 'selector');
  const index = getIntArg(args, 'index', 0, { min: 0 });

  const row = page.locator(`${selector} tbody tr`).nth(index);
  const text = await row.innerText();
  return { text };
};

const describeTable: ExtensionCommandHandler = async ({ page }, args) => {
  const selector = getStringArg(args, 'selector');
  const includeHidden = getBoolArg(args, 'includeHidden', false);
  const sampleRows = getIntArg(args, 'sampleRows', 3, { min: 1 });

  const snapshot = await readTableSnapshot(page, selector, includeHidden);
  const columnCount = Math.max(
    snapshot.headers.length,
    ...snapshot.rows.map((row) => row.cells.length),
    0
  );

  return {
    selector,
    rowCount: snapshot.rows.length,
    columnCount,
    headers: snapshot.headers,
    sample: snapshot.rows.slice(0, sampleRows),
  };
};

const getRowCells: ExtensionCommandHandler = async ({ page }, args) => {
  const selector = getStringArg(args, 'selector');
  const index = getIntArg(args, 'index', 0, { min: 0 });
  const includeHidden = getBoolArg(args, 'includeHidden', false);

  const snapshot = await readTableSnapshot(page, selector, includeHidden);
  const row = snapshot.rows[index];
  if (!row) {
    throw new Error(`row index out of range: ${index} (total rows: ${snapshot.rows.length})`);
  }

  const headerMap: Record<string, string> = {};
  if (snapshot.headers.length > 0) {
    snapshot.headers.forEach((header, columnIndex) => {
      const key = header || `column_${columnIndex}`;
      headerMap[key] = row.cells[columnIndex] ?? '';
    });
  }

  return {
    index,
    text: row.text,
    cells: row.cells,
    headers: snapshot.headers,
    headerMap,
  };
};

const findRows: ExtensionCommandHandler = async ({ page }, args) => {
  const selector = getStringArg(args, 'selector');
  const query = getStringArg(args, 'query');
  const includeHidden = getBoolArg(args, 'includeHidden', false);
  const caseSensitive = getBoolArg(args, 'caseSensitive', false);
  const limit = getIntArg(args, 'limit', 5, { min: 1 });

  const snapshot = await readTableSnapshot(page, selector, includeHidden);
  const needle = caseSensitive ? query : query.toLowerCase();

  const matches = snapshot.rows.filter((row) => {
    const hay = caseSensitive ? row.text : row.text.toLowerCase();
    return hay.includes(needle);
  });

  return {
    query,
    caseSensitive,
    totalMatches: matches.length,
    rows: matches.slice(0, limit),
    truncated: matches.length > limit,
  };
};

const toMarkdownTable: ExtensionCommandHandler = async ({ page }, args) => {
  const selector = getStringArg(args, 'selector');
  const includeHidden = getBoolArg(args, 'includeHidden', false);
  const maxRows = getIntArg(args, 'maxRows', 20, { min: 1 });

  const snapshot = await readTableSnapshot(page, selector, includeHidden);
  if (snapshot.rows.length === 0) {
    return {
      headers: snapshot.headers,
      rowCount: 0,
      markdown: '',
      truncated: false,
    };
  }

  const columnCount = Math.max(
    snapshot.headers.length,
    ...snapshot.rows.map((row) => row.cells.length),
    0
  );
  const headers =
    snapshot.headers.length > 0
      ? Array.from({ length: columnCount }, (_, i) => snapshot.headers[i] ?? `column_${i}`)
      : Array.from({ length: columnCount }, (_, i) => `column_${i}`);

  const rows = snapshot.rows.slice(0, maxRows).map((row) => {
    return Array.from({ length: columnCount }, (_, i) => row.cells[i] ?? '');
  });

  const lines: string[] = [];
  lines.push(`| ${headers.join(' | ')} |`);
  lines.push(`| ${headers.map(() => '---').join(' | ')} |`);
  for (const row of rows) {
    lines.push(`| ${row.join(' | ')} |`);
  }

  return {
    headers,
    rowCount: snapshot.rows.length,
    exportedRows: rows.length,
    truncated: snapshot.rows.length > maxRows,
    markdown: lines.join('\n'),
  };
};

export const commands: Record<string, ExtensionCommandHandler> = {
  'table.describe': describeTable,
  'table.getRow': getRow,
  'table.getRowCells': getRowCells,
  'table.findRows': findRows,
  'table.toMarkdown': toMarkdownTable,
};
