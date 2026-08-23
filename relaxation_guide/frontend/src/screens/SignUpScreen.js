import React, { useState, useContext, useRef, useEffect } from 'react';
import {
  View, Text, StyleSheet, TextInput,
  TouchableOpacity, ActivityIndicator, Animated, Easing
} from 'react-native';
import { AppContext } from '../context/AppContext';
import { ThemeContext } from '../context/ThemeContext';
import { Header } from '../components/Header';
import { apiService } from '../api/apiService';
import { useSweetAlert } from '../context/SweetAlertContext';

const FocusInput = ({ label, value, onChangeText, placeholder, secureText, keyboardType, theme }) => {
  const [focused, setFocused] = useState(false);
  const [showPass, setShowPass] = useState(false);
  const borderAnim = useRef(new Animated.Value(0)).current;

  const onFocus = () => {
    setFocused(true);
    Animated.timing(borderAnim, { toValue: 1, duration: 200, useNativeDriver: false }).start();
  };
  const onBlur = () => {
    setFocused(false);
    Animated.timing(borderAnim, { toValue: 0, duration: 200, useNativeDriver: false }).start();
  };

  const borderColor = borderAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [theme.border, theme.accent],
  });

  return (
    <View style={s.inputGroup}>
      <Text style={[s.label, { color: focused ? theme.accent : theme.textSecondary }]}>{label}</Text>
      <Animated.View style={[s.inputWrap, { borderColor, backgroundColor: theme.bgCard }]}>
        <TextInput
          style={[s.input, { color: theme.textPrimary }]}
          value={value}
          onChangeText={onChangeText}
          autoCapitalize="none"
          keyboardType={keyboardType || 'default'}
          placeholder={placeholder}
          placeholderTextColor={theme.textMuted}
          secureTextEntry={secureText && !showPass}
          onFocus={onFocus}
          onBlur={onBlur}
        />
        {secureText && (
          <TouchableOpacity onPress={() => setShowPass(p => !p)} style={s.eyeBtn}>
            <Text style={[s.eyeIcon, { color: theme.textMuted }]}>{showPass ? '🙈' : '👁️'}</Text>
          </TouchableOpacity>
        )}
      </Animated.View>
    </View>
  );
};

export const SignUpScreen = () => {
  const { showAlert } = useSweetAlert();
  const { setCurrentScreen, setUserEmail, setPendingVerificationCode } = useContext(AppContext);
  const { theme } = useContext(ThemeContext);

  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  const logoScale = useRef(new Animated.Value(0.8)).current;
  const logoGlow  = useRef(new Animated.Value(1)).current;
  const formOpacity = useRef(new Animated.Value(0)).current;
  const formSlide   = useRef(new Animated.Value(30)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.spring(logoScale, { toValue: 1, tension: 60, friction: 8, useNativeDriver: true }),
      Animated.timing(formOpacity, { toValue: 1, duration: 600, delay: 200, useNativeDriver: true }),
      Animated.spring(formSlide, { toValue: 0, tension: 50, friction: 8, delay: 200, useNativeDriver: true }),
    ]).start();

    Animated.loop(
      Animated.sequence([
        Animated.timing(logoGlow, { toValue: 1.06, duration: 2200, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(logoGlow, { toValue: 1, duration: 2200, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ])
    ).start();
  }, []);

  const handleSignUp = async () => {
    if (!email || !fullName || !password) {
      showAlert({ title: 'Missing Fields', text: 'Please fill in all fields.', icon: 'warning' });
      return;
    }
    setLoading(true);
    setErrorMsg('');
    try {
      const res = await apiService.signUp(email, password, fullName);
      setUserEmail(email);
      showAlert({
        title: 'Account Created! 🚀',
        text: `Welcome ${fullName}! Your participant profile has been created.`,
        icon: 'success',
        confirmButtonText: 'Continue →',
        onConfirm: () => setCurrentScreen('BaselineCalibration')
      });
    } catch (e) {
      const msg = e.message || 'Registration error. Please check your credentials.';
      setErrorMsg(msg);
      showAlert({ title: 'Registration Error', text: msg, icon: 'error' });
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={[s.container, { backgroundColor: theme.bgPrimary }]}>
      <Header title="Create Account" showBack onBack={() => setCurrentScreen('Welcome')} />

      <View style={s.body}>
        <Animated.View style={[s.logoWrap, { transform: [{ scale: logoScale }] }]}>
          <Animated.View style={[s.logoBadge, { backgroundColor: theme.accent + '20', borderColor: theme.accent, transform: [{ scale: logoGlow }] }]}>
            <Text style={s.logoIcon}>🧠</Text>
          </Animated.View>
        </Animated.View>

        <Animated.View style={[{ opacity: formOpacity, transform: [{ translateY: formSlide }], width: '100%' }]}>
          <Text style={[s.heading, { color: theme.textPrimary }]}>Join the Study</Text>
          <Text style={[s.sub, { color: theme.textSecondary }]}>
            Register your participant profile to begin bio-feedback monitoring.
          </Text>

          {errorMsg ? (
            <View style={s.errorBox}>
              <Text style={s.errorTxt}>⚠️  {errorMsg}</Text>
            </View>
          ) : null}

          <FocusInput
            label="Full Name"
            value={fullName}
            onChangeText={setFullName}
            placeholder="Jane Doe"
            theme={theme}
          />
          <FocusInput
            label="Email Address"
            value={email}
            onChangeText={setEmail}
            placeholder="jane@research.org"
            keyboardType="email-address"
            theme={theme}
          />
          <FocusInput
            label="Password"
            value={password}
            onChangeText={setPassword}
            placeholder="••••••••"
            secureText
            theme={theme}
          />

          <TouchableOpacity
            style={[s.primaryBtn, { backgroundColor: theme.accent, opacity: loading ? 0.7 : 1 }]}
            onPress={handleSignUp}
            disabled={loading}
            activeOpacity={0.85}
          >
            {loading ? (
              <ActivityIndicator color={theme.accentText} />
            ) : (
              <Text style={[s.primaryBtnTxt, { color: theme.accentText }]}>Create Account & Verify  →</Text>
            )}
          </TouchableOpacity>

          <TouchableOpacity style={s.switchBtn} onPress={() => setCurrentScreen('SignIn')}>
            <Text style={[s.switchTxt, { color: theme.textMuted }]}>
              Already have an account?{'  '}
              <Text style={{ color: theme.accent, fontWeight: '700' }}>Sign In</Text>
            </Text>
          </TouchableOpacity>
        </Animated.View>
      </View>
    </View>
  );
};

const s = StyleSheet.create({
  container: { flex: 1 },
  body: { padding: 24, flex: 1, justifyContent: 'center', alignItems: 'center' },
  logoWrap: { marginBottom: 16, alignItems: 'center' },
  logoBadge: {
    width: 72, height: 72, borderRadius: 36,
    alignItems: 'center', justifyContent: 'center', borderWidth: 2,
    shadowColor: '#38BDF8', shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.3, shadowRadius: 12, elevation: 8,
  },
  logoIcon: { fontSize: 36 },
  heading: { fontSize: 24, fontWeight: '800', marginBottom: 4 },
  sub: { fontSize: 13, marginBottom: 20, lineHeight: 19 },
  errorBox: {
    backgroundColor: 'rgba(239,68,68,0.12)', borderColor: '#EF4444',
    borderWidth: 1, borderRadius: 12, padding: 12, marginBottom: 14,
  },
  errorTxt: { color: '#EF4444', fontSize: 13, fontWeight: '700' },
  inputGroup: { marginBottom: 14, width: '100%' },
  label: { fontSize: 12, fontWeight: '700', marginBottom: 6 },
  inputWrap: {
    flexDirection: 'row', alignItems: 'center',
    borderRadius: 14, borderWidth: 1.5, overflow: 'hidden',
  },
  input: { flex: 1, padding: 14, fontSize: 15 },
  eyeBtn: { paddingHorizontal: 14 },
  eyeIcon: { fontSize: 18 },
  primaryBtn: {
    paddingVertical: 16, borderRadius: 16,
    alignItems: 'center', marginTop: 8, width: '100%',
    shadowColor: '#38BDF8', shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.3, shadowRadius: 14, elevation: 6,
  },
  primaryBtnTxt: { fontWeight: '800', fontSize: 16 },
  switchBtn: { marginTop: 20, alignItems: 'center' },
  switchTxt: { fontSize: 13 },
});
