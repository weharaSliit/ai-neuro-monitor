import React, { useState, useEffect, useContext } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { AppContext } from '../context/AppContext';
import { ThemeContext } from '../context/ThemeContext';
import { Header } from '../components/Header';
import { apiService } from '../api/apiService';
import { AmbientBackground } from '../components/AmbientBackground';
import { useSweetAlert } from '../context/SweetAlertContext';
import { calculateBadges } from '../utils/badgeUtils';

export const UserProfileScreen = () => {
  const { userId, username, hostExit, setCurrentScreen, historyList } = useContext(AppContext);
  const { theme, isDarkMode, toggleTheme } = useContext(ThemeContext);
  const { showAlert } = useSweetAlert();
  // Relaxation Guide's own screens are all reached via setCurrentScreen
  // (in-module switch, see AppContext). The Physiological module is a
  // separate top-level stack screen (App.js), so reaching its Dashboard
  // needs the actual React Navigation object, not the in-module switch.
  const navigation = useNavigation();

  const [profileData, setProfileData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchProfile = async () => {
      if (!userId) return;
      try {
        const res = await apiService.getUserProfile(userId);
        setProfileData(res);
      } catch (e) {
        console.warn('Profile error', e);
      } finally {
        setLoading(false);
      }
    };
    fetchProfile();
  }, [userId]);

  const formatAnswer = (val) => {
    if (!val) return 'Default (Not Set)';
    return val.replace(/_/g, ' ').toUpperCase();
  };

  // Dynamic calculation based on backend profileData + live historyList sessions
  const baseCount = profileData?.recent_interventions_count ?? 3;
  const completedCount = baseCount + (historyList?.length || 0);

  const baseXP = profileData?.xp_points ?? 250;
  const historyXP = (historyList || []).reduce((acc, sess) => {
    const ratingBonus = (sess.star_rating || 5) * 20;
    return acc + 150 + ratingBonus;
  }, 0);
  const liveXP = baseXP + historyXP;

  const baseStreak = profileData?.streak_days ?? 3;
  const calculateStreak = () => {
    if (!historyList || historyList.length === 0) return baseStreak;
    const uniqueDays = new Set(
      historyList.map((h) => {
        const d = h.timestamp ? new Date(h.timestamp * 1000) : new Date();
        return d.toISOString().split('T')[0];
      })
    );
    return Math.max(baseStreak, baseStreak + uniqueDays.size);
  };
  const liveStreak = calculateStreak();

  const dynamicBadges = calculateBadges(historyList, profileData);

  const handleBadgePress = (b) => {
    if (b.unlocked) {
      showAlert({
        title: `${b.icon} ${b.title}`,
        text: `STATUS: UNLOCKED 🎉\n\nAchievement Requirement:\n${b.description}\n\nGreat job on maintaining your relaxation progress!`,
        icon: 'success',
        confirmButtonText: 'AWESOME! 🏆'
      });
    } else {
      showAlert({
        title: `${b.icon} ${b.title}`,
        text: `STATUS: LOCKED 🔒\n\nHow to unlock:\n${b.description}`,
        icon: 'warning',
        confirmButtonText: 'GOT IT 👍'
      });
    }
  };

  return (
    <View style={[styles.container, { backgroundColor: theme.bgPrimary }]}>
      <AmbientBackground />
      <Header title="Relaxation Settings" showBack={false} />

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={theme.accent} />
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.content}>
          {/* Profile Hero Header */}
          <View style={[styles.profileCard, { backgroundColor: theme.bgSecondary, borderColor: theme.border }]}>
            <View style={[styles.avatar, { backgroundColor: theme.accent + '26' }]}>
              <Text style={styles.avatarIcon}>👤</Text>
            </View>
            <Text style={[styles.name, { color: theme.textPrimary }]}>{username}</Text>
            <Text style={[styles.userId, { color: theme.textMuted }]}>ID: {userId}</Text>

            {/* Stats row */}
            <View style={[styles.statsRow, { backgroundColor: theme.bgPrimary }]}>
              <View style={styles.statBox}>
                <Text style={[styles.statVal, { color: theme.accent }]}>⚡ {liveXP}</Text>
                <Text style={[styles.statLbl, { color: theme.textMuted }]}>XP Points</Text>
              </View>
              <View style={styles.statBox}>
                <Text style={[styles.statVal, { color: theme.accent }]}>🔥 {liveStreak}d</Text>
                <Text style={[styles.statLbl, { color: theme.textMuted }]}>Streak</Text>
              </View>
              <View style={styles.statBox}>
                <Text style={[styles.statVal, { color: theme.accent }]}>🎯 {completedCount}</Text>
                <Text style={[styles.statLbl, { color: theme.textMuted }]}>Completed</Text>
              </View>
            </View>
          </View>

          {/* Badges & Achievements Catalog */}
          <Text style={[styles.secTitle, { color: theme.textPrimary }]}>Earned Achievement Badges</Text>
          <View style={styles.badgeGrid}>
            {dynamicBadges.map((b) => (
              <TouchableOpacity
                key={b.id}
                activeOpacity={0.8}
                onPress={() => handleBadgePress(b)}
                style={[
                  styles.badgeCard,
                  { backgroundColor: theme.bgSecondary, borderColor: b.unlocked ? theme.accent : theme.border },
                  !b.unlocked && styles.lockedBadge
                ]}
              >
                <Text style={styles.badgeIcon}>{b.icon}</Text>
                <Text style={[styles.badgeTitle, { color: theme.textPrimary }]}>{b.title}</Text>
                <Text style={[styles.badgeDesc, { color: theme.textMuted }]}>{b.description}</Text>
                <Text style={[styles.statusTag, { color: b.unlocked ? theme.success : theme.textMuted }]}>
                  {b.unlocked ? 'UNLOCKED' : 'LOCKED'}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          {/* Setup & Preferences */}
          <Text style={[styles.secTitle, { color: theme.textPrimary }]}>Setup & Preferences</Text>
          <TouchableOpacity
            style={[styles.settingCard, { backgroundColor: theme.bgSecondary, borderColor: theme.border }]}
            onPress={() => setCurrentScreen('PerformanceOverview')}
          >
            <View style={styles.settingText}>
              <Text style={[styles.settingTitle, { color: theme.textPrimary }]}>🏆 Awards & Recovery Analytics</Text>
              <Text style={[styles.settingSub, { color: theme.textMuted }]}>View top techniques, achievements & recovery times.</Text>
            </View>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.settingCard, { backgroundColor: theme.bgSecondary, borderColor: theme.border }]}
            onPress={() => navigation.navigate('Physiological')}
          >
            <View style={styles.settingText}>
              <Text style={[styles.settingTitle, { color: theme.textPrimary }]}>📊 Physiological Dashboard</Text>
              <Text style={[styles.settingSub, { color: theme.textMuted }]}>Sensor data, ring, EEG & PSS-4 tools.</Text>
            </View>
          </TouchableOpacity>

          {hostExit ? (
            <TouchableOpacity style={[styles.logoutBtn, { borderColor: theme.danger }]} onPress={hostExit}>
              <Text style={[styles.logoutTxt, { color: theme.danger }]}>🔒 Log Out</Text>
            </TouchableOpacity>
          ) : null}
        </ScrollView>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1
  },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center'
  },
  content: {
    padding: 16,
    paddingBottom: 88,
  },
  profileCard: {
    borderRadius: 16,
    padding: 20,
    alignItems: 'center',
    borderWidth: 1,
    marginBottom: 16
  },
  avatar: {
    width: 72,
    height: 72,
    borderRadius: 36,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 10
  },
  avatarIcon: {
    fontSize: 36
  },
  name: {
    fontSize: 20,
    fontWeight: '800'
  },
  userId: {
    fontSize: 12,
    marginTop: 2,
    marginBottom: 16
  },
  statsRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    width: '100%',
    paddingVertical: 12,
    borderRadius: 14
  },
  statBox: {
    alignItems: 'center'
  },
  statVal: {
    fontSize: 16,
    fontWeight: '800',
  },
  statLbl: {
    fontSize: 10,
    marginTop: 2
  },
  settingCard: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    borderRadius: 14,
    borderWidth: 1,
    marginBottom: 20
  },
  settingText: {
    flex: 1
  },
  settingTitle: {
    fontSize: 15,
    fontWeight: '700'
  },
  settingSub: {
    fontSize: 12,
    marginTop: 2
  },
  secTitle: {
    fontSize: 17,
    fontWeight: '800',
    marginBottom: 12
  },
  badgeGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginBottom: 20
  },
  badgeCard: {
    width: '48%',
    padding: 12,
    borderRadius: 14,
    borderWidth: 1,
    alignItems: 'center'
  },
  lockedBadge: {
    opacity: 0.5
  },
  badgeIcon: {
    fontSize: 28,
    marginBottom: 6
  },
  badgeTitle: {
    fontSize: 13,
    fontWeight: '700',
    textAlign: 'center'
  },
  badgeDesc: {
    fontSize: 10,
    textAlign: 'center',
    marginTop: 2,
    marginBottom: 6
  },
  statusTag: {
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 0.5
  },
  logoutBtn: {
    paddingVertical: 14,
    borderRadius: 14,
    alignItems: 'center',
    borderWidth: 1,
    marginTop: 10
  },
  logoutTxt: {
    fontWeight: '800',
    fontSize: 14
  },
  summaryCard: {
    padding: 16,
    borderRadius: 16,
    borderWidth: 1,
    marginBottom: 20
  },
  summaryItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 6
  },
  summaryIcon: {
    fontSize: 22
  },
  summaryLabel: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.5
  },
  summaryVal: {
    fontSize: 13,
    fontWeight: '800',
    marginTop: 2
  },
  summaryDivider: {
    height: 1,
    marginVertical: 8
  },
  retakeBtn: {
    marginTop: 10,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: 'center'
  },
  retakeBtnTxt: {
    fontSize: 12,
    fontWeight: '800'
  }
});
