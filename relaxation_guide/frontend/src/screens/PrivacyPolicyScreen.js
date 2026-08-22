import React, { useContext } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { AppContext } from '../context/AppContext';
import { Header } from '../components/Header';

export const PrivacyPolicyScreen = () => {
  const { setCurrentScreen, setPrivacyAccepted } = useContext(AppContext);

  const handleAccept = () => {
    setPrivacyAccepted(true);
    setCurrentScreen('Permissions');
  };

  return (
    <View style={styles.container}>
      <Header title="Privacy & Data Ethics" showBack onBack={() => setCurrentScreen('Login')} />

      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.heading}>Research Data Privacy Consent</Text>

        <Text style={styles.paragraph}>
          CAPS (Context-Aware Personalized Stress Intervention System) collects physiological and behavioral signals (HRV, GSR, facial expressions, body posture, and smartphone phenotyping) strictly for real-time personalized stress intervention research.
        </Text>

        <Text style={styles.subhead}>Key Principles:</Text>
        <Text style={styles.bullet}>• Signals are processed locally and securely in real-time.</Text>
        <Text style={styles.bullet}>• Your preference ratings and technique history are stored securely.</Text>
        <Text style={styles.bullet}>• No raw video or audio recordings leave your device.</Text>
        <Text style={styles.bullet}>• You may withdraw consent or delete history at any time.</Text>

        <TouchableOpacity style={styles.acceptBtn} onPress={handleAccept}>
          <Text style={styles.acceptBtnTxt}>I Accept & Agree to Participate →</Text>
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0F172A'
  },
  content: {
    padding: 20
  },
  heading: {
    color: '#F8FAFC',
    fontSize: 20,
    fontWeight: '800',
    marginBottom: 12
  },
  paragraph: {
    color: '#CBD5E1',
    fontSize: 14,
    lineHeight: 22,
    marginBottom: 16
  },
  subhead: {
    color: '#38BDF8',
    fontSize: 15,
    fontWeight: '700',
    marginBottom: 8
  },
  bullet: {
    color: '#94A3B8',
    fontSize: 13,
    lineHeight: 22,
    marginBottom: 6
  },
  acceptBtn: {
    backgroundColor: '#38BDF8',
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
    marginTop: 30
  },
  acceptBtnTxt: {
    color: '#0F172A',
    fontWeight: '800',
    fontSize: 16
  }
});
