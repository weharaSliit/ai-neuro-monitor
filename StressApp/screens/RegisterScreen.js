import React, { useState } from 'react';
import {
  View, Text, StyleSheet, TextInput,
  TouchableOpacity, Alert, KeyboardAvoidingView,
  Platform, ScrollView
} from 'react-native';
import ScreenBackground from '../modules/shared/ScreenBackground';
import Card from '../modules/shared/Card';
import Button from '../modules/shared/Button';
import { COLORS } from '../modules/physiological/config/theme';
import { useAuth } from '../context/AuthContext';

export default function RegisterScreen({ navigation }) {
  const { register } = useAuth();
  const [userId,   setUserId]   = useState('');
  const [name,     setName]     = useState('');
  const [password, setPassword] = useState('');
  const [confirm,  setConfirm]  = useState('');
  const [busy,      setBusy]    = useState(false);

  const text      = COLORS.light.text;
  const muted     = COLORS.light.textMuted;
  const cardHover = COLORS.light.cardHover;
  const border    = COLORS.light.border;

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
    <ScreenBackground>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
          <Card elevated>
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

            <View style={{ marginTop: 6 }}>
              <Button label={busy ? 'Creating account…' : 'Register →'} onPress={submit} loading={busy} />
            </View>

            <TouchableOpacity style={styles.linkRow} onPress={() => navigation.navigate('Login')}>
              <Text style={[styles.linkText, { color: muted }]}>
                Already have an account? <Text style={{ color: COLORS.brand, fontWeight: '700' }}>Log In</Text>
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
  title:        { fontSize: 22, fontWeight: '900' },
  subtitle:     { fontSize: 13, marginTop: 4, marginBottom: 20, lineHeight: 18 },
  label:        { fontSize: 12, fontWeight: '700', marginBottom: 6, marginTop: 4 },
  input:        { borderRadius: 12, borderWidth: 1, padding: 14, fontSize: 15, marginBottom: 12 },
  linkRow:      { marginTop: 18, alignItems: 'center' },
  linkText:     { fontSize: 13 },
});
