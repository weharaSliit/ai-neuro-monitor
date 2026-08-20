import React, { useState } from 'react';
import {
  View, Text, StyleSheet, TextInput,
  TouchableOpacity, Alert, KeyboardAvoidingView,
  Platform, ScrollView
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme } from '../modules/physiological/config/ThemeContext';
import { useAuth } from '../context/AuthContext';

export default function LoginScreen({ navigation }) {
  const { isDark, theme, COLORS } = useTheme();
  const { login } = useAuth();
  const [userId,   setUserId]   = useState('');
  const [password, setPassword] = useState('');
  const [busy,      setBusy]    = useState(false);

  const bg        = theme.bg;
  const card      = theme.card;
  const border    = theme.border;
  const cardHover = theme.cardHover;
  const text      = theme.text;
  const muted     = theme.textMuted;

  const submit = async () => {
    if (!userId.trim() || !password) {
      Alert.alert('Missing info', 'Enter your username and password.');
      return;
    }
    setBusy(true);
    const result = await login(userId.trim(), password);
    setBusy(false);
    if (!result.success) {
      Alert.alert('Login Failed', result.error);
    }
    // On success, RootNavigator swaps stacks automatically once `user` is set.
  };

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: bg }]}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1 }}
      >
        <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
          <View style={styles.logoBlock}>
            <Text style={styles.logoEmoji}>🧠</Text>
            <View style={styles.brandRow}>
              <Text style={[styles.brandText, { color: muted }]}>Mind</Text>
              <Text style={[styles.brandAccent, { color: COLORS.brand }]}>Pulse</Text>
            </View>
            <Text style={[styles.tagline, { color: muted }]}>Stress Detection System</Text>
          </View>

          <View style={[styles.card, { backgroundColor: card, borderColor: border }]}>
            <Text style={[styles.title, { color: text }]}>Welcome back</Text>
            <Text style={[styles.subtitle, { color: muted }]}>Log in to your account</Text>

            <Text style={[styles.label, { color: muted }]}>Username</Text>
            <TextInput
              style={[styles.input, { backgroundColor: cardHover, borderColor: border, color: text }]}
              value={userId}
              onChangeText={setUserId}
              autoCapitalize="none"
              autoCorrect={false}
              placeholder="e.g. Wehara"
              placeholderTextColor={muted}
            />

            <Text style={[styles.label, { color: muted }]}>Password</Text>
            <TextInput
              style={[styles.input, { backgroundColor: cardHover, borderColor: border, color: text }]}
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              placeholder="••••••••"
              placeholderTextColor={muted}
            />

            <TouchableOpacity
              style={[styles.submitBtn, { backgroundColor: COLORS.brand }, busy && { opacity: 0.6 }]}
              onPress={submit}
              disabled={busy}
              activeOpacity={0.85}
            >
              <Text style={styles.submitBtnText}>{busy ? 'Logging in…' : 'Log In →'}</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.linkRow} onPress={() => navigation.navigate('Register')}>
              <Text style={[styles.linkText, { color: muted }]}>
                No account yet? <Text style={{ color: COLORS.brand, fontWeight: '700' }}>Register</Text>
              </Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:         { flex: 1 },
  container:    { flexGrow: 1, justifyContent: 'center', padding: 24 },
  logoBlock:    { alignItems: 'center', marginBottom: 28 },
  logoEmoji:    { fontSize: 48, marginBottom: 8 },
  brandRow:     { flexDirection: 'row' },
  brandText:    { fontSize: 22, fontWeight: '700' },
  brandAccent:  { fontSize: 22, fontWeight: '900' },
  tagline:      { fontSize: 12, marginTop: 4 },
  card:         { borderRadius: 22, borderWidth: 1, padding: 22 },
  title:        { fontSize: 22, fontWeight: '900' },
  subtitle:     { fontSize: 13, marginTop: 4, marginBottom: 20 },
  label:        { fontSize: 12, fontWeight: '700', marginBottom: 6, marginTop: 4 },
  input:        { borderRadius: 12, borderWidth: 1, padding: 14, fontSize: 15, marginBottom: 12 },
  submitBtn:    { padding: 16, borderRadius: 14, alignItems: 'center', marginTop: 10 },
  submitBtnText:{ color: '#fff', fontSize: 15, fontWeight: '800' },
  linkRow:      { marginTop: 18, alignItems: 'center' },
  linkText:     { fontSize: 13 },
});
