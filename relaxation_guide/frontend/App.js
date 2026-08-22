import React, { useContext } from 'react';
import { StatusBar, StyleSheet, View, LogBox } from 'react-native';
import { AppProvider, AppContext } from './src/context/AppContext';
import { ThemeProvider, ThemeContext } from './src/context/ThemeContext';
import { BottomNavBar } from './src/components/BottomNavBar';

// Import Screens
import { SplashScreen } from './src/screens/SplashScreen';
import { WelcomeScreen } from './src/screens/WelcomeScreen';
import { SignInScreen } from './src/screens/SignInScreen';
import { SignUpScreen } from './src/screens/SignUpScreen';
import { EmailVerificationScreen } from './src/screens/EmailVerificationScreen';
import { OnboardingQuestionsScreen } from './src/screens/OnboardingQuestionsScreen';
import { UserProfileScreen } from './src/screens/UserProfileScreen';
import { PrivacyPolicyScreen } from './src/screens/PrivacyPolicyScreen';
import { PermissionsScreen } from './src/screens/PermissionsScreen';
import { BaselineCalibrationScreen } from './src/screens/BaselineCalibrationScreen';
import { DashboardScreen } from './src/screens/DashboardScreen';
import { MethodsScreen } from './src/screens/MethodsScreen';
import { InterventionScreen } from './src/screens/InterventionScreen';
import { SubOptionSelectorScreen } from './src/screens/SubOptionSelectorScreen';
import { GamePlayerScreen } from './src/screens/GamePlayerScreen';
import { RatingScreen } from './src/screens/RatingScreen';
import { RecoveryScreen } from './src/screens/RecoveryScreen';
import { HistoryScreen } from './src/screens/HistoryScreen';
import { ChatbotScreen } from './src/screens/ChatbotScreen';

import { SweetAlertProvider } from './src/context/SweetAlertContext';

LogBox.ignoreLogs(['Expo AV has been deprecated', 'Expo AV is deprecated']);

const MainNavigator = () => {
  const { currentScreen } = React.useContext(AppContext);
  const { isDarkMode, theme } = React.useContext(ThemeContext);

  const renderScreen = () => {
    switch (currentScreen) {
      case 'Splash':
        return <SplashScreen />;
      case 'Welcome':
        return <WelcomeScreen />;
      case 'SignIn':
        return <SignInScreen />;
      case 'SignUp':
        return <SignUpScreen />;
      case 'EmailVerification':
        return <EmailVerificationScreen />;
      case 'OnboardingQuestions':
        return <OnboardingQuestionsScreen />;
      case 'UserProfile':
        return <UserProfileScreen />;
      case 'PrivacyPolicy':
        return <PrivacyPolicyScreen />;
      case 'Permissions':
        return <PermissionsScreen />;
      case 'BaselineCalibration':
        return <BaselineCalibrationScreen />;
      case 'Dashboard':
        return <DashboardScreen />;
      case 'Methods':
        return <MethodsScreen />;
      case 'Intervention':
        return <InterventionScreen />;
      case 'SubOptionSelector':
        return <SubOptionSelectorScreen />;
      case 'GamePlayer':
        return <GamePlayerScreen />;
      case 'Rating':
        return <RatingScreen />;
      case 'Recovery':
        return <RecoveryScreen />;
      case 'History':
        return <HistoryScreen />;
      case 'Chatbot':
        return <ChatbotScreen />;
      default:
        return <WelcomeScreen />;
    }
  };

  return (
    <View style={[styles.container, { backgroundColor: theme.bgPrimary }]}>
      <StatusBar
        barStyle={isDarkMode ? 'light-content' : 'dark-content'}
        backgroundColor={theme.bgSecondary}
      />
      <View style={styles.screenContainer}>{renderScreen()}</View>
      <BottomNavBar />
    </View>
  );
};

export default function App() {
  return (
    <ThemeProvider>
      <SweetAlertProvider>
        <AppProvider>
          <View style={styles.root}>
            <MainNavigator />
          </View>
        </AppProvider>
      </SweetAlertProvider>
    </ThemeProvider>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1
  },
  container: {
    flex: 1
  },
  screenContainer: {
    flex: 1
  }
});
