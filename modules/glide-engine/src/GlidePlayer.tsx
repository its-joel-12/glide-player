import { requireNativeView } from 'expo';
import type { Ref } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';

import type { GlidePlayerProps, GlidePlayerRef } from './GlideEngine.types';

type NativeProps = GlidePlayerProps & { ref?: Ref<GlidePlayerRef> };

const NativeView: React.ComponentType<NativeProps> | null =
  Platform.OS === 'android' ? requireNativeView<NativeProps>('GlideEngine') : null;

/** The video surface with the smoothing engine. Android only for now (iOS needs a Metal engine). */
export function GlidePlayer(props: NativeProps) {
  if (!NativeView) {
    return (
      <View style={[props.style, styles.unsupported]}>
        <Text style={styles.text}>Smooth playback needs the Android app.</Text>
      </View>
    );
  }
  return <NativeView {...props} />;
}

const styles = StyleSheet.create({
  unsupported: { backgroundColor: '#000', alignItems: 'center', justifyContent: 'center' },
  text: { color: '#fff' },
});
