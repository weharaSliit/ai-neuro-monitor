import React, { useState } from 'react';
import {
  View, Text, StyleSheet, TextInput,
  TouchableOpacity, Alert, KeyboardAvoidingView,
  Platform, ScrollView
} from 'react-native';
import ScreenBackground from '../modules/shared/ScreenBackground';
import Card from '../modules/shared/Card';
import Button from '../modules/shared/Button';
import Icon from '../modules/shared/Icon';
import { COLORS } from '../modules/physiological/config/theme';
import { useAuth } from '../context/AuthContext';

export default function LoginScreen({ navigation }) {
  const { login } = useAuth();
  const [userId,   setUserId]   = useState('');
  const [password, setPassword] = useState('');
  const [busy,      setBusy]    = useState(false);

  const text      = COLORS.light.text;
  const muted     = COLORS.light.textMuted;
  const cardHover = COLORS.light.cardHover;
  const border    = COLORS.light.border;

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
    <ScreenBackground>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
          <View style={styles.logoBlock}>
            <View style={styles.markRing}>
              <Icon name="brain" size={30} color={COLORS.brand} />
            </View>
            <View style={styles.brandRow}>
              <Text style={[styles.brandText, { color: muted }]}>Mind</Text>
              <Text style={[styles.brandAccent, { color: COLORS.brand }]}>Pulse</Text>
            </View>
            <Text style={[styles.tagline, { color: muted }]}>Stress Detection System</Text>
          </View>

          <Card elevated>
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

            <View style={{ marginTop: 6 }}>
              <Button label={busy ? 'Logging in…' : 'Log In →'} onPress={submit} loading={busy} />
            </View>

            <TouchableOpacity style={styles.linkRow} onPress={() => navigation.navigate('Register')}>
              <Text style={[styles.linkText, { color: muted }]}>
                No account yet? <Text style={{ color: COLORS.brand, fontWeight: '700' }}>Register</Text>
              </Text>
            </TouchableOpacity>
          </Card>
        </ScrollView>
      </KeyboardAvoidingView>
    </ScreenBackground>
  );
}

const styles = StyleSheet.create({
  container:    { flexGrow: 1, justifyContent: 'center', padding: 24 },
  logoBlock:    { alignItems: 'center', marginBottom: 28 },
  markRing: {
    width: 64, height: 64, borderRadius: 32,
    backgroundColor: COLORS.brandGlow,
    alignItems: 'center', justifyContent: 'center',
    marginBottom: 10,
  },
  brandRow:     { flexDirection: 'row' },
  brandText:    { fontSize: 22, fontWeight: '700' },
  brandAccent:  { fontSize: 22, fontWeight: '900' },
  tagline:      { fontSize: 12, marginTop: 4 },
  title:        { fontSize: 22, fontWeight: '900' },
  subtitle:     { fontSize: 13, marginTop: 4, marginBottom: 20 },
  label:        { fontSize: 12, fontWeight: '700', marginBottom: 6, marginTop: 4 },
  input:        { borderRadius: 12, borderWidth: 1, padding: 14, fontSize: 15, marginBottom: 12 },
  linkRow:      { marginTop: 18, alignItems: 'center' },
  linkText:     { fontSize: 13 },
});
