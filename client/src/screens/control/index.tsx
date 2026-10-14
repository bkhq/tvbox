import { useEffect, useReducer, useSyncExternalStore } from 'react';
import { ScrollView, Text, View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';

import { getLanPairing, getLanStatus, refreshLanAddress, subscribeLanStatus } from '../../lan/runtime';
import { useAppNavigation } from '../../navigation/useAppNavigation';
import {
  BackButton,
  Button,
  color,
  fontFamily,
  safeArea,
  scaledText,
  space,
  tabular,
  useLayout,
  useScale,
  useScaledStyles,
  type Scaler,
} from '../../ui';

/** PushActivity opens the web page on its default tab (Server.getAddress(tab)). */
const TAB = 1;

/** QR code edge in design px. */
const QR_SIZE = 320;

/** PushActivity: address QR code, addresses and the pairing code for the phone control page. */
export default function ControlScreen() {
  const navigation = useAppNavigation();
  const { isTV } = useLayout();
  const { s } = useScale();
  const styles = useScaledStyles(makeStyles);
  const status = useSyncExternalStore(subscribeLanStatus, getLanStatus);
  const pairing = getLanPairing();
  const [, rerender] = useReducer((n: number) => n + 1, 0);

  useEffect(() => pairing?.subscribe(rerender), [pairing]);

  // Like PushActivity.initView: a fresh code (and the current IP) each time the screen is shown.
  useEffect(
    () =>
      navigation.addListener('focus', () => {
        getLanPairing()?.refreshCode();
        refreshLanAddress();
      }),
    [navigation],
  );

  const running = status.state === 'running';

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <View style={styles.header}>
        <BackButton testID="control-back" onPress={() => navigation.goBack()} />
        <View style={styles.heading}>
          <Text style={styles.title}>手机控制</Text>
          <Text style={styles.subtitle}>用同一网络下的手机浏览器扫码或打开地址</Text>
        </View>
      </View>
      <View style={styles.body}>
        {running && pairing ? (
          <View style={[styles.cards, isTV && styles.cardsRow]}>
            <View style={styles.card}>
              <View style={styles.qr} testID="control-qr">
                <QRCode
                  value={`${status.address}?tab=${TAB}`}
                  size={s(QR_SIZE)}
                  backgroundColor="#ffffff"
                  color="#000000"
                />
              </View>
            </View>
            <View style={styles.card}>
              <Text style={styles.label}>地址</Text>
              <Text style={styles.address} testID="control-address" selectable>
                {status.address}
              </Text>
              <Text style={styles.localName} testID="control-local-name" selectable>
                {status.localName}
              </Text>
              <Text style={[styles.label, styles.codeLabel]}>配对码</Text>
              <Text style={styles.code} testID="control-code">
                {pairing.getCode()}
              </Text>
              <Text style={styles.devices} testID="control-devices">
                已配对设备 {pairing.devices().length} 台
              </Text>
              <Button
                title="更换配对码"
                variant="secondary"
                size="md"
                hasTVPreferredFocus
                style={styles.button}
                onPress={() => pairing.refreshCode()}
              />
            </View>
          </View>
        ) : status.state === 'error' ? (
          <View style={styles.card} testID="control-error">
            <Text style={styles.message}>手机控制服务未运行</Text>
            {status.error ? <Text style={styles.error}>{status.error}</Text> : null}
          </View>
        ) : (
          <View style={styles.card}>
            <Text style={styles.message}>正在启动手机控制服务…</Text>
          </View>
        )}
      </View>
    </ScrollView>
  );
}

const makeStyles = (s: Scaler) => {
  const t = scaledText(s);
  return {
    screen: { flex: 1, backgroundColor: color.bg },
    content: { flexGrow: 1, paddingHorizontal: s(safeArea.horizontal), paddingVertical: s(safeArea.vertical) },
    header: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: s(space.md) },
    heading: { flexShrink: 1 },
    title: { ...t.h1, color: color.text },
    subtitle: { fontFamily: fontFamily.medium, fontSize: s(22), lineHeight: s(30), color: color.text3 },
    body: { flex: 1, alignItems: 'center' as const, justifyContent: 'center' as const, paddingTop: s(space.lg) },
    cards: { alignItems: 'center' as const, gap: s(space.xl) },
    cardsRow: { flexDirection: 'row' as const, alignItems: 'stretch' as const },
    card: {
      backgroundColor: color.surface,
      borderRadius: s(16),
      padding: s(space.lg),
      justifyContent: 'center' as const,
    },
    qr: { backgroundColor: '#ffffff', borderRadius: s(14), padding: s(24) },
    label: { ...t.caption, color: color.text3 },
    address: { ...t.h2, ...tabular, color: color.text, marginTop: s(space.xs) },
    localName: { ...t.label, color: color.text2, marginTop: s(space.xs) },
    codeLabel: { marginTop: s(space.lg) },
    code: { ...t.displaySm, ...tabular, color: color.accent, marginTop: s(space.xs) },
    devices: {
      fontFamily: fontFamily.medium,
      fontSize: s(22),
      lineHeight: s(30),
      color: color.text2,
      marginTop: s(space.xs),
    },
    button: { alignSelf: 'flex-start' as const, marginTop: s(space.lg) },
    message: { ...t.h2, color: color.text },
    error: { ...t.label, color: color.live, marginTop: s(space.sm) },
  };
};
