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

export const EmailVerificationScreen = () => {
  const { showAlert } = useSweetAlert();
  const {
    setCurrentScreen,
    setUserId,
    setUsername,
    userEmail,
    setCurrentRecommendation,
    setSelectedSubOption,
    setHistoryList
  } = useContext(AppContext);

  const { theme } = useContext(ThemeContext);

  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [infoMsg, setInfoMsg] = useState(
    `An authorization code has been sent to ${userEmail || 'your email'}. Please check your inbox and enter the 6-digit code below.`
  );

  const handleVerify = async () => {
    if (!code || code.length < 5) {
      showAlert({
        title: 'Invalid Code',
        text: 'Please enter your 6-digit authorization code.',
        icon: 'warning'
      });
      return;
    }

    setLoading(true);
    setErrorMsg('');
    try {
      const res = await apiService.verifyEmail(userEmail, code);
      setCurrentRecommendation(null);
      setSelectedSubOption(null);
      setHistoryList([]);
      setUserId(res.user_id);
      setUsername(res.full_name);

      showAlert({
        title: 'Email Authorized! Verified 🎉',
        text: `Welcome ${res.full_name}, your email authorization is verified.`,
        icon: 'success',
        timer: 2000
      });

      setCurrentScreen('OnboardingQuestions');
    } catch (err) {
      const msg = err.message || 'Verification failed. Please try again.';
      setErrorMsg(msg);
      showAlert({
        title: 'Verification Failed',
        text: msg,
        icon: 'error'
      });
    } finally {
      setLoading(false);
    }
  };

  const handleResend = async () => {
    setLoading(true);
    setErrorMsg('');
    try {
      const res = await apiService.resendCode(userEmail);
      const msg = `A new 6-digit authorization code has been dispatched to ${userEmail}. Please check your inbox.`;
      setInfoMsg(msg);

      showAlert({
        title: 'Authorization Code Resent 📧',
        text: msg,
        icon: 'info'
      });
    } catch (err) {
      const msg = err.message || 'Failed to resend code.';
      setErrorMsg(msg);
      showAlert({
        title: 'Resend Failed',
        text: msg,
        icon: 'error'
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={[styles.container, { backgroundColor: theme.bgPrimary }]}>
      <Header title="Email Authorization" showBack onBack={() => setCurrentScreen('SignIn')} />

      <View style={styles.body}>
        <Text style={styles.badgeIcon}>✉️</Text>
        <Text style={[styles.heading, { color: theme.textPrimary }]}>Verify Email Address</Text>
        <Text style={[styles.sub, { color: theme.textSecondary }]}>
          We have generated an authorization code for{' '}
          <Text style={{ color: theme.accent, fontWeight: '700' }}>{userEmail || 'your account'}</Text>.
          Please input your 6-digit code to authorize sign in.
        </Text>

        {infoMsg ? (
          <View style={styles.infoBox}>
            <Text style={styles.infoTxt}>💡 {infoMsg}</Text>
          </View>
        ) : null}

        {errorMsg ? (
          <View style={styles.errorBox}>
            <Text style={styles.errorTxt}>⚠️ {errorMsg}</Text>
          </View>
        ) : null}

        <View style={styles.inputGroup}>
          <Text style={[styles.label, { color: theme.textSecondary }]}>6-Digit Authorization Code</Text>
          <TextInput
            style={[styles.input, { backgroundColor: theme.bgCard, color: theme.textPrimary, borderColor: theme.border }]}
            value={code}
            onChangeText={setCode}
            keyboardType="number-pad"
            maxLength={6}
            placeholder="123456"
            placeholderTextColor={theme.textMuted}
          />
        </View>

        <TouchableOpacity
          style={[styles.primaryBtn, { backgroundColor: theme.accent }]}
          onPress={handleVerify}
          disabled={loading}
        >
          {loading ? (
            <ActivityIndicator color={theme.accentText} />
          ) : (
            <Text style={[styles.primaryBtnTxt, { color: theme.accentText }]}>Authorize & Continue →</Text>
          )}
        </TouchableOpacity>

        <TouchableOpacity style={styles.resendBtn} onPress={handleResend} disabled={loading}>
          <Text style={[styles.resendTxt, { color: theme.accent }]}>
            Didn't receive a code? <Text style={{ fontWeight: '800' }}>Resend Authorization Code</Text>
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  body: {
    padding: 24,
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  badgeIcon: {
    fontSize: 48,
    marginBottom: 12,
  },
  heading: {
    fontSize: 22,
    fontWeight: '800',
    marginBottom: 6,
    textAlign: 'center',
  },
  sub: {
    fontSize: 14,
    marginBottom: 20,
    textAlign: 'center',
    lineHeight: 20,
  },
  infoBox: {
    backgroundColor: 'rgba(56, 189, 248, 0.15)',
    borderColor: '#38BDF8',
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    marginBottom: 16,
    width: '100%',
  },
  infoTxt: {
    color: '#38BDF8',
    fontSize: 13,
    fontWeight: '700',
    textAlign: 'center',
  },
  errorBox: {
    backgroundColor: 'rgba(239, 68, 68, 0.15)',
    borderColor: '#EF4444',
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    marginBottom: 16,
    width: '100%',
  },
  errorTxt: {
    color: '#EF4444',
    fontSize: 13,
    fontWeight: '700',
    textAlign: 'center',
  },
  inputGroup: {
    width: '100%',
    marginBottom: 16,
  },
  label: {
    fontSize: 12,
    fontWeight: '600',
    marginBottom: 6,
  },
  input: {
    borderRadius: 12,
    padding: 14,
    fontSize: 22,
    fontWeight: '800',
    letterSpacing: 6,
    textAlign: 'center',
    borderWidth: 1,
  },
  primaryBtn: {
    width: '100%',
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
    marginTop: 8,
  },
  primaryBtnTxt: {
    fontWeight: '800',
    fontSize: 16,
  },
  resendBtn: {
    marginTop: 20,
  },
  resendTxt: {
    fontSize: 13,
  },
});
