// ============================================================
// AuthShell.js — shared layout for Welcome / Login / Register.
// Mirrors the website's sign-in card (web/src/pages/LoginPage.jsx):
// logo tile, large title, one-line subtitle, labelled fields and a
// full-width primary button, on the same pastel background.
// ============================================================
import React, { useState } from 'react';
import {
  View, Text, StyleSheet, TextInput, TouchableOpacity, Image,
  KeyboardAvoidingView, Platform, ScrollView,
} from 'react-native';
import ScreenBackground from './ScreenBackground';
import Icon, { NAMES } from './Icon';
import { COLORS } from '../physiological/config/theme';
import { TYPE, SPACE, RADIUS, ELEVATION } from './theme/tokens';

export function AuthShell({ title, subtitle, onBack, children, footer }) {
  return (
    <ScreenBackground>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          {onBack && (
            <TouchableOpacity style={styles.back} onPress={onBack} activeOpacity={0.8}>
              <Icon name={NAMES.back} size={20} color={COLORS.brand} />
              <Text style={styles.backText}>Back</Text>
            </TouchableOpacity>
          )}
          <View style={styles.card}>
            <Image source={require('../../assets/icon.png')} style={styles.logo} />
            <Text style={styles.title}>{title}</Text>
            {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
            {children}
          </View>
          {footer}
        </ScrollView>
      </KeyboardAvoidingView>
    </ScreenBackground>
  );
}

export function AuthField({ label, icon, secure, value, onChangeText, placeholder, autoCapitalize = 'none', ...rest }) {
  const [show, setShow] = useState(false);
  const [focused, setFocused] = useState(false);
  return (
    <View style={{ marginBottom: SPACE.lg }}>
      <Text style={styles.label}>{label}</Text>
      <View style={[styles.inputWrap, focused && styles.inputFocused]}>
        {icon ? <Icon name={icon} size={19} color={focused ? COLORS.brand : COLORS.light.textMuted} style={{ marginRight: 10 }} /> : null}
        <TextInput
          style={styles.input}
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor={COLORS.light.textMuted}
          secureTextEntry={secure && !show}
          autoCapitalize={autoCapitalize}
          autoCorrect={false}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          {...rest}
        />
        {secure ? (
          <TouchableOpacity onPress={() => setShow((s) => !s)} style={{ padding: 6 }}>
            <Icon name={show ? 'eye-off-outline' : 'eye-outline'} size={18} color={COLORS.light.textMuted} />
          </TouchableOpacity>
        ) : null}
      </View>
    </View>
  );
}

export function PrimaryButton({ label, onPress, busy, variant = 'primary' }) {
  const ghost = variant === 'ghost';
  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={busy}
      activeOpacity={0.85}
      style={[styles.btn, ghost && styles.btnGhost, busy && { opacity: 0.6 }]}
    >
      <Text style={[styles.btnText, ghost && { color: COLORS.light.textSub }]}>{label}</Text>
    </TouchableOpacity>
  );
}

export function SwitchLink({ prompt, action, onPress }) {
  return (
    <TouchableOpacity onPress={onPress} style={{ alignItems: 'center', marginTop: SPACE.xl }}>
      <Text style={styles.switchText}>
        {prompt} <Text style={{ color: COLORS.brand, fontWeight: '800' }}>{action}</Text>
      </Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  scroll: { flexGrow: 1, justifyContent: 'center', padding: SPACE.xl, paddingBottom: SPACE.xxxl },
  back: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', marginBottom: SPACE.lg },
  backText: { color: COLORS.brand, fontWeight: '700', fontSize: 14, marginLeft: 2 },
  card: {
    width: '100%', maxWidth: 440, alignSelf: 'center',
    backgroundColor: COLORS.light.card, borderRadius: RADIUS.xl,
    borderWidth: 1, borderColor: COLORS.light.borderSoft || COLORS.light.border,
    padding: SPACE.xxl + 4, ...ELEVATION.elevated,
  },
  logo: { width: 60, height: 60, borderRadius: 17 },
  title: { ...TYPE.display, fontSize: 26, color: COLORS.light.text, marginTop: SPACE.lg },
  subtitle: { ...TYPE.body, color: COLORS.light.textSub, marginTop: 6, marginBottom: SPACE.xxl, lineHeight: 19 },
  label: { fontSize: 12, fontWeight: '800', color: COLORS.light.textSub, marginBottom: 6 },
  inputWrap: {
    flexDirection: 'row', alignItems: 'center', height: 50,
    borderRadius: RADIUS.md, borderWidth: 1.5, borderColor: COLORS.light.border,
    backgroundColor: '#FDFCF9', paddingHorizontal: 14,
  },
  inputFocused: { borderColor: COLORS.brand, backgroundColor: '#FFFFFF' },
  input: { flex: 1, height: '100%', fontSize: 15, color: COLORS.light.text },
  btn: {
    backgroundColor: COLORS.brand, borderRadius: RADIUS.md, paddingVertical: 15,
    alignItems: 'center', marginTop: SPACE.xs,
  },
  btnGhost: { backgroundColor: COLORS.light.pillBg || '#F0ECE4' },
  btnText: { color: '#FFFFFF', fontWeight: '800', fontSize: 15 },
  switchText: { fontSize: 13, color: COLORS.light.textMuted, fontWeight: '600' },
});
