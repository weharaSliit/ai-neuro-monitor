// ============================================================
// Relaxation Guide module -- StressApp's primary post-login screen
// (see initialRouteName="Relaxation" in ../../App.js). EEG/HRV-GSR/Fusion
// are supporting data sources feeding this module's live pipeline, not
// separate destinations users land on. This module has no login/signup of
// its own -- it is handed StressApp's already-logged-in identity (from
// AuthContext) directly, and "leaving" means a real logout (src/context/
// AppContext.js's hostExit, consumed by the Profile screen's Log Out
// button), same as any other primary app screen.
// ============================================================

import React from 'react';
import { ActivityIndicator, StatusBar, StyleSheet, View, LogBox } from 'react-native';
import { useAuth } from '../../context/AuthContext';
import { AppProvider, AppContext } from './src/context/AppContext';
import { ThemeProvider, ThemeContext } from './src/context/ThemeContext';
import { SweetAlertProvider } from './src/context/SweetAlertContext';
import { SideDrawer } from './src/components/SideDrawer';
import { HostAppSwitchBar } from './src/components/HostAppSwitchBar';
import { RealtimeStressTrendCard } from './src/components/RealtimeStressTrendCard';

import { apiService } from './src/api/apiService';
import { DashboardScreen } from './src/screens/DashboardScreen';
import { FusionPipelineScreen } from './src/screens/FusionPipelineScreen';
import { MethodsScreen } from './src/screens/MethodsScreen';
import { InterventionScreen } from './src/screens/InterventionScreen';
import { SubOptionSelectorScreen } from './src/screens/SubOptionSelectorScreen';
import { GamePlayerScreen } from './src/screens/GamePlayerScreen';
import { RatingScreen } from './src/screens/RatingScreen';
import { RecoveryScreen } from './src/screens/RecoveryScreen';
import { HistoryScreen } from './src/screens/HistoryScreen';
import { UserProfileScreen } from './src/screens/UserProfileScreen';
import { PerformanceOverviewScreen } from './src/screens/PerformanceOverviewScreen';
import { StressInductionStroopScreen } from './src/screens/StressInductionStroopScreen';

import { useFocusEffect } from '@react-navigation/native';

LogBox.ignoreLogs(['Expo AV has been deprecated', 'Expo AV is deprecated']);

const MainNavigator = () => {
  const {
    currentScreen, setCurrentScreen, identityChecked, userId,
    setCurrentRecommendation, setSelectedSubOption, setPreInterventionLabel,
    phenoStressLabel, phenoStressProbability, hasLivePhenoPacket,
  } = React.useContext(AppContext);
  const { isDarkMode, theme } = React.useContext(ThemeContext);

  const u = (userId || '').toLowerCase();
  const isAdmin = u === 'ojani' || u.includes('ojani') || u === 'admin' || u.includes('admin');

  // Ensure initial screen is set if empty
  React.useEffect(() => {
    if (!currentScreen) {
      setCurrentScreen('Dashboard');
    }
  }, []);

  const renderScreen = () => {
    if (!identityChecked) {
      return (
        <View style={[styles.loadingWrap, { backgroundColor: theme.bgPrimary }]}>
          <ActivityIndicator size="large" color={theme.accent} />
        </View>
      );
    }
    switch (currentScreen) {
      case 'Dashboard':
        return <DashboardScreen />;
      case 'StroopTest':
        return (
          <StressInductionStroopScreen
            onComplete={async (results) => {
              try {
                const prob = results?.stressProbability || 0.85;
                const stateLabel = results?.stressState || 'stress';
                setPreInterventionLabel(stateLabel);
                
                const rec = await apiService.getIntervention(userId, {
                  user_id: userId,
                  timestamp: Date.now() / 1000,
                  fused_stress_label: stateLabel,
                  stress_probability: prob,
                  pheno_stress_label: hasLivePhenoPacket ? phenoStressLabel : null,
                  pheno_stress_probability: hasLivePhenoPacket ? phenoStressProbability : null,
                  seconds_since_last_packet: 0.0
                });
                
                setPreInterventionLabel(rec?.context_stress_label || stateLabel);
                if (rec) {
                  setCurrentRecommendation(rec);
                  if (rec.selected_sub_option) {
                    setSelectedSubOption(rec.selected_sub_option);
                  }
                }
              } catch (err) {
                console.warn('Stroop recommendation fetch error', err);
              } finally {
                setCurrentScreen('Intervention');
              }
            }}
          />
        );
      case 'FusionPipeline':
        return isAdmin ? <FusionPipelineScreen /> : <DashboardScreen />;
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
        return isAdmin ? <HistoryScreen /> : <DashboardScreen />;
      case 'UserProfile':
        return <UserProfileScreen />;
      case 'PerformanceOverview':
        return <PerformanceOverviewScreen />;
      default:
        return <DashboardScreen />;
    }
  };

  return (
    <View style={[styles.container, { backgroundColor: theme.bgPrimary }]}>
      <StatusBar
        barStyle={isDarkMode ? 'light-content' : 'dark-content'}
        backgroundColor={theme.bgSecondary}
      />
      <RealtimeStressTrendCard />
      <View style={styles.screenContainer}>{renderScreen()}</View>
      {currentScreen !== 'GamePlayer' && <HostAppSwitchBar />}
      <SideDrawer />
    </View>
  );
};

export default function RelaxationGuideModule() {
  const { user, logout } = useAuth();

  return (
    <ThemeProvider>
      <SweetAlertProvider>
        <AppProvider
          initialUserId={user?.userId}
          initialUsername={user?.name}
          initialIsNewUser={user?.isNewUser}
          onExit={logout}
        >
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
  },
  loadingWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center'
  }
});
