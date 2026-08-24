import React, { useState, useEffect, useContext } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator, Switch } from 'react-native';
import { AppContext } from '../context/AppContext';
import { ThemeContext } from '../context/ThemeContext';
import { Header } from '../components/Header';
import { apiService } from '../api/apiService';

export const UserProfileScreen = () => {
  const { userId, username, hostExit, setCurrentScreen } = useContext(AppContext);
  const { isDarkMode, toggleTheme, theme } = useContext(ThemeContext);

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

  return (
    <View style={[styles.container, { backgroundColor: theme.bgPrimary }]}>
      <Header title="User Profile" showBack onBack={() => setCurrentScreen('Dashboard')} />

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={theme.accent} />
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.content}>
          {/* Profile Hero Header */}
          <View style={[styles.profileCard, { backgroundColor: theme.bgSecondary, borderColor: theme.border }]}>
            <View style={styles.avatar}>
              <Text style={styles.avatarIcon}>👤</Text>
            </View>
            <Text style={[styles.name, { color: theme.textPrimary }]}>{username}</Text>
            <Text style={[styles.userId, { color: theme.textMuted }]}>ID: {userId}</Text>

            {/* Stats row */}
            <View style={[styles.statsRow, { backgroundColor: theme.bgPrimary }]}>
              <View style={styles.statBox}>
                <Text style={styles.statVal}>⚡ {profileData?.xp_points ?? 0}</Text>
                <Text style={[styles.statLbl, { color: theme.textMuted }]}>XP Points</Text>
              </View>
              <View style={styles.statBox}>
                <Text style={styles.statVal}>🔥 {profileData?.streak_days ?? 1}d</Text>
                <Text style={[styles.statLbl, { color: theme.textMuted }]}>Streak</Text>
              </View>
              <View style={styles.statBox}>
                <Text style={styles.statVal}>🎯 {profileData?.recent_interventions_count ?? 0}</Text>
                <Text style={[styles.statLbl, { color: theme.textMuted }]}>Completed</Text>
              </View>
            </View>
          </View>

          {/* Theme Settings Switcher */}
          <View style={[styles.settingCard, { backgroundColor: theme.bgSecondary, borderColor: theme.border }]}>
            <View style={styles.settingText}>
              <Text style={[styles.settingTitle, { color: theme.textPrimary }]}>Appearance Theme</Text>
              <Text style={[styles.settingSub, { color: theme.textMuted }]}>
                Current Mode: {isDarkMode ? 'Dark Mode (Slate)' : 'Light Mode (Pure)'}
              </Text>
            </View>
            <Switch
              value={isDarkMode}
              onValueChange={toggleTheme}
              trackColor={{ false: '#CBD5E1', true: theme.accent }}
              thumbColor={isDarkMode ? '#FFFFFF' : '#F1F5F9'}
            />
          </View>

          {/* Badges & Achievements Catalog */}
          <Text style={[styles.secTitle, { color: theme.textPrimary }]}>Earned Research Badges</Text>
          <View style={styles.badgeGrid}>
            {profileData?.badges?.map((b) => (
              <View
                key={b.id}
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
              </View>
            ))}
          </View>

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
    padding: 16
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
    backgroundColor: 'rgba(56, 189, 248, 0.15)',
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
    color: '#38BDF8'
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
  }
});
