import { useEffect, useReducer, useSyncExternalStore } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';

import { getLanPairing, getLanStatus, refreshLanAddress, subscribeLanStatus } from '../../lan/runtime';
import { useAppNavigation } from '../../navigation/useAppNavigation';
import { colors, FocusableButton, fontSize, spacing, useLayout } from '../../ui';

/** PushActivity opens the web page on its default tab (Server.getAddress(tab)). */
const TAB = 1;

/** PushActivity: address QR code, addresses and the pairing code for the phone control page. */
export default function ControlScreen() {
  const navigation = useAppNavigation();
  const { isTV, scale } = useLayout();
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
  const qrSize = Math.round((isTV ? 220 : 200) * scale);

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Text style={styles.title}>手机控制</Text>
      {running && pairing ? (
        <View style={[styles.body, isTV && styles.bodyTV]}>
          <View style={styles.qr} testID="control-qr">
            <QRCode value={`${status.address}?tab=${TAB}`} size={qrSize} backgroundColor="#ffffff" color="#000000" />
          </View>
          <View style={[styles.info, isTV && styles.infoTV]}>
            <Text style={styles.hint}>用同一网络下的手机浏览器扫码或打开地址</Text>
            <Text style={styles.address} testID="control-address" selectable>
              {status.address}
            </Text>
            <Text style={styles.address} testID="control-local-name" selectable>
              {status.localName}
            </Text>
            <Text style={styles.code} testID="control-code">
              配对码 {pairing.getCode()}
            </Text>
            <Text style={styles.devices} testID="control-devices">
              已配对设备 {pairing.devices().length} 台
            </Text>
            <FocusableButton title="更换配对码" hasTVPreferredFocus style={styles.button} onPress={() => pairing.refreshCode()} />
          </View>
        </View>
      ) : status.state === 'error' ? (
        <View style={styles.message} testID="control-error">
          <Text style={styles.hint}>手机控制服务未运行</Text>
          {status.error ? <Text style={styles.error}>{status.error}</Text> : null}
        </View>
      ) : (
        <View style={styles.message}>
          <Text style={styles.hint}>正在启动手机控制服务…</Text>
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
  },
  title: {
    color: colors.text,
    fontSize: fontSize.display,
    marginBottom: spacing.xl,
  },
  body: {
    alignItems: 'center',
  },
  bodyTV: {
    flexDirection: 'row',
  },
  qr: {
    padding: spacing.md,
    backgroundColor: '#ffffff',
  },
  info: {
    alignItems: 'center',
    marginTop: spacing.xl,
  },
  infoTV: {
    alignItems: 'flex-start',
    marginTop: 0,
    marginLeft: spacing.xl,
  },
  hint: {
    color: colors.textSecondary,
    fontSize: fontSize.title,
    marginBottom: spacing.md,
  },
  address: {
    color: colors.text,
    fontSize: fontSize.heading,
    marginBottom: spacing.sm,
  },
  code: {
    color: colors.text,
    fontSize: fontSize.display,
    fontWeight: 'bold',
    marginTop: spacing.md,
  },
  devices: {
    color: colors.textSecondary,
    fontSize: fontSize.body,
    marginTop: spacing.sm,
  },
  button: {
    marginTop: spacing.lg,
  },
  message: {
    alignItems: 'center',
  },
  error: {
    color: colors.textSecondary,
    fontSize: fontSize.body,
  },
});
