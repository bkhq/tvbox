import { normalizeWorkerUrl } from '../workerUrl';

describe('normalizeWorkerUrl', () => {
  it('returns an empty string when unset or blank', () => {
    expect(normalizeWorkerUrl(undefined)).toBe('');
    expect(normalizeWorkerUrl('  ')).toBe('');
  });

  it('strips trailing slashes', () => {
    expect(normalizeWorkerUrl('https://tvbox.example.workers.dev///')).toBe(
      'https://tvbox.example.workers.dev',
    );
  });

  it('keeps a clean URL unchanged', () => {
    expect(normalizeWorkerUrl('https://tvbox.example.workers.dev/u')).toBe(
      'https://tvbox.example.workers.dev/u',
    );
  });
});
