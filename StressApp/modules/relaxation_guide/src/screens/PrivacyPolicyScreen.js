import React, { useContext } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { AppContext } from '../context/AppContext';
import { Header } from '../components/Header';
import { AmbientBackground } from '../components/AmbientBackground';

export const PrivacyPolicyScreen = () => {
  const { setCurrentScreen, setPrivacyAccepted, isCalibrated } = useContext(AppContext);

  const handleAccept = () => {
    setPrivacyAccepted(true);
    setCurrentScreen('OnboardingQuestions');
  };

  return (
    <View style={styles.container}>
      <AmbientBackground />
      {/* Returning users reach this screen from Profile to re-read it, not
          as a forced first step, so give them a way back out. */}
      <Header
        title="Privacy & Data Ethics"
        showBack={isCalibrated}
        onBack={() => setCurrentScreen('Dashboard')}
      />

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
    backgroundColor: '#FAF9FC'
  },
  content: {
    padding: 20
  },
  heading: {
    color: '#332F45',
    fontSize: 20,
    fontWeight: '800',
    marginBottom: 12
  },
  paragraph: {
    color: '#332F45',
    fontSize: 14,
    lineHeight: 22,
    marginBottom: 16
  },
  subhead: {
    color: '#8B87C4',
    fontSize: 15,
    fontWeight: '700',
    marginBottom: 8
  },
  bullet: {
    color: '#8B86A3',
    fontSize: 13,
    lineHeight: 22,
    marginBottom: 6
  },
  acceptBtn: {
    backgroundColor: '#8B87C4',
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
    marginTop: 30
  },
  acceptBtnTxt: {
    color: '#FFFFFF',
    fontWeight: '800',
    fontSize: 16
  }
});
