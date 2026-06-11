import { describe, expect, it, vi } from 'vitest';

vi.mock('../lib/terminalFitManager', () => ({
  markDirty: vi.fn(),
}));

import {
  buildGroupPanelEntriesForTest,
  groupResizeHandleIndexForTest,
  groupPanelInnerHandleHiddenForTest,
  groupWrapperPaddingForTest,
  isGroupPanelHiddenForTest,
} from './TilingLayout';

describe('TilingLayout panel group collapse planning', () => {
  it('keeps the first task panel visible when a group is collapsed', () => {
    const entries = buildGroupPanelEntriesForTest({
      projectId: 'project-1',
      groupType: 'independent',
      panelIds: ['task-1', 'task-2'],
      color: '#334455',
      collapsed: true,
    });

    expect(entries.map((entry) => entry.id)).toEqual(['task-1', 'task-2']);
    expect(entries.filter((entry) => entry.type === 'panel').map((entry) => entry.hidden)).toEqual([
      false,
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

  it('derives hidden state from the current collapsed state', () => {
    const [, secondEntry] = buildGroupPanelEntriesForTest({
      projectId: 'project-1',
      groupType: 'independent',
      panelIds: ['task-1', 'task-2'],
      color: '#334455',
      collapsed: false,
    });

    expect(isGroupPanelHiddenForTest(secondEntry.groupInfo, false)).toBe(false);
    expect(isGroupPanelHiddenForTest(secondEntry.groupInfo, true)).toBe(true);
  });

  it('keeps the group background padding when collapsed', () => {
    expect(groupWrapperPaddingForTest(false)).toBe('0 6px');
    expect(groupWrapperPaddingForTest(true)).toBe('0 6px');
  });

  it('anchors the collapsed group resize handle to the visible first panel', () => {
    expect(groupResizeHandleIndexForTest(3, 5, false)).toBe(5);
    expect(groupResizeHandleIndexForTest(3, 5, true)).toBe(3);
  });

  it('hides handles between task panels while a group is collapsed', () => {
    expect(groupPanelInnerHandleHiddenForTest(false, false)).toBe(false);
    expect(groupPanelInnerHandleHiddenForTest(true, false)).toBe(true);
    expect(groupPanelInnerHandleHiddenForTest(true, true)).toBe(true);
  });

  it('supports deriving inner handle visibility after collapsed state changes', () => {
    let collapsed = false;
    const hideHandle = () => groupPanelInnerHandleHiddenForTest(collapsed, false);

    expect(hideHandle()).toBe(false);
    collapsed = true;
    expect(hideHandle()).toBe(true);
  });

});
