import { Text } from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import { MemoryStore } from '../../../core/storage';
import { counterBytes } from '../../../lan/__fixtures__/fakes';
import { createPairing, type Pairing } from '../../../lan/pairing';
import type { LanStatus } from '../../../lan/runtime';
import ControlScreen from '..';

const mockFocusListeners: (() => void)[] = [];
jest.mock('../../../navigation/useAppNavigation', () => ({
  useAppNavigation: () => ({
    navigate: jest.fn(),
    addListener: (_event: string, listener: () => void) => {
      mockFocusListeners.push(listener);
      return () => mockFocusListeners.splice(mockFocusListeners.indexOf(listener), 1);
    },
  }),
}));

const mockRuntime: { status: LanStatus; pairing: Pairing | null; listeners: Set<() => void>; refreshLanAddress: jest.Mock } = {
  status: { state: 'idle', port: null, address: '', localName: '', error: null },
  pairing: null,
  listeners: new Set(),
  refreshLanAddress: jest.fn(),
};
jest.mock('../../../lan/runtime', () => ({
  getLanStatus: () => mockRuntime.status,
  getLanPairing: () => mockRuntime.pairing,
  subscribeLanStatus: (listener: () => void) => {
    mockRuntime.listeners.add(listener);
    return () => mockRuntime.listeners.delete(listener);
  },
  refreshLanAddress: () => mockRuntime.refreshLanAddress(),
}));

const RUNNING: LanStatus = {
  state: 'running',
  port: 9978,
  address: 'http://192.168.1.5:9978',
  localName: 'http://tvbox.local:9978',
  error: null,
};

function texts(renderer: ReactTestRenderer): string[] {
  return renderer.root.findAllByType(Text).map((node) => [node.props.children].flat().join(''));
}

function render(): ReactTestRenderer {
  let renderer!: ReactTestRenderer;
  act(() => {
    renderer = create(<ControlScreen />);
  });
  return renderer;
}

beforeEach(() => {
  mockFocusListeners.length = 0;
  mockRuntime.status = RUNNING;
  mockRuntime.pairing = createPairing({ store: new MemoryStore(), randomBytes: counterBytes(7) });
  mockRuntime.refreshLanAddress.mockClear();
});

describe('ControlScreen', () => {
  it('shows the QR code, addresses, pairing code and paired devices', () => {
    const renderer = render();
    const shown = texts(renderer);
    expect(shown).toContain('手机控制');
    expect(shown).toContain('用同一网络下的手机浏览器扫码或打开地址');
    expect(shown).toContain('http://192.168.1.5:9978');
    expect(shown).toContain('http://tvbox.local:9978');
    expect(shown).toContain(`配对码 ${mockRuntime.pairing!.getCode()}`);
    expect(shown).toContain('已配对设备 0 台');
    expect(renderer.root.findByType(QRCode).props.value).toBe('http://192.168.1.5:9978?tab=1');
  });

  it('refreshes the code and the address when focused', () => {
    const renderer = render();
    const before = mockRuntime.pairing!.getCode();
    act(() => mockFocusListeners.forEach((listener) => listener()));
    const after = mockRuntime.pairing!.getCode();
    expect(after).not.toBe(before);
    expect(texts(renderer)).toContain(`配对码 ${after}`);
    expect(mockRuntime.refreshLanAddress).toHaveBeenCalled();
  });

  it('updates the device count when a phone pairs', async () => {
    const renderer = render();
    const pairing = mockRuntime.pairing!;
    await act(async () => {
      await pairing.pair(pairing.getCode(), 'Phone', 'UA', '192.168.1.20');
    });
    expect(texts(renderer)).toContain('已配对设备 1 台');
    expect(texts(renderer)).toContain(`配对码 ${pairing.getCode()}`);
  });

  it('shows the error when the server is not running', () => {
    mockRuntime.status = { ...RUNNING, state: 'error', port: null, address: '', localName: '', error: 'Httpd native module is not available' };
    const renderer = render();
    expect(texts(renderer)).toEqual(expect.arrayContaining(['手机控制服务未运行', 'Httpd native module is not available']));
    expect(renderer.root.findAllByType(QRCode)).toHaveLength(0);
  });

  it('follows status changes', () => {
    mockRuntime.status = { state: 'starting', port: null, address: '', localName: '', error: null };
    const renderer = render();
    expect(texts(renderer)).toContain('正在启动手机控制服务…');
    act(() => {
      mockRuntime.status = RUNNING;
      mockRuntime.listeners.forEach((listener) => listener());
    });
    expect(texts(renderer)).toContain('http://192.168.1.5:9978');
  });
});
