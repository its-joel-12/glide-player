import { Pressable, StyleSheet, TextInput, View } from 'react-native';

import { Icon } from '@/components/icon';
import { ThemedText } from '@/components/themed-text';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { deleteSkipRule, newSkipButton, updateSkipRule, type SkipButton, type SkipRule } from '@/lib/skip-buttons';
import { clampSkipSeconds, findRule } from '@/lib/skip-rules';

/** Edits one series' skip buttons: the name words to match, and each button's label and seconds. Saves as you go. */
export function SkipRuleEditor({ rule, title, onDeleted }: { rule: SkipRule; /** The playing video's name, to say whether it matches. */ title?: string; onDeleted?: () => void }) {
  const theme = useTheme();
  const setButtons = (buttons: SkipButton[]) => updateSkipRule(rule.id, { buttons });
  const change = (id: string, c: Partial<SkipButton>) => setButtons(rule.buttons.map((b) => (b.id === id ? { ...b, ...c } : b)));
  const matches = title === undefined ? undefined : findRule(title, [rule]) !== undefined;
  const input = [styles.input, { color: theme.text, backgroundColor: theme.backgroundElement, borderColor: theme.border }];

  return (
    <View style={{ gap: Spacing.two }}>
      <ThemedText type="label" themeColor="textSecondary">
        Series name
      </ThemedText>
      <TextInput
        value={rule.match}
        onChangeText={(match) => updateSkipRule(rule.id, { match })}
        placeholder="e.g. jujutsu kaisen"
        placeholderTextColor={theme.textSecondary}
        autoCorrect={false}
        autoCapitalize="none"
        accessibilityLabel="Series name to match in file names"
        style={input}
      />
      <ThemedText type="caption" themeColor="textSecondary">
        Videos whose file name contains all of these words show the buttons when you tap the screen.
        {matches === undefined ? '' : matches ? ' This video matches.' : ' This video doesn’t match these words.'}
      </ThemedText>

      <ThemedText type="label" themeColor="textSecondary" style={{ marginTop: Spacing.one }}>
        Buttons
      </ThemedText>
      {rule.buttons.map((b) => (
        <View key={b.id} style={[styles.button, { borderColor: theme.border }]}>
          <View style={styles.row}>
            <TextInput
              value={b.label}
              onChangeText={(label) => change(b.id, { label })}
              placeholder="Skip intro"
              placeholderTextColor={theme.textSecondary}
              accessibilityLabel="Button label"
              style={[input, { flex: 1 }]}
            />
            <Pressable onPress={() => setButtons(rule.buttons.filter((x) => x.id !== b.id))} hitSlop={8} accessibilityRole="button" accessibilityLabel={`Remove ${b.label}`} style={styles.icon}>
              <Icon ios="trash" md="delete" size={20} color={theme.textSecondary} />
            </Pressable>
          </View>
          <View style={styles.row}>
            {[-10, -1].map((d) => (
              <Step key={d} d={d} onPress={() => change(b.id, { seconds: clampSkipSeconds(b.seconds + d) })} />
            ))}
            <ThemedText type="smallBold" font="mono" style={styles.value} accessibilityLabel={`Skips ${b.seconds} seconds`}>
              +{b.seconds} s
            </ThemedText>
            {[1, 10].map((d) => (
              <Step key={d} d={d} onPress={() => change(b.id, { seconds: clampSkipSeconds(b.seconds + d) })} />
            ))}
          </View>
        </View>
      ))}
      <View style={styles.row}>
        <Pressable
          onPress={() => setButtons([...rule.buttons, newSkipButton(rule.buttons.length ? 'Skip ending' : undefined)])}
          accessibilityRole="button"
          style={({ pressed }) => [styles.action, { backgroundColor: pressed ? theme.backgroundSelected : theme.backgroundElement }]}>
          <Icon ios="plus" md="add" size={18} color={theme.text} />
          <ThemedText type="smallBold">Add a button</ThemedText>
        </Pressable>
        <Pressable
          onPress={() => {
            deleteSkipRule(rule.id);
            onDeleted?.();
          }}
          accessibilityRole="button"
          accessibilityLabel={`Delete skip buttons for ${rule.match || 'this series'}`}
          style={({ pressed }) => [styles.action, { backgroundColor: pressed ? theme.backgroundSelected : 'transparent' }]}>
          <Icon ios="trash" md="delete" size={18} color={theme.textSecondary} />
          <ThemedText type="smallBold" themeColor="textSecondary">
            Delete series
          </ThemedText>
        </Pressable>
      </View>
    </View>
  );
}

function Step({ d, onPress }: { d: number; onPress: () => void }) {
  const theme = useTheme();
  const text = `${d > 0 ? '+' : '−'}${Math.abs(d)}`;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${d > 0 ? 'Plus' : 'Minus'} ${Math.abs(d)} seconds`}
      style={({ pressed }) => [styles.step, { backgroundColor: theme.backgroundElement, opacity: pressed ? 0.7 : 1 }]}>
      <ThemedText type="smallBold">{text}</ThemedText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  input: { borderWidth: 1, borderRadius: Radius.button, paddingHorizontal: 12, paddingVertical: 8, fontSize: 16 },
  button: { borderWidth: 1, borderRadius: Radius.button, padding: Spacing.two, gap: Spacing.two },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one },
  icon: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  value: { flex: 1, textAlign: 'center' },
  step: { minWidth: 52, alignItems: 'center', paddingVertical: Spacing.two, borderRadius: Radius.button },
  action: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 10, borderRadius: Radius.button },
});
