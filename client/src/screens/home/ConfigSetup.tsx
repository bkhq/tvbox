import { useState } from 'react';
import { Text, View } from 'react-native';

import { useVodConfig } from '../../core/bootstrap';
import { Button, color, radii, safeArea, scaledText, space, useScaledStyles, type Scaler } from '../../ui';
import { FocusableInput, LoadingView } from '../common';

function AddConfigForm({ preferFocus }: { preferFocus: boolean }) {
  const { addConfig } = useVodConfig();
  const styles = useScaledStyles(makeStyles);
  const [url, setUrl] = useState('');
  const submit = () => {
    if (url.trim()) void addConfig(url);
  };
  return (
    <View style={styles.form}>
      <FocusableInput
        testID="home-config-input"
        style={styles.input}
        value={url}
        onChangeText={setUrl}
        onSubmitEditing={submit}
        placeholder="输入配置地址"
        placeholderTextColor={color.text3}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="url"
        hasTVPreferredFocus={preferFocus}
      />
      <Button testID="home-config-add" title="添加配置" variant="primary" disabled={!url.trim()} onPress={submit} />
    </View>
  );
}

/** Body of the home screen until a config is ready: loading, load error with retry, or the add-config form. */
export function ConfigSetup() {
  const { status, error, reload } = useVodConfig();
  const styles = useScaledStyles(makeStyles);
  if (status === 'loading') return <LoadingView text="正在加载配置…" />;
  return (
    <View style={styles.container}>
      {status === 'error' ? (
        <View style={styles.error}>
          <Text style={styles.message}>{`配置加载失败：${error?.message ?? ''}`}</Text>
          <Button
            testID="home-reload"
            title="重试"
            variant="primary"
            size="md"
            hasTVPreferredFocus
            onPress={() => void reload()}
          />
        </View>
      ) : (
        <Text style={styles.message}>尚未添加配置</Text>
      )}
      <AddConfigForm preferFocus={status === 'empty'} />
    </View>
  );
}

const makeStyles = (s: Scaler) => {
  const text = scaledText(s);
  return {
    container: { flex: 1, paddingHorizontal: s(safeArea.horizontal), paddingTop: s(space.lg), gap: s(space.lg) },
    error: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: s(space.md) },
    message: { ...text.h2, color: color.text },
    form: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: s(space.md), maxWidth: s(1200) },
    input: {
      ...text.body,
      flex: 1,
      height: s(76),
      paddingHorizontal: s(space.md),
      borderRadius: s(radii.button),
      backgroundColor: color.surface,
      color: color.text,
    },
  };
};
