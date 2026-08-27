import React, { useContext } from 'react';
import { View, Text, StyleSheet, ScrollView, Switch, TouchableOpacity } from 'react-native';
import { AppContext } from '../context/AppContext';
import { ThemeContext } from '../context/ThemeContext';
import { Header } from '../components/Header';

export const PermissionsScreen = () => {
  const {
    setCurrentScreen,
    permMember1,
    setPermMember1,
    permMember2,
    setPermMember2,
    permMember3,
    setPermMember3,
    setPermissionsGranted
  } = useContext(AppContext);

  const { theme } = useContext(ThemeContext);

  const handleSave = () => {
    setPermissionsGranted(true);
    setCurrentScreen('Dashboard');
  };

  return (
    <View style={[styles.container, { backgroundColor: theme.bgPrimary }]}>
      <Header title="Sensor Connections" showBack onBack={() => setCurrentScreen('OnboardingQuestions')} />

      <ScrollView contentContainerStyle={styles.content}>
        <Text style={[styles.heading, { color: theme.textPrimary }]}>Connect Your Health Sensors</Text>
        <Text style={[styles.sub, { color: theme.textSecondary }]}>
          Enable your sensors to measure stress in real time and receive personalized relaxation guidance.
        </Text>

        {/* Permission 1: Brainwave Sensor */}
        <View style={[styles.permCard, { backgroundColor: theme.bgSecondary, borderColor: theme.border }]}>
          <View style={styles.permHeader}>
            <Text style={styles.permIcon}>🎧</Text>
            <View style={styles.permText}>
              <Text style={[styles.permTitle, { color: theme.textPrimary }]}>Brainwave Sensor (EEG Earbud)</Text>
              <Text style={[styles.permDesc, { color: theme.textMuted }]}>Measures brain activity to detect mental fatigue and focus levels.</Text>
            </View>
            <Switch
              value={permMember1}
              onValueChange={setPermMember1}
              trackColor={{ false: '#CBD5E1', true: theme.accent }}
            />
          </View>
          <Text style={[styles.statusTag, { color: permMember1 ? theme.success : theme.danger }]}>
            {permMember1 ? '✓ CONNECTED' : '✗ DISCONNECTED'}
          </Text>
        </View>

        {/* Permission 2: Smart Ring */}
        <View style={[styles.permCard, { backgroundColor: theme.bgSecondary, borderColor: theme.border }]}>
          <View style={styles.permHeader}>
            <Text style={styles.permIcon}>💍</Text>
            <View style={styles.permText}>
              <Text style={[styles.permTitle, { color: theme.textPrimary }]}>Heart & Skin Sensor (Smart Ring)</Text>
              <Text style={[styles.permDesc, { color: theme.textMuted }]}>Monitors heart rate and stress signals to track physical relaxation.</Text>
            </View>
            <Switch
              value={permMember2}
              onValueChange={setPermMember2}
              trackColor={{ false: '#CBD5E1', true: theme.accent }}
            />
          </View>
          <Text style={[styles.statusTag, { color: permMember2 ? theme.success : theme.danger }]}>
            {permMember2 ? '✓ CONNECTED' : '✗ DISCONNECTED'}
          </Text>
        </View>

        {/* Permission 3: Smartphone Sensor */}
        <View style={[styles.permCard, { backgroundColor: theme.bgSecondary, borderColor: theme.border }]}>
          <View style={styles.permHeader}>
            <Text style={styles.permIcon}>📱</Text>
            <View style={styles.permText}>
              <Text style={[styles.permTitle, { color: theme.textPrimary }]}>Motion & Camera Sensor (Smartphone)</Text>
              <Text style={[styles.permDesc, { color: theme.textMuted }]}>Detects posture changes and facial stress cues for accurate recommendations.</Text>
            </View>
            <Switch
              value={permMember3}
              onValueChange={setPermMember3}
              trackColor={{ false: '#CBD5E1', true: theme.accent }}
            />
          </View>
          <Text style={[styles.statusTag, { color: permMember3 ? theme.success : theme.danger }]}>
            {permMember3 ? '✓ CONNECTED' : '✗ DISCONNECTED'}
          </Text>
        </View>

        <TouchableOpacity
          style={[styles.grantBtn, { backgroundColor: theme.accent }]}
          onPress={handleSave}
        >
          <Text style={[styles.grantBtnTxt, { color: theme.accentText }]}>Save & Go to Dashboard →</Text>
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1
  },
  content: {
    padding: 20
  },
  heading: {
    fontSize: 22,
    fontWeight: '800',
    marginBottom: 4
  },
  sub: {
    fontSize: 13,
    marginBottom: 20,
    lineHeight: 18
  },
  permCard: {
    padding: 14,
    borderRadius: 14,
    marginBottom: 12,
    borderWidth: 1
  },
  permHeader: {
    flexDirection: 'row',
    alignItems: 'center'
  },
  permIcon: {
    fontSize: 26,
    marginRight: 10
  },
  permText: {
    flex: 1
  },
  permTitle: {
    fontSize: 13,
    fontWeight: '700'
  },
  permDesc: {
    fontSize: 11,
    marginTop: 2,
    lineHeight: 15
  },
  statusTag: {
    fontSize: 10,
    fontWeight: '800',
    marginTop: 8,
    textAlign: 'right'
  },
  grantBtn: {
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
    marginTop: 16
  },
  grantBtnTxt: {
    fontWeight: '800',
    fontSize: 15
  }
});
