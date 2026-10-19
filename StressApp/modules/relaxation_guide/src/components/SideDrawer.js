import React, { useContext } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Dimensions,
  TouchableWithoutFeedback,
  Platform,
  StatusBar,
  Modal
} from 'react-native';
import { AppContext } from '../context/AppContext';
import { ThemeContext } from '../context/ThemeContext';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const DRAWER_WIDTH = Math.min(SCREEN_WIDTH * 0.78, 320);

export const SideDrawer = () => {
  const {
    currentScreen,
    setCurrentScreen,
    isDrawerOpen,
    setIsDrawerOpen,
    username,
    userId,
    stressState
  } = useContext(AppContext);

  const { isDarkMode, toggleTheme } = useContext(ThemeContext);

  const isDark = isDarkMode ?? true;

  if (!isDrawerOpen) return null;

  const closeDrawer = () => {
    setIsDrawerOpen(false);
  };

  const handleNavigate = (screenId) => {
    setCurrentScreen(screenId);
    closeDrawer();
  };

  // Navigation Items
  const navItems = [
    { id: 'Dashboard', label: 'Guide Home', icon: '🏠', tag: 'Main Hub' },
    { id: 'Methods', label: 'Relaxation Arcade', icon: '🌸', tag: 'Games & Drills' },
    { id: 'PerformanceOverview', label: 'Analytics & Overview', icon: '📈', tag: 'Live Stats' },
    { id: 'UserProfile', label: 'Relaxation Settings', icon: '⚙️', tag: 'Guide Preferences' },
  ];

  const isStress = stressState === 'stress';
  const statusColor = isStress ? '#EF4444' : '#10B981';

  return (
    <Modal
      visible={isDrawerOpen}
      transparent={true}
      animationType="fade"
      statusBarTranslucent={true}
      onRequestClose={closeDrawer}
    >
      <View style={styles.modalRoot}>
        {/* Semi-transparent Overlay Backdrop */}
        <TouchableWithoutFeedback onPress={closeDrawer}>
          <View style={styles.backdrop} />
        </TouchableWithoutFeedback>

        {/* Side Slide-Out Navigation Drawer Panel */}
        <View
          style={[
            styles.drawerContainer,
            {
              width: DRAWER_WIDTH,
              backgroundColor: isDark ? '#0F172A' : '#FFFFFF',
              borderColor: isDark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.08)',
            }
          ]}
        >
          {/* Header Profile Section */}
          <View style={[styles.headerSection, { borderBottomColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)' }]}>
            <TouchableOpacity style={styles.closeBtn} onPress={closeDrawer} activeOpacity={0.7}>
              <Text style={[styles.closeBtnTxt, { color: isDark ? '#94A3B8' : '#64748B' }]}>✕</Text>
            </TouchableOpacity>

            <View style={styles.profileRow}>
              <View style={[styles.avatarBox, { backgroundColor: isDark ? 'rgba(129, 140, 248, 0.2)' : 'rgba(99, 102, 241, 0.15)' }]}>
                <Text style={styles.avatarTxt}>🧠</Text>
              </View>
              <View style={styles.profileMeta}>
                <Text style={[styles.userName, { color: isDark ? '#F8FAFC' : '#0F172A' }]} numberOfLines={1}>
                  {username}
                </Text>
                <View style={styles.statusRow}>
                  <View style={[styles.statusDot, { backgroundColor: statusColor }]} />
                  <Text style={[styles.statusTxt, { color: statusColor }]}>
                    {stressState?.toUpperCase() || 'NORMAL'}
                  </Text>
                </View>
              </View>
            </View>
          </View>

          {/* Section Title */}
          <View style={styles.menuTitleRow}>
            <Text style={[styles.menuTitleTxt, { color: isDark ? '#94A3B8' : '#64748B' }]}>
              RELAXATION GUIDE NAVIGATION
            </Text>
          </View>

          {/* Navigation Items List */}
          <View style={styles.itemsList}>
            {navItems.map((item) => {
              const isActive = currentScreen === item.id;
              const activeBg = isDark ? 'rgba(129, 140, 248, 0.18)' : 'rgba(99, 102, 241, 0.12)';
              const activeText = isDark ? '#818CF8' : '#4F46E5';

              return (
                <TouchableOpacity
                  key={item.id}
                  style={[
                    styles.navItem,
                    {
                      backgroundColor: isActive ? activeBg : 'transparent',
                      borderColor: isActive ? activeText + '40' : 'transparent',
                    }
                  ]}
                  onPress={() => handleNavigate(item.id)}
                  activeOpacity={0.75}
                >
                  <View style={[styles.iconWrap, { backgroundColor: isActive ? activeText + '25' : (isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)') }]}>
                    <Text style={styles.itemIcon}>{item.icon}</Text>
                  </View>

                  <View style={{ flex: 1 }}>
                    <Text style={[styles.itemLabel, { color: isActive ? activeText : (isDark ? '#F1F5F9' : '#1E293B'), fontWeight: isActive ? '900' : '700' }]}>
                      {item.label}
                    </Text>
                    <Text style={[styles.itemTag, { color: isDark ? '#64748B' : '#94A3B8' }]}>
                      {item.tag}
                    </Text>
                  </View>

                  {isActive && (
                    <View style={[styles.activePill, { backgroundColor: activeText }]}>
                      <Text style={styles.activePillTxt}>ACTIVE</Text>
                    </View>
                  )}
                </TouchableOpacity>
              );
            })}
          </View>

          {/* Footer Actions */}
          <View style={[styles.footerSection, { borderTopColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)' }]}>
            <TouchableOpacity
              style={[styles.footerBtn, { backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)' }]}
              onPress={toggleTheme}
              activeOpacity={0.8}
            >
              <Text style={styles.footerBtnIcon}>{isDark ? '☀️' : '🌙'}</Text>
              <Text style={[styles.footerBtnTxt, { color: isDark ? '#E2E8F0' : '#334155' }]}>
                Switch to {isDark ? 'Light' : 'Dark'} Theme
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  modalRoot: {
    flex: 1,
    flexDirection: 'row',
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
  },
  drawerContainer: {
    height: '100%',
    borderRightWidth: 1,
    paddingTop: Platform.OS === 'android' ? (StatusBar.currentHeight || 24) + 12 : 44,
    paddingHorizontal: 16,
    paddingBottom: 24,
    elevation: 25,
    shadowColor: '#000',
    shadowOffset: { width: 6, height: 0 },
    shadowOpacity: 0.35,
    shadowRadius: 18,
    flexDirection: 'column',
    zIndex: 10000,
  },
  headerSection: {
    paddingBottom: 14,
    borderBottomWidth: 1,
  },
  closeBtn: {
    alignSelf: 'flex-end',
    padding: 6,
    marginBottom: 6,
  },
  closeBtnTxt: {
    fontSize: 18,
    fontWeight: '800',
  },
  profileRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  avatarBox: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarTxt: {
    fontSize: 22,
  },
  profileMeta: {
    flex: 1,
  },
  userName: {
    fontSize: 15,
    fontWeight: '900',
    letterSpacing: -0.2,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginTop: 3,
  },
  statusDot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
  },
  statusTxt: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  menuTitleRow: {
    marginTop: 16,
    marginBottom: 10,
    paddingHorizontal: 4,
  },
  menuTitleTxt: {
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 1,
  },
  itemsList: {
    flex: 1,
    gap: 8,
  },
  navItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 16,
    borderWidth: 1,
  },
  iconWrap: {
    width: 36,
    height: 36,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  itemIcon: {
    fontSize: 18,
  },
  itemLabel: {
    fontSize: 13,
    letterSpacing: -0.2,
  },
  itemTag: {
    fontSize: 10,
    fontWeight: '600',
    marginTop: 1,
  },
  activePill: {
    paddingVertical: 3,
    paddingHorizontal: 7,
    borderRadius: 8,
  },
  activePillTxt: {
    color: '#FFFFFF',
    fontSize: 8,
    fontWeight: '900',
    letterSpacing: 0.5,
  },
  footerSection: {
    paddingTop: 16,
    borderTopWidth: 1,
  },
  footerBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 11,
    paddingHorizontal: 14,
    borderRadius: 14,
  },
  footerBtnIcon: {
    fontSize: 14,
  },
  footerBtnTxt: {
    fontSize: 12,
    fontWeight: '800',
  },
});

export default SideDrawer;
