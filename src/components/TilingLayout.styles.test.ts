import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(resolve(process.cwd(), 'src/styles.css'), 'utf8');

function declarationsFor(selector: string): Record<string, string> {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = css.match(new RegExp(`(?:^|\\n)${escapedSelector}\\s*\\{([^}]*)\\}`));
  if (!match) throw new Error(`Missing CSS rule for ${selector}`);

  return Object.fromEntries(
    match[1]
      .split(';')
      .map((declaration) => declaration.trim())
      .filter(Boolean)
      .map((declaration) => {
        const separatorIndex = declaration.indexOf(':');
        return [
          declaration.slice(0, separatorIndex).trim(),
          declaration.slice(separatorIndex + 1).trim(),
        ];
      }),
  );
}

describe('tiling layout group divider styles', () => {
  it('keeps the group-between resize handle inside the dark group gap', () => {
    const groupWrapper = declarationsFor('.panel-group-wrapper');
    const groupBetweenHandle = declarationsFor('.group-between-handle');
    const islandsGroupBetweenHandle = declarationsFor(
      "html[data-look^='islands-'] .tiling-layout-strip > .group-between-handle",
    );

    expect(groupWrapper['margin-right']).toBe('0');
    expect(groupBetweenHandle.width).toBe('10px');
    expect(groupBetweenHandle.margin).toBe('0');
    expect(islandsGroupBetweenHandle.margin).toBe('0');
  });
});

describe('tiling layout group collapse controls', () => {
  it('uses prominent arrow icons for collapse and expand controls', () => {
    const collapseIcon = declarationsFor('.panel-group-collapse-btn svg');
    const expandIcon = declarationsFor('.panel-group-expand-btn svg');

    expect(collapseIcon.width).toBe('16px');
    expect(collapseIcon.height).toBe('16px');
    expect(expandIcon.width).toBe('16px');
    expect(expandIcon.height).toBe('16px');
  });
});
