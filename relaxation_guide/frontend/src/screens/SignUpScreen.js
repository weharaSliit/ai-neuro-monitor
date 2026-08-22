import React, { useState, useContext } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  ActivityIndicator
} from 'react-native';
import { AppContext } from '../context/AppContext';
import { ThemeContext } from '../context/ThemeContext';
import { Header } from '../components/Header';
import { apiService } from '../api/apiService';

import { useSweetAlert } from '../context/SweetAlertContext';

export const SignUpScreen = () => {
  const { showAlert } = useSweetAlert();
  const {
    setCurrentScreen,
    setUserEmail,
    setPendingVerificationCode
  } = useContext(AppContext);
  const { theme } = useContext(ThemeContext);

  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  const handleSignUp = async () => {
    if (!email || !fullName || !password) {
      showAlert({
        title: 'Missing Fields',
        text: 'Please fill in all fields (Full Name, Email Address, and Password).',
        icon: 'warning'
      });
      return;
    }
    setLoading(true);
    setErrorMsg('');

    try {
      const res = await apiService.signUp(email, password, fullName);
      setUserEmail(email);
      if (res.verification_code) {
        setPendingVerificationCode(res.verification_code);
      }

      showAlert({
        title: 'Account Created! 🔐',
        text: `Authorization code sent to ${email}. Please enter your 6-digit code to authorize your email.`,
        icon: 'success',
        confirmButtonText: 'Enter Code',
        onConfirm: () => setCurrentScreen('EmailVerification')
      });
    } catch (e) {
      const msg = e.message || 'Registration error. Please check your credentials.';
      setErrorMsg(msg);
      showAlert({
        title: 'Registration Error',
        text: msg,
        icon: 'error'
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={[styles.container, { backgroundColor: theme.bgPrimary }]}>
      <Header title="Create Account" showBack onBack={() => setCurrentScreen('Welcome')} />

      <View style={styles.body}>
        <Text style={[styles.heading, { color: theme.textPrimary }]}>Join CAPS Study</Text>
        <Text style={[styles.sub, { color: theme.textSecondary }]}>
          Register your participant profile. Email authorization is required to activate sign-in.
        </Text>

        {errorMsg ? (
          <View style={styles.errorBox}>
            <Text style={styles.errorTxt}>⚠️ {errorMsg}</Text>
          </View>
        ) : null}

        <View style={styles.inputGroup}>
          <Text style={[styles.label, { color: theme.textSecondary }]}>Full Name</Text>
          <TextInput
            style={[styles.input, { backgroundColor: theme.bgCard, color: theme.textPrimary, borderColor: theme.border }]}
            value={fullName}
            onChangeText={setFullName}
            placeholder="Jane Doe"
            placeholderTextColor={theme.textMuted}
          />
        </View>

        <View style={styles.inputGroup}>
          <Text style={[styles.label, { color: theme.textSecondary }]}>Email Address</Text>
          <TextInput
            style={[styles.input, { backgroundColor: theme.bgCard, color: theme.textPrimary, borderColor: theme.border }]}
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            keyboardType="email-address"
            placeholder="jane@research.org"
            placeholderTextColor={theme.textMuted}
          />
        </View>

        <View style={styles.inputGroup}>
          <Text style={[styles.label, { color: theme.textSecondary }]}>Password</Text>
          <TextInput
            style={[styles.input, { backgroundColor: theme.bgCard, color: theme.textPrimary, borderColor: theme.border }]}
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            placeholder="••••••••"
            placeholderTextColor={theme.textMuted}
          />
        </View>

        <TouchableOpacity
          style={[styles.primaryBtn, { backgroundColor: theme.accent }]}
          onPress={handleSignUp}
          disabled={loading}
        >
          {loading ? (
            <ActivityIndicator color={theme.accentText} />
          ) : (
            <Text style={[styles.primaryBtnTxt, { color: theme.accentText }]}>Create & Request Verification →</Text>
          )}
        </TouchableOpacity>

        <TouchableOpacity style={styles.switchBtn} onPress={() => setCurrentScreen('SignIn')}>
          <Text style={[styles.switchTxt, { color: theme.textMuted }]}>
            Already have an account? <Text style={{ color: theme.accent, fontWeight: '700' }}>Sign In</Text>
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1
  },
  body: {
    padding: 24,
    flex: 1,
    justifyContent: 'center'
  },
  heading: {
    fontSize: 24,
    fontWeight: '800',
    marginBottom: 6
  },
  sub: {
    fontSize: 14,
    marginBottom: 16
  },
  errorBox: {
    backgroundColor: 'rgba(239, 68, 68, 0.15)',
    borderColor: '#EF4444',
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    marginBottom: 16,
  },
  errorTxt: {
    color: '#EF4444',
    fontSize: 13,
    fontWeight: '700',
  },
  inputGroup: {
    marginBottom: 14
  },
  label: {
    fontSize: 12,
    fontWeight: '600',
    marginBottom: 6
  },
  input: {
    borderRadius: 12,
    padding: 14,
    fontSize: 15,
    borderWidth: 1
  },
  primaryBtn: {
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
    marginTop: 10
  },
  primaryBtnTxt: {
    fontWeight: '800',
    fontSize: 16
  },
  switchBtn: {
    marginTop: 16,
    alignItems: 'center'
  },
  switchTxt: {
    fontSize: 13
  }
});
