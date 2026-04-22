import { describe, expect, it } from 'vitest';
import {
  AUTO_TASK_NAME_MAX_LENGTH,
  DISPLAY_TASK_NAME_MAX_LENGTH,
  autoTaskNameFromPrompt,
  cleanTaskName,
  displayTaskNameFromPrompt,
  isAutoTaskNameFromPrompt,
} from './clean-task-name';

describe('cleanTaskName', () => {
  it('removes stacked filler prefixes', () => {
    expect(cleanTaskName('Please try to shorten the task name')).toBe('shorten the task name');
  });
});

describe('autoTaskNameFromPrompt', () => {
  it('uses the cleaned first line when it fits', () => {
    expect(autoTaskNameFromPrompt('we should shorten the task name slightly less')).toBe(
      'shorten the task name slightly less',
    );
  });

  it('keeps a bit more text before truncating on a word boundary', () => {
    expect(
      autoTaskNameFromPrompt(
        'please improve the task name generation so it keeps a little more detail before truncating',
      ),
    ).toBe('improve the task name generation so it');
  });

  it('falls back to a hard cut when the first word exceeds the limit', () => {
    expect(autoTaskNameFromPrompt(`please ${'a'.repeat(AUTO_TASK_NAME_MAX_LENGTH + 5)}`)).toBe(
      'a'.repeat(AUTO_TASK_NAME_MAX_LENGTH),
    );
  });

  it('ignores later lines', () => {
    expect(autoTaskNameFromPrompt('please shorten this title\nbut ignore this line')).toBe(
      'shorten this title',
    );
  });
});

describe('displayTaskNameFromPrompt', () => {
  it('keeps more context for visible task titles', () => {
    expect(
      displayTaskNameFromPrompt(
        'please improve the task name generation so it keeps a little more detail before truncating',
      ),
    ).toBe('improve the task name generation so it keeps a little more detail before truncating');
  });

  it('still caps very long display titles on a word boundary', () => {
    expect(
      displayTaskNameFromPrompt(`please ${'alpha '.repeat(40).trim()}`).length,
    ).toBeLessThanOrEqual(DISPLAY_TASK_NAME_MAX_LENGTH);
  });
});

describe('isAutoTaskNameFromPrompt', () => {
  it('matches the restored 40-character auto name', () => {
    expect(
      isAutoTaskNameFromPrompt(
        'improve the task name generation so it',
        'please improve the task name generation so it keeps a little more detail before truncating',
      ),
    ).toBe(true);
  });

  it('matches the temporary 50-character auto name from the previous change', () => {
    expect(
      isAutoTaskNameFromPrompt(
        'improve the task name generation so it keeps a',
        'please improve the task name generation so it keeps a little more detail before truncating',
      ),
    ).toBe(true);
  });

  it('does not match a custom task name', () => {
    expect(
      isAutoTaskNameFromPrompt(
        'custom display title',
        'please improve the task name generation so it keeps a little more detail before truncating',
      ),
    ).toBe(false);
  });
});
