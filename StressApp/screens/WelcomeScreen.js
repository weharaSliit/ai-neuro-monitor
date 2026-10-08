import React from 'react';
import { View } from 'react-native';
import { AuthShell, PrimaryButton } from '../modules/shared/AuthShell';
import { SPACE } from '../modules/shared/theme/tokens';

// Same visual language as the website's sign-in card: logo, name, one
// plain-language promise, then the two actions.
export default function WelcomeScreen({ navigation }) {
  return (
    <AuthShell
      title="MindPulse"
      subtitle="Notice stress early — judged against your own body, not an average."
    >
      <PrimaryButton label="Get started" onPress={() => navigation.navigate('Register')} />
      <View style={{ height: SPACE.md }} />
      <PrimaryButton label="I already have an account" variant="ghost" onPress={() => navigation.navigate('Login')} />
    </AuthShell>
  );
}
