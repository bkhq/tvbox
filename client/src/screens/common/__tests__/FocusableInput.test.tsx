import { Platform, TextInput } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import { colors } from '../../../ui';
import { FocusableInput } from '../FocusableInput';

describe('FocusableInput', () => {
  let focus: jest.SpyInstance;
  let isTV: jest.SpyInstance;
  beforeEach(() => {
    focus = jest.spyOn(TextInput.prototype, 'focus').mockImplementation(() => undefined);
    isTV = jest.spyOn(Platform, 'isTV', 'get');
  });
  afterEach(() => {
    jest.clearAllMocks();
    jest.restoreAllMocks();
  });

  async function render(props: { hasTVPreferredFocus?: boolean }) {
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(<FocusableInput testID="input" {...props} />);
    });
    return renderer;
  }

  const input = (renderer: ReactTestRenderer) => renderer.root.findByType(TextInput);

  it('takes the TV focus itself when preferred', async () => {
    isTV.mockReturnValue(true);
    const renderer = await render({ hasTVPreferredFocus: false });
    expect(focus).not.toHaveBeenCalled();
    await act(async () => renderer.update(<FocusableInput testID="input" hasTVPreferredFocus />));
    expect(focus).toHaveBeenCalledTimes(1);
    expect(input(renderer).props.hasTVPreferredFocus).toBe(true);
    await act(async () => renderer.unmount());
  });

  it('leaves the focus alone off TV', async () => {
    isTV.mockReturnValue(false);
    const renderer = await render({ hasTVPreferredFocus: true });
    expect(focus).not.toHaveBeenCalled();
    await act(async () => renderer.unmount());
  });

  it('shows a border while focused', async () => {
    const renderer = await render({});
    const border = () => [input(renderer).props.style].flat(3).filter(Boolean).pop().borderColor;
    expect(border()).toBe(colors.border);
    await act(async () => input(renderer).props.onFocus({}));
    expect(border()).toBe(colors.focusBorder);
    await act(async () => input(renderer).props.onBlur({}));
    expect(border()).toBe(colors.border);
    await act(async () => renderer.unmount());
  });
});
