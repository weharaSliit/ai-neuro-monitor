import React, { useState, useContext } from 'react';
import { View, Text, StyleSheet, TextInput, TouchableOpacity } from 'react-native';
import { AppContext } from '../context/AppContext';
import { Header } from '../components/Header';

export const LoginScreen = () => {
  const { setCurrentScreen, setUserId, setUsername, setIsGuest } = useContext(AppContext);
  const [inputName, setInputName] = useState('Research Participant');

  const handleLogin = () => {
    setUserId('user_' + Date.now().toString().slice(-4));
    setUsername(inputName || 'Participant');
    setIsGuest(false);
    setCurrentScreen('PrivacyPolicy');
  };

  const handleGuest = () => {
    setUserId('guest_user');
    setUsername('Guest Participant');
    setIsGuest(true);
    setCurrentScreen('PrivacyPolicy');
  };

  return (
    <View style={styles.container}>
      <Header title="CAPS Authentication" />

      <View style={styles.body}>
        <Text style={styles.heading}>Welcome to CAPS</Text>
        <Text style={styles.sub}>Member 4: Closed-Loop Personalized Stress Intervention</Text>

        <View style={styles.inputGroup}>
          <Text style={styles.label}>Participant ID / Name</Text>
          <TextInput
            style={styles.input}
            value={inputName}
            onChangeText={setInputName}
            placeholder="Enter Participant Name"
            placeholderTextColor="#64748B"
          />
        </View>

        <TouchableOpacity style={styles.primaryBtn} onPress={handleLogin}>
          <Text style={styles.primaryBtnTxt}>Sign In / Continue</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.guestBtn} onPress={handleGuest}>
          <Text style={styles.guestBtnTxt}>Continue as Guest Participant</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0F172A'
  },
  body: {
    padding: 24,
    justifyContent: 'center',
    flex: 1
  },
  heading: {
    color: '#F8FAFC',
    fontSize: 24,
    fontWeight: '800',
    marginBottom: 6
  },
  sub: {
    color: '#94A3B8',
    fontSize: 14,
    marginBottom: 32
  },
  inputGroup: {
    marginBottom: 20
  },
  label: {
    color: '#CBD5E1',
    fontSize: 13,
    fontWeight: '600',
    marginBottom: 8
  },
  input: {
    backgroundColor: '#1E293B',
    borderRadius: 12,
    padding: 14,
    color: '#F8FAFC',
    fontSize: 15,
    borderWidth: 1,
    borderColor: '#334155'
  },
  primaryBtn: {
    backgroundColor: '#38BDF8',
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
    marginTop: 10
  },
  primaryBtnTxt: {
    color: '#0F172A',
    fontWeight: '800',
    fontSize: 16
  },
  guestBtn: {
    backgroundColor: '#1E293B',
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
    marginTop: 12,
    borderWidth: 1,
    borderColor: '#334155'
  },
  guestBtnTxt: {
    color: '#94A3B8',
    fontWeight: '700',
    fontSize: 14
  }
});
