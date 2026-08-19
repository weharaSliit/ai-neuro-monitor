import React, { useState } from 'react';
import {
  View, Text, StyleSheet, TextInput,
  TouchableOpacity, Alert, KeyboardAvoidingView,
  Platform, ScrollView
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme } from '../modules/physiological/config/ThemeContext';
import { useAuth } from '../context/AuthContext';

export default function RegisterScreen({ navigation }) {
  const { isDark, theme, COLORS } = useTheme();
  const { register } = useAuth();
  const [userId,   setUserId]   = useState('');
  const [name,     setName]     = useState('');
  const [password, setPassword] = useState('');
  const [confirm,  setConfirm]  = useState('');
  const [busy,      setBusy]    = useState(false);

  const bg        = theme.bg;
  const card      = theme.card;
  const border    = theme.border;
  const cardHover = theme.cardHover;
  const text      = theme.text;
  const muted     = theme.textMuted;

  const submit = async () => {
    if (!userId.trim() || !password) {
      Alert.alert('Missing info', 'Username and password are required.');
      return;
    }
    if (password.length < 6) {
      Alert.alert('Password too short', 'Use at least 6 characters.');
      return;
    }
    if (password !== confirm) {
      Alert.alert('Passwords don\'t match', 'Re-enter your password to confirm.');
      return;
    }
    setBusy(true);
    const result = await register(userId.trim(), password, name.trim());
    setBusy(false);
    if (!result.success) {
      Alert.alert('Registration Failed', result.error);
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
          <View style={[styles.card, { backgroundColor: card, borderColor: border }]}>
            <Text style={[styles.title, { color: text }]}>Create your account</Text>
            <Text style={[styles.subtitle, { color: muted }]}>
              Your history, calibration, and predictions will be kept under this account only.
            </Text>

            <Text style={[styles.label, { color: muted }]}>Username</Text>
            <TextInput
              style={[styles.input, { backgroundColor: cardHover, borderColor: border, color: text }]}
              value={userId}
              onChangeText={setUserId}
              autoCapitalize="none"
              autoCorrect={false}
              placeholder="letters, numbers, _ or -"
              placeholderTextColor={muted}
            />

            <Text style={[styles.label, { color: muted }]}>Display name (optional)</Text>
            <TextInput
              style={[styles.input, { backgroundColor: cardHover, borderColor: border, color: text }]}
              value={name}
              onChangeText={setName}
              placeholder="defaults to username"
              placeholderTextColor={muted}
            />

            <Text style={[styles.label, { color: muted }]}>Password</Text>
            <TextInput
              style={[styles.input, { backgroundColor: cardHover, borderColor: border, color: text }]}
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              placeholder="at least 6 characters"
              placeholderTextColor={muted}
            />

            <Text style={[styles.label, { color: muted }]}>Confirm password</Text>
            <TextInput
              style={[styles.input, { backgroundColor: cardHover, borderColor: border, color: text }]}
              value={confirm}
              onChangeText={setConfirm}
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
              <Text style={styles.submitBtnText}>{busy ? 'Creating account…' : 'Register →'}</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.linkRow} onPress={() => navigation.navigate('Login')}>
              <Text style={[styles.linkText, { color: muted }]}>
                Already have an account? <Text style={{ color: COLORS.brand, fontWeight: '700' }}>Log In</Text>
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
  card:         { borderRadius: 22, borderWidth: 1, padding: 22 },
  title:        { fontSize: 22, fontWeight: '900' },
  subtitle:     { fontSize: 13, marginTop: 4, marginBottom: 20, lineHeight: 18 },
  label:        { fontSize: 12, fontWeight: '700', marginBottom: 6, marginTop: 4 },
  input:        { borderRadius: 12, borderWidth: 1, padding: 14, fontSize: 15, marginBottom: 12 },
  submitBtn:    { padding: 16, borderRadius: 14, alignItems: 'center', marginTop: 10 },
  submitBtnText:{ color: '#fff', fontSize: 15, fontWeight: '800' },
  linkRow:      { marginTop: 18, alignItems: 'center' },
  linkText:     { fontSize: 13 },
});
