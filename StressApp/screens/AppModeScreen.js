import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import ScreenBackground from '../modules/shared/ScreenBackground';
import Button from '../modules/shared/Button';
import Icon from '../modules/shared/Icon';
import { COLORS } from '../modules/physiological/config/theme';
import { useAuth } from '../context/AuthContext';
import { useCalibrationSummary } from '../modules/shared/CalibrationGate';

// Shown once right after a successful login/register, before the real
// navigators. No role/permission concept exists in this backend (a
// deliberate choice for this small research app -- see backend/
// physiological/app.py's /admin/... routes) -- any logged-in account can
// pick either side, this is purely a navigation fork, not an access
// control gate.
export default function AppModeScreen({ navigation }) {
  const { user, token } = useAuth();
  const text  = COLORS.light.text;
  const muted = COLORS.light.textMuted;

  // "Continue as User" still has to respect CalibrationGate -- Admin
  // doesn't (browsing other users' data needs no device of your own
  // calibrated), so this is only computed/used for the User path.
  const { loading: calibLoading, blocking: calibBlocking } = useCalibrationSummary(user?.userId, token);

  const continueAsUser = () => {
    navigation.replace(calibBlocking ? 'CalibrationGate' : 'Physiological');
  };

  return (
    <ScreenBackground>
      <View style={styles.container}>
        <View style={styles.hero}>
          <Icon name="account-check-outline" size={44} color={COLORS.brand} />
          <Text style={[styles.title, { color: text }]}>
            Welcome, {user?.name || user?.userId}
          </Text>
          <Text style={[styles.subtitle, { color: muted }]}>
            How do you want to continue?
          </Text>
        </View>

        <View style={styles.actions}>
          <Button
            label="Continue as User"
            onPress={continueAsUser}
            variant="primary"
            loading={calibLoading}
          />
          <View style={{ height: 12 }} />
          <Button
            label="Open Relaxation Guide"
            onPress={() => navigation.navigate('RelaxationGuide')}
            variant="outline"
          />
          <View style={{ height: 12 }} />
          <Button
            label="Enter Admin App"
            onPress={() => navigation.replace('Admin')}
            variant="outline"
          />
        </View>
      </View>
    </ScreenBackground>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 28, justifyContent: 'space-between' },
  hero:      { flex: 1, alignItems: 'center', justifyContent: 'center' },
  title:     { fontSize: 22, fontWeight: '900', marginTop: 16, textAlign: 'center' },
  subtitle:  { fontSize: 14, marginTop: 8, textAlign: 'center' },
  actions:   { paddingBottom: 12 },
});
