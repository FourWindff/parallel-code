import { describe, expect, it, vi } from 'vitest';

vi.mock('../lib/terminalFitManager', () => ({
  markDirty: vi.fn(),
}));

import { buildGroupPanelEntriesForTest } from './TilingLayout';

describe('TilingLayout panel group collapse planning', () => {
  it('keeps task panels mounted when a group is collapsed', () => {
    const entries = buildGroupPanelEntriesForTest({
      projectId: 'project-1',
      groupType: 'independent',
      panelIds: ['task-1', 'task-2'],
      color: '#334455',
      collapsed: true,
    });

    expect(entries.map((entry) => entry.id)).toEqual(['task-1', 'task-2']);
    expect(entries.filter((entry) => entry.type === 'panel').map((entry) => entry.hidden)).toEqual([
      true,
      true,
    ]);
    expect(entries.some((entry) => entry.type !== 'panel')).toBe(false);
  });

  it('does not add a collapsed placeholder for expanded groups', () => {
    const entries = buildGroupPanelEntriesForTest({
      projectId: 'project-1',
      groupType: 'independent',
      panelIds: ['task-1', 'task-2'],
      color: '#334455',
      collapsed: false,
    });

    expect(entries.map((entry) => entry.id)).toEqual(['task-1', 'task-2']);
    expect(entries.map((entry) => entry.hidden)).toEqual([false, false]);
  });
});
