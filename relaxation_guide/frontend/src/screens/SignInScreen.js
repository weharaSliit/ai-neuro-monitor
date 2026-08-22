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

export const SignInScreen = () => {
  const { showAlert } = useSweetAlert();
  const {
    setCurrentScreen,
    setUserId,
    setUsername,
    setUserEmail,
    setCurrentRecommendation,
    setSelectedSubOption,
    setHistoryList
  } = useContext(AppContext);
  const { theme } = useContext(ThemeContext);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [requiresVerification, setRequiresVerification] = useState(false);

  const handleSignIn = async () => {
    if (!email || !password) {
      showAlert({
        title: 'Missing Credentials',
        text: 'Please enter both your email address and password.',
        icon: 'warning'
      });
      return;
    }

    setLoading(true);
    setErrorMsg('');
    setRequiresVerification(false);

    try {
      const res = await apiService.signIn(email, password);
      setCurrentRecommendation(null);
      setSelectedSubOption(null);
      setHistoryList([]);
      setUserId(res.user_id);
      setUsername(res.full_name);
      setUserEmail(res.email);

      showAlert({
        title: 'Sign In Successful! 🎉',
        text: `Welcome back, ${res.full_name}!`,
        icon: 'success',
        timer: 2000
      });

      setCurrentScreen('PrivacyPolicy');
    } catch (e) {
      const msg = e.message || 'Sign in error.';
      setErrorMsg(msg);
      if (msg.toLowerCase().includes('pending') || msg.toLowerCase().includes('authorize')) {
        setUserEmail(email);
        setRequiresVerification(true);
        showAlert({
          title: 'Email Authorization Pending',
          text: 'Please enter the 6-digit verification code sent to your email address.',
          icon: 'warning',
          confirmButtonText: 'Authorize Email',
          onConfirm: () => setCurrentScreen('EmailVerification')
        });
      } else {
        showAlert({
          title: 'Authentication Failed',
          text: msg,
          icon: 'error'
        });
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={[styles.container, { backgroundColor: theme.bgPrimary }]}>
      <Header title="Sign In" showBack onBack={() => setCurrentScreen('Welcome')} />

      <View style={styles.body}>
        <Text style={[styles.heading, { color: theme.textPrimary }]}>Welcome Back</Text>
        <Text style={[styles.sub, { color: theme.textSecondary }]}>
          Sign in to access your closed-loop stress profiles and badges.
        </Text>

        {errorMsg ? (
          <View style={styles.errorBox}>
            <Text style={styles.errorTxt}>⚠️ {errorMsg}</Text>
            {requiresVerification && (
              <TouchableOpacity
                style={styles.verifyLinkBtn}
                onPress={() => setCurrentScreen('EmailVerification')}
              >
                <Text style={styles.verifyLinkTxt}>👉 Enter Email Authorization Code →</Text>
              </TouchableOpacity>
            )}
          </View>
        ) : null}

        <View style={styles.inputGroup}>
          <Text style={[styles.label, { color: theme.textSecondary }]}>Email Address</Text>
          <TextInput
            style={[styles.input, { backgroundColor: theme.bgCard, color: theme.textPrimary, borderColor: theme.border }]}
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            keyboardType="email-address"
            placeholder="your_email@domain.com"
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
          onPress={handleSignIn}
          disabled={loading}
        >
          {loading ? (
            <ActivityIndicator color={theme.accentText} />
          ) : (
            <Text style={[styles.primaryBtnTxt, { color: theme.accentText }]}>Sign In →</Text>
          )}
        </TouchableOpacity>

        <TouchableOpacity style={styles.switchBtn} onPress={() => setCurrentScreen('SignUp')}>
          <Text style={[styles.switchTxt, { color: theme.textMuted }]}>
            Don't have an account? <Text style={{ color: theme.accent, fontWeight: '700' }}>Sign Up</Text>
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
    marginBottom: 20
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
  verifyLinkBtn: {
    marginTop: 8,
    backgroundColor: '#EF4444',
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 8,
    alignSelf: 'flex-start',
  },
  verifyLinkTxt: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '800',
  },
  inputGroup: {
    marginBottom: 16
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
    marginTop: 20,
    alignItems: 'center'
  },
  switchTxt: {
    fontSize: 13
  }
});
