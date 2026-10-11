import React, { useState } from 'react';
import { Alert } from 'react-native';
import { AuthShell, AuthField, PrimaryButton, SwitchLink } from '../modules/shared/AuthShell';
import { useAuth } from '../context/AuthContext';

// Same look as the website's sign-up. Behaviour unchanged: same
// validation rules, same register() call (which routes a new user into
// AccountSetup for calibration, via App.js).
export default function RegisterScreen({ navigation }) {
  const { register } = useAuth();
  const [userId, setUserId] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!userId.trim() || !password) {
      Alert.alert('Missing info', 'Username and password are required.');
      return;
    }
    if (password.length < 6) {
      Alert.alert('Password too short', 'Use at least 6 characters.');
      return;
    }
    if (password !== confirm) {
      Alert.alert('Passwords don\'t match', 'Re-enter your password to confirm.');
      return;
    }
    setBusy(true);
    const result = await register(userId.trim(), password, name.trim());
    setBusy(false);
    if (!result.success) {
      Alert.alert('Registration Failed', result.error);
    }
  };

  return (
    <AuthShell
      title="Create your account"
      subtitle="You can use this same account on the MindPulse website too."
      onBack={() => navigation.goBack()}
    >
      <AuthField label="Your name" icon="badge-account-horizontal-outline" value={name} onChangeText={setName}
        placeholder="What should we call you?" autoCapitalize="words" />
      <AuthField label="User ID" icon="account-outline" value={userId} onChangeText={setUserId}
        placeholder="A unique ID, e.g. alex_zen" />
      <AuthField label="Password" icon="lock-outline" secure value={password} onChangeText={setPassword}
        placeholder="At least 6 characters" />
      <AuthField label="Confirm password" icon="lock-check-outline" secure value={confirm} onChangeText={setConfirm}
        placeholder="Type it again" returnKeyType="go" onSubmitEditing={submit} />
      <PrimaryButton
        label={busy ? 'Creating your account…' : 'Create account'}
        onPress={submit}
        busy={busy}
      />
      <SwitchLink prompt="Already have an account?" action="Sign in" onPress={() => navigation.navigate('Login')} />
    </AuthShell>
  );
}
