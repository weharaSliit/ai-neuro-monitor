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
    permVoice,
    setPermVoice,
    setPermissionsGranted
  } = useContext(AppContext);

  const { theme } = useContext(ThemeContext);

  const handleSave = () => {
    setPermissionsGranted(true);
    setCurrentScreen('BaselineCalibration');
  };

  return (
    <View style={[styles.container, { backgroundColor: theme.bgPrimary }]}>
      <Header title="Grant Access Permissions" showBack onBack={() => setCurrentScreen('PrivacyPolicy')} />

      <ScrollView contentContainerStyle={styles.content}>
        <Text style={[styles.heading, { color: theme.textPrimary }]}>Teammate Hardware Sync</Text>
        <Text style={[styles.sub, { color: theme.textSecondary }]}>
          Toggle permissions one-by-one to establish telemetry & voice guidance links with Member components.
        </Text>

        {/* Permission 1: Member 1 EEG */}
        <View style={[styles.permCard, { backgroundColor: theme.bgSecondary, borderColor: theme.border }]}>
          <View style={styles.permHeader}>
            <Text style={styles.permIcon}>🎧</Text>
            <View style={styles.permText}>
              <Text style={[styles.permTitle, { color: theme.textPrimary }]}>Member 1: EEG Earbud</Text>
              <Text style={[styles.permDesc, { color: theme.textMuted }]}>Receives neural electrical brainwave telemetry.</Text>
            </View>
            <Switch
              value={permMember1}
              onValueChange={setPermMember1}
              trackColor={{ false: '#CBD5E1', true: theme.accent }}
            />
          </View>
          <Text style={[styles.statusTag, { color: permMember1 ? theme.success : theme.danger }]}>
            {permMember1 ? '✓ PERMISSION ALLOWED' : '✗ PERMISSION DECLINED'}
          </Text>
        </View>

        {/* Permission 2: Member 2 Smart Ring */}
        <View style={[styles.permCard, { backgroundColor: theme.bgSecondary, borderColor: theme.border }]}>
          <View style={styles.permHeader}>
            <Text style={styles.permIcon}>💍</Text>
            <View style={styles.permText}>
              <Text style={[styles.permTitle, { color: theme.textPrimary }]}>Member 2: Smart Ring (GSR/HRV)</Text>
              <Text style={[styles.permDesc, { color: theme.textMuted }]}>Monitors galvanic skin response and RMSSD/SDNN.</Text>
            </View>
            <Switch
              value={permMember2}
              onValueChange={setPermMember2}
              trackColor={{ false: '#CBD5E1', true: theme.accent }}
            />
          </View>
          <Text style={[styles.statusTag, { color: permMember2 ? theme.success : theme.danger }]}>
            {permMember2 ? '✓ PERMISSION ALLOWED' : '✗ PERMISSION DECLINED'}
          </Text>
        </View>

        {/* Permission 3: Member 3 Smartphone Phenotype */}
        <View style={[styles.permCard, { backgroundColor: theme.bgSecondary, borderColor: theme.border }]}>
          <View style={styles.permHeader}>
            <Text style={styles.permIcon}>📱</Text>
            <View style={styles.permText}>
              <Text style={[styles.permTitle, { color: theme.textPrimary }]}>Member 3: Smartphone Phenotype</Text>
              <Text style={[styles.permDesc, { color: theme.textMuted }]}>Captures posture angles, facial action units, and interaction metrics.</Text>
            </View>
            <Switch
              value={permMember3}
              onValueChange={setPermMember3}
              trackColor={{ false: '#CBD5E1', true: theme.accent }}
            />
          </View>
          <Text style={[styles.statusTag, { color: permMember3 ? theme.success : theme.danger }]}>
            {permMember3 ? '✓ PERMISSION ALLOWED' : '✗ PERMISSION DECLINED'}
          </Text>
        </View>

        {/* Permission 4: Microphone / Voice Guidance */}
        <View style={[styles.permCard, { backgroundColor: theme.bgSecondary, borderColor: theme.border }]}>
          <View style={styles.permHeader}>
            <Text style={styles.permIcon}>🎙️</Text>
            <View style={styles.permText}>
              <Text style={[styles.permTitle, { color: theme.textPrimary }]}>Calm AI: Voice & Microphone</Text>
              <Text style={[styles.permDesc, { color: theme.textMuted }]}>Enables voice-guided breathing & speech-to-text relaxation chat.</Text>
            </View>
            <Switch
              value={permVoice}
              onValueChange={setPermVoice}
              trackColor={{ false: '#CBD5E1', true: theme.accent }}
            />
          </View>
          <Text style={[styles.statusTag, { color: permVoice ? theme.success : theme.danger }]}>
            {permVoice ? '✓ PERMISSION ALLOWED' : '✗ PERMISSION DECLINED'}
          </Text>
        </View>

        <TouchableOpacity
          style={[styles.grantBtn, { backgroundColor: theme.accent }]}
          onPress={handleSave}
        >
          <Text style={[styles.grantBtnTxt, { color: theme.accentText }]}>Save Permissions & Proceed →</Text>
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
