import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Modal, ScrollView, Pressable } from 'react-native';
import Icon from './Icon';
import { COLORS } from '../physiological/config/theme';
import { RADIUS, SPACE } from './theme/tokens';

// Select box -- the app twin of the website's <select className="select">.
// options: [{ value, label }]
export default function Dropdown({ value, options, onChange, style }) {
  const [open, setOpen] = useState(false);
  const current = options.find((o) => o.value === value);
  return (
    <>
      <TouchableOpacity style={[styles.box, style]} onPress={() => setOpen(true)} activeOpacity={0.8}>
        <Text style={styles.boxText} numberOfLines={1}>{current?.label ?? 'Select…'}</Text>
        <Icon name="chevron-down" size={18} color={COLORS.light.textSub} />
      </TouchableOpacity>
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setOpen(false)}>
          <View style={styles.sheet}>
            <ScrollView>
              {options.map((o) => {
                const on = o.value === value;
                return (
                  <TouchableOpacity key={String(o.value)} style={[styles.item, on && styles.itemOn]}
                    onPress={() => { onChange(o.value); setOpen(false); }}>
                    <Text style={[styles.itemText, on && styles.itemTextOn]}>{o.label}</Text>
                    {on ? <Icon name="check" size={18} color={COLORS.brand} /> : null}
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </View>
        </Pressable>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  box: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    borderWidth: 1.5, borderColor: COLORS.light.border, backgroundColor: '#FDFCF9',
    borderRadius: RADIUS.sm, paddingHorizontal: 12, paddingVertical: 8, maxWidth: 220,
  },
  boxText: { flexShrink: 1, fontSize: 12, fontWeight: '700', color: COLORS.light.textSub },
  backdrop: { flex: 1, backgroundColor: 'rgba(35,31,32,0.4)', justifyContent: 'center', padding: SPACE.xl },
  sheet: {
    alignSelf: 'center', width: '100%', maxWidth: 420, maxHeight: '70%',
    backgroundColor: COLORS.light.card, borderRadius: RADIUS.xl, paddingVertical: SPACE.sm,
  },
  item: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: SPACE.xl, paddingVertical: 13 },
  itemOn: { backgroundColor: COLORS.brandSoft },
  itemText: { fontSize: 14, fontWeight: '600', color: COLORS.light.text },
  itemTextOn: { fontWeight: '800', color: COLORS.brandDark },
});
