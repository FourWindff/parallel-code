import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(resolve(process.cwd(), 'src/styles.css'), 'utf8');

function hasRule(selector: string): boolean {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?:^|\\n)${escapedSelector}\\s*\\{([^}]*)\\}`).test(css);
}

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

  it('keeps inner group resize handles visible in expanded groups', () => {
    expect(hasRule('.resize-handle-h.group-inner-handle::before')).toBe(false);
  });

  it('fills inner group resize handle gaps with the group background', () => {
    const groupInnerHandle = declarationsFor('.resize-handle-h.group-inner-handle');
    const groupInnerHandleHover = declarationsFor('.resize-handle-h.group-inner-handle:hover');

    expect(groupInnerHandle.margin).toBe('0');
    expect(groupInnerHandle.position).toBe('relative');
    expect(groupInnerHandle['z-index']).toBe('3');
    expect(groupInnerHandle.background).toBe('inherit');
    expect(groupInnerHandleHover.background).toContain('color-mix');
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

  it('keeps the expand control as a side strip beside the visible collapsed panel', () => {
    const expandButton = declarationsFor('.panel-group-expand-btn');

    expect(expandButton.position).toBe('relative');
    expect(expandButton.width).toBe('18px');
    expect(expandButton['flex-shrink']).toBe('0');
    expect(expandButton.background).toBe('inherit');
  });
});
