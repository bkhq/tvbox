import { StyleSheet, Text, View } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import { Badge } from '../Badge';
import { color } from '../tokens';

void [Text, View];

async function render(element: React.ReactElement) {
  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = create(element);
  });
  return renderer;
}

const style = (renderer: ReactTestRenderer) =>
  StyleSheet.flatten(renderer.root.findAll((n) => n.type === View && n.props.testID === 'badge')[0]!.props.style);
const label = (renderer: ReactTestRenderer) => StyleSheet.flatten(renderer.root.findByType(Text).props.style);

describe('Badge', () => {
  it('renders the outline tag by default', async () => {
    const renderer = await render(<Badge testID="badge" label="4K" />);
    expect(renderer.root.findByType(Text).props.children).toBe('4K');
    expect(style(renderer)).toMatchObject({ borderColor: '#5A6578' });
    expect(style(renderer).borderWidth).toBeGreaterThan(0);
    expect(label(renderer).color).toBe(color.text);
  });

  it('renders the accent tag', async () => {
    const renderer = await render(<Badge testID="badge" label="新片首播" variant="accent" />);
    expect(style(renderer).borderColor).toBe(color.accent);
    expect(label(renderer).color).toBe(color.accent);
  });

  it('renders the live tag with a dot', async () => {
    const renderer = await render(<Badge testID="badge" label="LIVE" variant="live" />);
    expect(style(renderer).backgroundColor).toBe(color.live);
    expect(renderer.root.findAllByType(View)).toHaveLength(2);
  });

  it('uses the tag radius', async () => {
    const outline = await render(<Badge testID="badge" label="HDR" />);
    const live = await render(<Badge testID="badge" label="LIVE" variant="live" />);
    expect(style(outline).borderRadius).toBe(style(live).borderRadius);
    expect(style(outline).borderRadius).toBeGreaterThan(0);
  });
});
