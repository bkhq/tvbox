import { parseEpisodes } from '../../core/types';
import { nextLine, switchLineNotice } from '../fallback';

const flags = [
  { flag: 'a', episodes: parseEpisodes('E1$a1#E2$a2#E3$a3') },
  { flag: 'empty', episodes: [] },
  { flag: 'b', episodes: parseEpisodes('E3$b3#E2$b2') },
  { flag: 'c', episodes: parseEpisodes('Only$c1') },
];

describe('nextLine', () => {
  it('moves to the next non-empty line matching the episode by name', () => {
    expect(nextLine({ flags, flagIndex: 0, episodeIndex: 1, tried: [0] })).toEqual({ flagIndex: 2, episodeIndex: 1 });
  });

  it('falls back to the same index, clamped', () => {
    expect(nextLine({ flags, flagIndex: 0, episodeIndex: 0, tried: [0] })).toEqual({ flagIndex: 2, episodeIndex: 0 });
    expect(nextLine({ flags, flagIndex: 2, episodeIndex: 1, tried: [2] })).toEqual({ flagIndex: 3, episodeIndex: 0 });
  });

  it('skips tried lines and only looks after the current one', () => {
    expect(nextLine({ flags, flagIndex: 0, episodeIndex: 0, tried: [0, 2] })).toEqual({ flagIndex: 3, episodeIndex: 0 });
    expect(nextLine({ flags, flagIndex: 3, episodeIndex: 0, tried: [3] })).toBeUndefined();
  });

  it('leaves an empty current line by index', () => {
    expect(nextLine({ flags, flagIndex: 1, episodeIndex: 0, tried: [1] })).toEqual({ flagIndex: 2, episodeIndex: 0 });
  });

  it('uses the Java switch-line text', () => {
    expect(switchLineNotice('b')).toBe('正在切换线路至「b」');
  });
});
