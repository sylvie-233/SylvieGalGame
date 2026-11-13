import { describe, expect, it } from 'vitest';

import {
  countCleanNotes,
  ECHO_KEYS,
  ECHO_MAX_SCORE,
  ECHO_PHRASE,
  isEchoKey,
} from '../src/echo/notes';

describe('回声小游戏的纯数据', () => {
  it('八个音全部落在有效的四个琴键上', () => {
    expect(ECHO_PHRASE).toHaveLength(8);
    for (const note of ECHO_PHRASE) {
      expect(isEchoKey(note)).toBe(true);
    }
  });

  it('满分音符数等于旋律长度', () => {
    expect(ECHO_MAX_SCORE).toBe(ECHO_PHRASE.length);
    expect(new Array<boolean>(ECHO_MAX_SCORE).fill(true)).toHaveLength(8);
  });

  it('四个琴键按音高从低到高排列', () => {
    expect(ECHO_KEYS.map((key) => key.label)).toEqual(['1', '2', '3', '4']);
    const frequencies = ECHO_KEYS.map((key) => key.frequency);
    expect(frequencies).toEqual([...frequencies].sort((left, right) => left - right));
  });

  it('只统计一次就按对的音', () => {
    expect(countCleanNotes([true, true, true, true, true, true, true, true])).toBe(8);
    expect(countCleanNotes([true, false, true, false, true, true, false, true])).toBe(5);
    expect(countCleanNotes([])).toBe(0);
  });

  it('拒绝越界与非整数的琴键下标', () => {
    expect(isEchoKey(-1)).toBe(false);
    expect(isEchoKey(ECHO_KEYS.length)).toBe(false);
    expect(isEchoKey(1.5)).toBe(false);
    expect(isEchoKey(0)).toBe(true);
  });
});
