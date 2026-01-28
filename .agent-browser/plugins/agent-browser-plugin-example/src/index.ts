import type { Page } from 'playwright-core';

type ExtensionContext = {
  page: Page;
};

type ExtensionCommandHandler = (
  ctx: ExtensionContext,
  args: Record<string, unknown>
) => Promise<unknown> | unknown;

const getRow: ExtensionCommandHandler = async ({ page }, args) => {
  const selector = String(args.selector ?? '');
  const index = Number(args.index ?? 0);

  if (!selector) {
    throw new Error('selector is required');
  }
  if (Number.isNaN(index)) {
    throw new Error('index must be a number');
  }

  const row = page.locator(`${selector} tbody tr`).nth(index);
  const text = await row.innerText();
  return { text };
};

export const commands: Record<string, ExtensionCommandHandler> = {
  'table.getRow': getRow,
};
