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

export default function RegisterScreen({ navigation }) {
  const { register } = useAuth();
  const [userId,   setUserId]   = useState('');
  const [name,     setName]     = useState('');
  const [password, setPassword] = useState('');
  const [confirm,  setConfirm]  = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [busy,     setBusy]    = useState(false);

  const text      = COLORS.light.text;
  const muted     = COLORS.light.textMuted;
  const textSub   = COLORS.light.textSub;
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

          <Card elevated style={styles.card}>
            <Text style={[styles.title, { color: text }]}>Create Account</Text>
            <Text style={[styles.subtitle, { color: muted }]}>
              Join MindPulse to track your neuro-vitality, HRV, and daily stress balance.
            </Text>

            {/* Username */}
            <Text style={[styles.label, { color: textSub }]}>Username</Text>
            <View style={[styles.inputContainer, { backgroundColor: cardHover, borderColor: border }]}>
              <Icon name="account-outline" size={20} color={muted} style={styles.inputIcon} />
              <TextInput
                style={[styles.input, { color: text }]}
                value={userId}
                onChangeText={setUserId}
                autoCapitalize="none"
                autoCorrect={false}
                placeholder="Unique username (e.g. alex_zen)"
                placeholderTextColor={muted}
              />
            </View>

            {/* Display Name */}
            <Text style={[styles.label, { color: textSub }]}>Display Name (optional)</Text>
            <View style={[styles.inputContainer, { backgroundColor: cardHover, borderColor: border }]}>
              <Icon name="badge-account-horizontal-outline" size={20} color={muted} style={styles.inputIcon} />
              <TextInput
                style={[styles.input, { color: text }]}
                value={name}
                onChangeText={setName}
                placeholder="What should we call you?"
                placeholderTextColor={muted}
              />
            </View>

            {/* Password */}
            <Text style={[styles.label, { color: textSub }]}>Password</Text>
            <View style={[styles.inputContainer, { backgroundColor: cardHover, borderColor: border }]}>
              <Icon name="lock-outline" size={20} color={muted} style={styles.inputIcon} />
              <TextInput
                style={[styles.input, { color: text }]}
                value={password}
                onChangeText={setPassword}
                secureTextEntry={!showPassword}
                placeholder="At least 6 characters"
                placeholderTextColor={muted}
              />
              <TouchableOpacity onPress={() => setShowPassword(!showPassword)} style={styles.eyeBtn}>
                <Icon name={showPassword ? "eye-off-outline" : "eye-outline"} size={18} color={muted} />
              </TouchableOpacity>
            </View>

            {/* Confirm Password */}
            <Text style={[styles.label, { color: textSub }]}>Confirm Password</Text>
            <View style={[styles.inputContainer, { backgroundColor: cardHover, borderColor: border }]}>
              <Icon name="lock-check-outline" size={20} color={muted} style={styles.inputIcon} />
              <TextInput
                style={[styles.input, { color: text }]}
                value={confirm}
                onChangeText={setConfirm}
                secureTextEntry={!showPassword}
                placeholder="Re-enter password"
                placeholderTextColor={muted}
              />
            </View>

            <View style={{ marginTop: 10 }}>
              <Button
                label={busy ? 'Creating your space…' : 'Create Account →'}
                onPress={submit}
                loading={busy}
                variant="calm"
                style={styles.submitBtn}
              />
            </View>

            <TouchableOpacity style={styles.linkRow} onPress={() => navigation.navigate('Login')}>
              <Text style={[styles.linkText, { color: muted }]}>
                Already have an account? <Text style={{ color: COLORS.brand, fontWeight: '800' }}>Log In</Text>
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
  card: {
    padding: 24,
  },
  title: {
    fontSize: 24,
    fontWeight: '900',
    letterSpacing: -0.3,
  },
  subtitle: {
    fontSize: 13,
    marginTop: 4,
    marginBottom: 18,
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
    marginTop: 18,
    alignItems: 'center',
  },
  linkText: {
    fontSize: 13,
  },
});
