import React, { useEffect, useContext } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { AppContext } from '../context/AppContext';

export const SplashScreen = () => {
  const { setCurrentScreen, privacyAccepted } = useContext(AppContext);

  useEffect(() => {
    const timer = setTimeout(() => {
      if (privacyAccepted) {
        setCurrentScreen('Dashboard');
      } else {
        setCurrentScreen('Login');
      }
    }, 2500);
    return () => clearTimeout(timer);
  }, [privacyAccepted]);

  return (
    <View style={styles.container}>
      <View style={styles.logoBadge}>
        <Text style={styles.logoIcon}>⚡</Text>
      </View>
      <Text style={styles.title}>CAPS</Text>
      <Text style={styles.subtitle}>Context-Aware Personalized Stress Intervention System</Text>
      <Text style={styles.memberTag}>Member 4 Research Component • Closed-Loop Bio-Feedback</Text>

      <TouchableOpacity
        style={styles.continueBtn}
        onPress={() => setCurrentScreen(privacyAccepted ? 'Dashboard' : 'Login')}
      >
        <Text style={styles.btnText}>Get Started →</Text>
      </TouchableOpacity>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0F172A',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24
  },
  logoBadge: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: 'rgba(56, 189, 248, 0.15)',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: '#38BDF8',
    marginBottom: 20
  },
  logoIcon: {
    fontSize: 40
  },
  title: {
    color: '#F8FAFC',
    fontSize: 32,
    fontWeight: '900',
    letterSpacing: 2
  },
  subtitle: {
    color: '#38BDF8',
    fontSize: 14,
    fontWeight: '600',
    textAlign: 'center',
    marginTop: 8,
    lineHeight: 20
  },
  memberTag: {
    color: '#64748B',
    fontSize: 12,
    marginTop: 16,
    textAlign: 'center'
  },
  continueBtn: {
    marginTop: 40,
    backgroundColor: '#38BDF8',
    paddingVertical: 14,
    paddingHorizontal: 32,
    borderRadius: 24
  },
  btnText: {
    color: '#0F172A',
    fontWeight: '800',
    fontSize: 16
  }
});
