import { getMpvView, isMpvAvailable } from '../../../../../modules/mpv';

// No native module under Jest: the availability check must fall back without throwing.
it('is unavailable without the native module', () => {
  expect(isMpvAvailable()).toBe(false);
  expect(getMpvView()).toBeUndefined();
});
