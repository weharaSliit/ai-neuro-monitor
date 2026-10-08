import React, { useState } from 'react';
import { Alert } from 'react-native';
import { AuthShell, AuthField, PrimaryButton, SwitchLink } from '../modules/shared/AuthShell';
import { useAuth } from '../context/AuthContext';

// Same look as the website's sign-in (web/src/pages/LoginPage.jsx).
// Behaviour unchanged: same validation, same login() call, same alerts.
export default function LoginScreen({ navigation }) {
  const { login } = useAuth();
  const [userId, setUserId] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!userId.trim() || !password) {
      Alert.alert('Missing info', 'Please enter your username and password.');
      return;
    }
    setBusy(true);
    const result = await login(userId.trim(), password);
    setBusy(false);
    if (!result.success) {
      Alert.alert('Login Failed', result.error);
    }
  };

  return (
    <AuthShell
      title="Welcome back"
      subtitle="Sign in with the same account you use on the MindPulse website."
      onBack={() => navigation.goBack()}
    >
      <AuthField label="User ID" icon="account-outline" value={userId} onChangeText={setUserId}
        placeholder="Your user ID" returnKeyType="next" />
      <AuthField label="Password" icon="lock-outline" secure value={password} onChangeText={setPassword}
        placeholder="••••••••" returnKeyType="go" onSubmitEditing={submit} />
      <PrimaryButton
        label={busy ? 'Signing in… (the server may take a moment)' : 'Sign in'}
        onPress={submit}
        busy={busy}
      />
      <SwitchLink prompt="New here?" action="Create an account" onPress={() => navigation.navigate('Register')} />
    </AuthShell>
  );
}
