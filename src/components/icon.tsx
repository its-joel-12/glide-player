import { SymbolView, type AndroidSymbol, type SFSymbol } from 'expo-symbols';
import type { ColorValue } from 'react-native';

type Props = {
  /** SF Symbol name (iOS, for later) */
  ios: SFSymbol;
  /** Material Symbol name (Android) */
  md: AndroidSymbol;
  size?: number;
  color: ColorValue;
};

export function Icon({ ios, md, size = 22, color }: Props) {
  return <SymbolView name={{ ios, android: md, web: md }} size={size} tintColor={color} />;
}
