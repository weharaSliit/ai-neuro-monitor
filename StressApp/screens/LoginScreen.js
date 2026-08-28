import React, { useState } from 'react';
import {
  View, Text, StyleSheet, TextInput,
  TouchableOpacity, Alert, KeyboardAvoidingView,
  Platform, ScrollView
} from 'react-native';
import ScreenBackground from '../modules/shared/ScreenBackground';
import Card from '../modules/shared/Card';
import Button from '../modules/shared/Button';
import Icon, { NAMES } from '../modules/shared/Icon';
import { COLORS } from '../modules/physiological/config/theme';
import { useAuth } from '../context/AuthContext';

export default function LoginScreen({ navigation }) {
  const { login } = useAuth();
  const [userId,   setUserId]   = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [busy,     setBusy]    = useState(false);

  const text      = COLORS.light.text;
  const muted     = COLORS.light.textMuted;
  const textSub   = COLORS.light.textSub;
  const cardHover = COLORS.light.cardHover;
  const border    = COLORS.light.border;

  const submit = async () => {
    if (!userId.trim() || !password) {
      Alert.alert('Missing info', 'Please enter your username and password.');
      return;
    }
    setBusy(true);
    const result = await login(userId.trim(), password);
    setBusy(false);
    if (!result.success) {
      Alert.alert('Login Failed', result.error);
    }
  };

  return (
    <ScreenBackground>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
          {/* Back Action */}
          <TouchableOpacity
            style={styles.backButton}
            onPress={() => navigation.goBack()}
            activeOpacity={0.8}
          >
            <Icon name={NAMES.back} size={22} color={COLORS.brand} />
            <Text style={[styles.backText, { color: COLORS.brand }]}>Back</Text>
          </TouchableOpacity>

          {/* Logo Header Block */}
          <View style={styles.logoBlock}>
            <View style={styles.markRing}>
              <Icon name="brain" size={32} color={COLORS.brand} />
            </View>
            <View style={styles.brandRow}>
              <Text style={[styles.brandText, { color: text }]}>Mind</Text>
              <Text style={[styles.brandAccent, { color: COLORS.brand }]}>Pulse</Text>
            </View>
            <Text style={[styles.tagline, { color: muted }]}>Notice how you feel, in real time</Text>
            <View style={styles.accentBar}>
              <View style={[styles.accentSeg, { backgroundColor: COLORS.brand }]} />
              <View style={[styles.accentSeg, { backgroundColor: COLORS.normal }]} />
            </View>
          </View>

          {/* Main Card */}
          <Card elevated style={styles.loginCard}>
            <Text style={[styles.title, { color: text }]}>Welcome Back</Text>
            <Text style={[styles.subtitle, { color: muted }]}>Log in to access your biometric stress dashboard</Text>

            {/* Username Input */}
            <Text style={[styles.label, { color: textSub }]}>Username</Text>
            <View style={[styles.inputContainer, { backgroundColor: cardHover, borderColor: border }]}>
              <Icon name="account-outline" size={20} color={muted} style={styles.inputIcon} />
              <TextInput
                style={[styles.input, { color: text }]}
                value={userId}
                onChangeText={setUserId}
                autoCapitalize="none"
                autoCorrect={false}
                placeholder="Enter your username"
                placeholderTextColor={muted}
              />
            </View>

            {/* Password Input */}
            <Text style={[styles.label, { color: textSub }]}>Password</Text>
            <View style={[styles.inputContainer, { backgroundColor: cardHover, borderColor: border }]}>
              <Icon name="lock-outline" size={20} color={muted} style={styles.inputIcon} />
              <TextInput
                style={[styles.input, { color: text }]}
                value={password}
                onChangeText={setPassword}
                secureTextEntry={!showPassword}
                placeholder="••••••••"
                placeholderTextColor={muted}
              />
              <TouchableOpacity onPress={() => setShowPassword(!showPassword)} style={styles.eyeBtn}>
                <Icon name={showPassword ? "eye-off-outline" : "eye-outline"} size={18} color={muted} />
              </TouchableOpacity>
            </View>

            <View style={{ marginTop: 10 }}>
              <Button
                label={busy ? 'Signing in…' : 'Sign In →'}
                onPress={submit}
                loading={busy}
                variant="primary"
                style={styles.submitBtn}
              />
            </View>

            <TouchableOpacity style={styles.linkRow} onPress={() => navigation.navigate('Register')}>
              <Text style={[styles.linkText, { color: muted }]}>
                Don’t have an account? <Text style={{ color: COLORS.brand, fontWeight: '800' }}>Create one</Text>
              </Text>
            </TouchableOpacity>
          </Card>
        </ScrollView>
      </KeyboardAvoidingView>
    </ScreenBackground>
  );
}

const styles = StyleSheet.create({
  container: {
    flexGrow: 1,
    paddingHorizontal: 24,
    paddingTop: 12,
    paddingBottom: 32,
    justifyContent: 'center',
  },
  backButton: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
    alignSelf: 'flex-start',
  },
  backText: {
    fontSize: 14,
    fontWeight: '700',
    marginLeft: 2,
  },
  logoBlock: {
    alignItems: 'center',
    marginBottom: 24,
  },
  markRing: {
    width: 68,
    height: 68,
    borderRadius: 34,
    backgroundColor: COLORS.brandSoft,
    borderWidth: 1,
    borderColor: COLORS.brand + '30',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  brandRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  brandText: {
    fontSize: 26,
    fontWeight: '800',
  },
  brandAccent: {
    fontSize: 26,
    fontWeight: '900',
  },
  tagline: {
    fontSize: 13,
    marginTop: 4,
  },
  accentBar: {
    flexDirection: 'row',
    width: 48,
    height: 4,
    borderRadius: 2,
    overflow: 'hidden',
    marginTop: 10,
  },
  accentSeg: {
    flex: 1,
  },
  loginCard: {
    padding: 24,
  },
  title: {
    fontSize: 22,
    fontWeight: '900',
  },
  subtitle: {
    fontSize: 13,
    marginTop: 4,
    marginBottom: 20,
    lineHeight: 18,
  },
  label: {
    fontSize: 12,
    fontWeight: '800',
    marginBottom: 6,
    letterSpacing: 0.2,
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 16,
    borderWidth: 1,
    paddingHorizontal: 14,
    marginBottom: 14,
    height: 50,
  },
  inputIcon: {
    marginRight: 10,
  },
  input: {
    flex: 1,
    fontSize: 14,
    height: '100%',
  },
  eyeBtn: {
    padding: 6,
  },
  submitBtn: {
    borderRadius: 28,
    paddingVertical: 15,
  },
  linkRow: {
    marginTop: 20,
    alignItems: 'center',
  },
  linkText: {
    fontSize: 13,
  },
});
