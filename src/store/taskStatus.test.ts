import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock the SolidJS store before importing the module under test.
let mockAutoTrustFolders = false;
let mockActiveTaskId: string | null = null;
vi.mock('./core', () => ({
  store: new Proxy(
    {},
    {
      get(_target, prop) {
        if (prop === 'autoTrustFolders') return mockAutoTrustFolders;
        if (prop === 'activeTaskId') return mockActiveTaskId;
        return undefined;
      },
    },
  ),
  setStore: vi.fn(),
}));

// Mock IPC so tryAutoTrust's invoke call doesn't hit Electron.
vi.mock('../lib/ipc', () => ({
  invoke: vi.fn().mockResolvedValue(undefined),
}));

// Stub SolidJS reactive primitives — tests run outside a reactive root.
vi.mock('solid-js', () => {
  function createSignal<T>(initial: T): [() => T, (v: T | ((prev: T) => T)) => void] {
    let value = initial;
    const getter = () => value;
    const setter = (v: T | ((prev: T) => T)) => {
      value = typeof v === 'function' ? (v as (prev: T) => T)(value) : v;
    };
    return [getter, setter];
  }
  return {
    createSignal,
    createEffect: vi.fn(),
    onMount: vi.fn(),
    onCleanup: vi.fn(),
    untrack: (fn: () => unknown) => fn(),
  };
});

import {
  stripAnsi,
  normalizeForComparison,
  normalizeCurrentFrame,
  looksLikeQuestion,
  isTrustQuestionAutoHandled,
  isAutoTrustSettling,
  markAgentSpawned,
  markAgentOutput,
  clearAgentActivity,
} from './taskStatus';

beforeEach(() => {
  vi.useFakeTimers();
  mockAutoTrustFolders = false;
  mockActiveTaskId = 'task-1';
});

afterEach(() => {
  clearAgentActivity('agent-1');
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// stripAnsi
// ---------------------------------------------------------------------------
describe('stripAnsi', () => {
  it('removes CSI color codes', () => {
    expect(stripAnsi('\x1b[32mgreen\x1b[0m')).toBe('green');
  });

  it('removes OSC sequences', () => {
    expect(stripAnsi('\x1b]0;title\x07text')).toBe('text');
  });

  it('returns plain text unchanged', () => {
    expect(stripAnsi('hello world')).toBe('hello world');
  });

  it('removes cursor-positioning sequences that cause TUI garbling', () => {
    // Ink-style cursor positioning: ESC[row;colH moves cursor
    const garbled = '\x1b[1;1HI\x1b[1;2Htrust\x1b[1;8Hthis\x1b[1;13Hfolder';
    expect(stripAnsi(garbled)).toBe('Itrustthisfolder');
  });
});

// ---------------------------------------------------------------------------
// normalizeForComparison
// ---------------------------------------------------------------------------
describe('normalizeForComparison', () => {
  it('strips ANSI and collapses whitespace', () => {
    expect(normalizeForComparison('\x1b[32m  hello   world  \x1b[0m')).toBe('hello world');
  });

  it('removes control characters', () => {
    expect(normalizeForComparison('hello\x00\x01world')).toBe('helloworld');
  });
});

// ---------------------------------------------------------------------------
// normalizeCurrentFrame
// ---------------------------------------------------------------------------
describe('normalizeCurrentFrame', () => {
  it('falls back to full content when no frame-start marker present', () => {
    expect(normalizeCurrentFrame('hello world')).toBe('hello world');
  });

  it('extracts content from the last \\x1b[H (cursor home)', () => {
    const ESC = '\x1b';
    const tail = `old content${ESC}[H${ESC}[2Knew frame content`;
    // The last cursor-home is just before "new frame content".
    expect(normalizeCurrentFrame(tail)).toBe('new frame content');
  });

  it('extracts content from the last \\x1b[1;1H (cursor to row 1)', () => {
    const ESC = '\x1b';
    const render = (text: string) => `${ESC}[1;1H${ESC}[2K${text}${ESC}[2;1H${ESC}[2K status bar`;
    const tail = render('frame A') + render('frame B');
    // Should only see frame B's content.
    expect(normalizeCurrentFrame(tail)).toBe('frame B status bar');
  });

  it('returns the same value for consecutive redraws of identical content', () => {
    // This is the key property: Copilot CLI redraws the same screen on every
    // frame using cursor positioning.  The normalized current-frame content must
    // be identical across redraws so the stability-check snapshot comparison
    // passes and the initial prompt auto-send can fire.
    const ESC = '\x1b';
    const frame = `${ESC}[1;1H${ESC}[2K╭──────╮${ESC}[2;1H${ESC}[2K│ ${ESC}[36m❯${ESC}[39m │${ESC}[3;1H${ESC}[2K╰──────╯${ESC}[4;1H${ESC}[2K Mode: interactive`;
    const tail1 = frame;
    const tail2 = frame + frame; // second identical redraw appended
    expect(normalizeCurrentFrame(tail1)).toBe(normalizeCurrentFrame(tail2));
  });
});

// ---------------------------------------------------------------------------
// looksLikeQuestion
// ---------------------------------------------------------------------------
describe('looksLikeQuestion', () => {
  it('detects Y/n confirmation prompt', () => {
    expect(looksLikeQuestion('Install packages? [Y/n] ')).toBe(true);
  });

  it('detects y/N confirmation prompt', () => {
    expect(looksLikeQuestion('Continue? [y/N] ')).toBe(true);
  });

  it('detects normal trust dialog with spaces', () => {
    expect(looksLikeQuestion('Do you trust this folder?')).toBe(true);
  });

  it('detects TUI-garbled trust dialog without word boundaries', () => {
    // After ANSI stripping, TUI text runs together
    expect(looksLikeQuestion('❯1.Yes,Itrustthisfolder')).toBe(true);
  });

  it('detects "trust.*folder" pattern in garbled text', () => {
    expect(looksLikeQuestion('Doyoutrustthisfolder?')).toBe(true);
  });

  it('returns false for bare prompt marker', () => {
    expect(looksLikeQuestion('❯ ')).toBe(false);
    expect(looksLikeQuestion('❯')).toBe(false);
  });

  it('returns false for bare prompt marker preceded by old trust text', () => {
    // When the trust dialog has been answered and the agent shows its real prompt,
    // the last line is a bare ❯ — should NOT be treated as a question.
    const tail = 'Do you trust this folder?\n❯ ';
    expect(looksLikeQuestion(tail)).toBe(false);
  });

  it('returns false when prompt marker is not on the last line (footer below prompt)', () => {
    // Copilot CLI renders a status bar / footer after the ❯ input cursor, so ❯
    // ends up one line above the last non-empty line.  Should still clear state.
    const tail =
      'Would you like to initialize Copilot instructions?\n❯ \nMode: interactive | Claude Sonnet 4.5';
    expect(looksLikeQuestion(tail)).toBe(false);
  });

  it('returns false when prompt marker has a deep multi-line footer below it (Codex CLI layout)', () => {
    // Codex CLI renders a multi-line help bar (separator + shortcuts + separator)
    // below the › prompt, pushing it 4+ lines from the end.
    const tail =
      'Would you like to proceed?\n' +
      '›\n' +
      '──────────────────────────────\n' +
      '  ↑↓ history  ctrl+c cancel  \n' +
      '──────────────────────────────\n';
    expect(looksLikeQuestion(tail)).toBe(false);
  });

  it('returns false when prompt marker is at end of TUI-garbled line', () => {
    // Copilot CLI cursor-positioning can concatenate the init suggestion and the ❯
    // input cursor onto the same stripped line when no actual newlines are used.
    const tail = 'Would you like to initialize Copilot instructions?❯ ';
    expect(looksLikeQuestion(tail)).toBe(false);
  });

  it('returns true for trust dialog content ending with ❯ (buffer truncation mid-frame)', () => {
    // When the PTY buffer captures a Copilot CLI frame mid-write, the tail can
    // end with the selection cursor ❯ before the surrounding text arrives.
    // The bare-❯ end-of-line check must NOT suppress trust dialogs.
    // Trust patterns are checked first and win when there is no bare-❯-only line.
    const tail =
      'Confirm folder trust  Do you trust the files in this folder?  ❯ 1. Yes  2. Yes, and remember  3. No (Esc)❯';
    expect(looksLikeQuestion(tail)).toBe(true);
  });

  it('returns true for trust dialog via raw-text fast path (no screen-clear, dense ANSI)', () => {
    // Raw-text fast path: "confirm folder trust" must be found even when there is no
    // \x1b[2J and the text is wrapped in heavy color codes — as long as ANSI codes
    // appear AROUND words, not inside them (which is always the case in Ink TUI).
    const ESC = '\x1b';
    const tail =
      `${ESC}[1;1H${ESC}[2K${ESC}[1m╭───────────────────────────╮${ESC}[0m` +
      `${ESC}[2;1H${ESC}[2K${ESC}[1m│${ESC}[0m ${ESC}[33mConfirm folder trust${ESC}[0m ${ESC}[1m│${ESC}[0m` +
      `${ESC}[3;1H${ESC}[2K${ESC}[1m│${ESC}[0m Do you trust the files?    ${ESC}[1m│${ESC}[0m` +
      `${ESC}[4;1H${ESC}[2K${ESC}[1m│${ESC}[0m ${ESC}[36m❯${ESC}[39m Yes  No              ${ESC}[1m│${ESC}[0m`;
    expect(looksLikeQuestion(tail)).toBe(true);
  });

  it('returns true for trust dialog rendered as single TUI string ending with ❯', () => {
    // Copilot CLI cursor-positioning collapses everything to one string.
    // Even if that string ends with ❯ (buffer cut mid-frame), trust content
    // triggers the trust fast-path and returns true.
    const ESC = '\x1b';
    const tail =
      `${ESC}[?1049h` +
      `${ESC}[5;1H${ESC}[2K│ Confirm folder trust │` +
      `${ESC}[9;1H${ESC}[2K│ Do you trust the files in this folder? │` +
      `${ESC}[11;1H${ESC}[2K│ ${ESC}[36m❯${ESC}[39m`; // truncated mid-frame: no closing border written yet
    expect(looksLikeQuestion(tail)).toBe(true);
  });

  it('returns false after screen clear even when old question text precedes it', () => {
    // Full-screen TUI agents (Copilot CLI) emit \x1b[2J before every redraw.
    // Old question text from a previous render must not survive into the
    // next analysis window once the screen has been cleared and redrawn.
    const ESC = '\x1b';
    const screenClear = `${ESC}[2J`;
    // Simulate: init dialog rendered, then screen cleared, then idle prompt redrawn.
    const tail =
      `│ Would you like to initialize Copilot instructions? │\r\n│ ❯ Yes  No │\r\n` +
      screenClear +
      `│ ❯                                                  │\r\n` +
      `─── Mode: interactive | Model: claude-sonnet-4.5 ───\r\n`;
    expect(looksLikeQuestion(tail)).toBe(false);
  });

  it('returns true when last screen clear is mid-redraw (empty post-clear content)', () => {
    // Ink TUI emits \x1b[2J at the START of each redraw, before writing text.
    // If the tail buffer was captured right after the clear but before the new
    // render's text was written, the post-clear content is empty.  In this case
    // looksLikeQuestion must fall back to the previous complete render to avoid
    // a false negative that lets auto-send fire into the active dialog.
    const ESC = '\x1b';
    const screenClear = `${ESC}[2J`;
    const cursorPos = `${ESC}[H`; // \x1b[H — cursor home, no visible content
    // Previous render: trust dialog. Latest render: just started (post-clear empty).
    const tail = `Confirm folder trust\r\n❯ Yes\r\nNo\r\n` + screenClear + cursorPos; // latest render not yet written
    expect(looksLikeQuestion(tail)).toBe(true);
  });

  it('returns true for active question after screen clear', () => {
    // A real permission dialog emitted *after* a screen clear must still be flagged.
    const ESC = '\x1b';
    const screenClear = `${ESC}[2J`;
    const tail =
      `some earlier output\r\n` + screenClear + `Would you like to allow this action? [Y/n] `;
    expect(looksLikeQuestion(tail)).toBe(true);
  });

  it('returns false for empty input', () => {
    expect(looksLikeQuestion('')).toBe(false);
  });

  it('detects "Do you want to" pattern', () => {
    expect(looksLikeQuestion('Do you want to continue?')).toBe(true);
  });

  it('detects "Would you like to" pattern', () => {
    expect(looksLikeQuestion('Would you like to proceed?')).toBe(true);
  });

  it('detects "Are you sure" pattern', () => {
    expect(looksLikeQuestion('Are you sure you want to delete?')).toBe(true);
  });

  it('detects Copilot CLI "Confirm folder trust" dialog header', () => {
    expect(looksLikeQuestion('Confirm folder trust\n❯ Yes  No')).toBe(true);
  });

  it('detects Copilot CLI trust dialog rendered via cursor-positioning (no newlines)', () => {
    // Copilot CLI (Ink TUI) uses cursor-positioning sequences (\x1b[N;1H) and
    // line-erase (\x1b[2K) instead of \r\n.  After ANSI stripping the entire
    // dialog collapses to one long string.  The question text ("Do you trust
    // the files in this folder?") is in the MIDDLE of the visible output, not
    // within the last 500 chars.  We must NOT use slice(-500).
    const ESC = '\x1b';
    // Simulate Copilot CLI's actual rendering: cursor-positioned lines, no \r\n
    const buildLine = (row: number, content: string) => `${ESC}[${row};1H${ESC}[2K${content}`;
    const tail =
      `${ESC}[?1049h` + // enter alt screen
      buildLine(
        1,
        '╭──────────────────────────────────────────────────────────────────────────────╮',
      ) +
      buildLine(
        2,
        '│ GitHub Copilot v1.0.15                                                       │',
      ) +
      buildLine(
        3,
        '╰──────────────────────────────────────────────────────────────────────────────╯',
      ) +
      buildLine(
        4,
        '╭──────────────────────────────────────────────────────────────────────────────╮',
      ) +
      buildLine(
        5,
        '│ Confirm folder trust                                                         │',
      ) +
      buildLine(
        6,
        '│ ─────────────────────────────────────────────────────────────────────────── │',
      ) +
      buildLine(
        7,
        '│ /some/project/path                                                           │',
      ) +
      buildLine(
        8,
        '│                                                                              │',
      ) +
      buildLine(
        9,
        '│ Do you trust the files in this folder?                                       │',
      ) +
      buildLine(
        10,
        '│                                                                              │',
      ) +
      buildLine(
        11,
        `│ ${ESC}[36m❯ 1. Yes${ESC}[39m                                                                     │`,
      ) +
      buildLine(
        12,
        '│   2. Yes, and remember this folder for future sessions                      │',
      ) +
      buildLine(
        13,
        '│   3. No (Esc)                                                               │',
      ) +
      buildLine(
        14,
        '╰──────────────────────────────────────────────────────────────────────────────╯',
      );
    expect(looksLikeQuestion(tail)).toBe(true);
  });

  it('returns false for normal output without questions', () => {
    expect(looksLikeQuestion('Building project...\nCompiling files...')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// isTrustQuestionAutoHandled
// ---------------------------------------------------------------------------
describe('isTrustQuestionAutoHandled', () => {
  it('returns false when autoTrustFolders is disabled', () => {
    mockAutoTrustFolders = false;
    expect(isTrustQuestionAutoHandled('Do you trust this folder?')).toBe(false);
  });

  it('returns true for trust dialog when autoTrustFolders is enabled', () => {
    mockAutoTrustFolders = true;
    expect(isTrustQuestionAutoHandled('Do you trust this folder?')).toBe(true);
  });

  it('returns true for TUI-garbled trust dialog when autoTrustFolders is enabled', () => {
    mockAutoTrustFolders = true;
    expect(isTrustQuestionAutoHandled('❯1.Yes,Itrustthisfolder')).toBe(true);
  });

  it('returns true for Copilot CLI "Confirm folder trust" dialog when autoTrustFolders is enabled', () => {
    mockAutoTrustFolders = true;
    expect(isTrustQuestionAutoHandled('Confirm folder trust\n❯ Yes  No')).toBe(true);
  });

  it('returns true for garbled Copilot CLI trust dialog when autoTrustFolders is enabled', () => {
    mockAutoTrustFolders = true;
    expect(isTrustQuestionAutoHandled('Confirmfoldertrust❯YesNo')).toBe(true);
  });

  it('returns false when exclusion keywords are present', () => {
    mockAutoTrustFolders = true;
    expect(isTrustQuestionAutoHandled('Do you trust deleting this folder?')).toBe(false);
  });

  it('returns false for non-trust questions even with autoTrust enabled', () => {
    mockAutoTrustFolders = true;
    expect(isTrustQuestionAutoHandled('Do you want to continue? [Y/n]')).toBe(false);
  });

  it('does not false-positive on exclusion keywords in garbled text', () => {
    // "forkeyboardshortcuts" contains "key" but \b prevents matching
    mockAutoTrustFolders = true;
    const garbled = '?forkeyboardshortcuts\nDoyoutrustthisfolder?';
    expect(isTrustQuestionAutoHandled(garbled)).toBe(true);
  });

  it('returns false when "password" exclusion keyword is present', () => {
    mockAutoTrustFolders = true;
    expect(isTrustQuestionAutoHandled('Do you trust this folder? Enter password:')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// isAutoTrustSettling
// ---------------------------------------------------------------------------
describe('isAutoTrustSettling', () => {
  it('returns false for unknown agent', () => {
    expect(isAutoTrustSettling('unknown-agent')).toBe(false);
  });

  it('returns true during auto-trust pending phase', () => {
    mockAutoTrustFolders = true;
    markAgentSpawned('agent-1');

    // Feed trust dialog output to trigger tryAutoTrust via markAgentOutput
    const trustDialog = new TextEncoder().encode('Do you trust this folder?');
    markAgentOutput('agent-1', trustDialog, 'task-1');

    // The 50ms timer is now pending — settling should be true
    expect(isAutoTrustSettling('agent-1')).toBe(true);
  });

  it('returns true during cooldown after auto-trust fires', () => {
    mockAutoTrustFolders = true;
    markAgentSpawned('agent-1');

    const trustDialog = new TextEncoder().encode('Do you trust this folder?');
    markAgentOutput('agent-1', trustDialog, 'task-1');

    // Advance past the 50ms auto-trust timer
    vi.advanceTimersByTime(60);

    // Now in cooldown (3s) and settling (1s) — should still be true
    expect(isAutoTrustSettling('agent-1')).toBe(true);
  });

  it('remains true after settle period lapses while cooldown is still active', () => {
    // The 3s cooldown outlasts the 1s settle period.  isAutoTrustSettling
    // should still return true because isAutoTrustPending (cooldown) is true.
    mockAutoTrustFolders = true;
    markAgentSpawned('agent-1');

    const trustDialog = new TextEncoder().encode('Do you trust this folder?');
    markAgentOutput('agent-1', trustDialog, 'task-1');

    // Advance past auto-trust timer (50ms) + past settle (1000ms) but
    // still within cooldown (1000ms).
    vi.advanceTimersByTime(800);

    // Settle period (1s from acceptance at ~50ms) has lapsed, but cooldown
    // (1s) is still active — settling should still report true.
    expect(isAutoTrustSettling('agent-1')).toBe(true);
  });

  it('returns false after settling period expires', () => {
    mockAutoTrustFolders = true;
    markAgentSpawned('agent-1');

    const trustDialog = new TextEncoder().encode('Do you trust this folder?');
    markAgentOutput('agent-1', trustDialog, 'task-1');

    // 50ms timer + 1000ms cooldown + 1000ms settle = 2050ms total
    vi.advanceTimersByTime(2100);

    expect(isAutoTrustSettling('agent-1')).toBe(false);
  });
});
