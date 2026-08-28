import React, { useState, useContext } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Animated } from 'react-native';
import { AppContext } from '../context/AppContext';
import { ThemeContext } from '../context/ThemeContext';
import { Header } from '../components/Header';

export const PrivacyPolicyScreen = () => {
  const { setCurrentScreen, setPrivacyAccepted, isCalibrated } = useContext(AppContext);
  const { theme } = useContext(ThemeContext);

  const [expandedCard, setExpandedCard] = useState(0); // Card 0 expanded by default
  const [consentTelemetry, setConsentTelemetry] = useState(true);
  const [consentCalibration, setConsentCalibration] = useState(true);

  const handleAccept = () => {
    setPrivacyAccepted(true);
    setCurrentScreen('OnboardingQuestions');
  };

  const accordionItems = [
    {
      id: 0,
      icon: '🔒',
      title: '1. Bank-Grade Security & Encryption',
      summary: 'Your health data is protected with high-level encryption.',
      detail: 'All your stress signals, heart metrics, and session ratings are encrypted using secure bank-grade encryption standards so your personal information remains confidential.'
    },
    {
      id: 1,
      icon: '📱',
      title: '2. Stays Safely on Your Device',
      summary: 'Your sensor signals are processed locally on your phone.',
      detail: 'Your biological sensor signals are processed directly on your phone hardware. No raw camera, microphone, or private recordings ever leave your device.'
    },
    {
      id: 2,
      icon: '🛡️',
      title: '3. You Control Your Personal Data',
      summary: 'Reset or clear your personal history anytime.',
      detail: 'You own your health data. You can clear your relaxation history, change your preferences, or reset your resting stress baseline anytime from your profile.'
    },
    {
      id: 3,
      icon: '✨',
      title: '4. Smart Personalization',
      summary: 'Used strictly to personalize your relaxation guidance.',
      detail: 'Anonymous recovery progress is analyzed only to recommend the most effective relaxation techniques tailored to your body.'
    }
  ];

  return (
    <View style={[styles.container, { backgroundColor: theme.bgPrimary }]}>
      <Header
        title="Privacy & Data Protection"
        showBack={isCalibrated}
        onBack={() => setCurrentScreen('UserProfile')}
      />

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {/* Healthcare Verified Shield Header */}
        <View style={[styles.heroCard, { backgroundColor: theme.bgSecondary, borderColor: theme.accent }]}>
          <View style={styles.shieldWrap}>
            <Text style={styles.shieldIcon}>🛡️</Text>
          </View>
          <Text style={[styles.heroTitle, { color: theme.textPrimary }]}>
            Your Health Privacy & Data Rights
          </Text>
          <Text style={[styles.heroSub, { color: theme.textSecondary }]}>
            We value your privacy. Your biological signals and relaxation data are kept private, secure, and fully under your control.
          </Text>
          <View style={[styles.badgePill, { backgroundColor: theme.accent + '1A', borderColor: theme.accent }]}>
            <Text style={[styles.badgeTxt, { color: theme.accent }]}>🔒 100% SECURE & ENCRYPTED</Text>
          </View>
        </View>

        <Text style={[styles.secHeading, { color: theme.textPrimary }]}>
          Privacy Protections (Tap to Read Details)
        </Text>

        {/* Interactive Accordion Cards */}
        {accordionItems.map((item) => {
          const isExpanded = expandedCard === item.id;
          return (
            <TouchableOpacity
              key={item.id}
              style={[
                styles.accordionCard,
                { backgroundColor: theme.bgSecondary, borderColor: isExpanded ? theme.accent : theme.border }
              ]}
              onPress={() => setExpandedCard(isExpanded ? -1 : item.id)}
              activeOpacity={0.8}
            >
              <View style={styles.accordionHeader}>
                <Text style={styles.cardIcon}>{item.icon}</Text>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.cardTitle, { color: theme.textPrimary }]}>{item.title}</Text>
                  <Text style={[styles.cardSummary, { color: theme.textMuted }]}>{item.summary}</Text>
                </View>
                <Text style={[styles.arrowIcon, { color: theme.accent }]}>
                  {isExpanded ? '▲' : '▼'}
                </Text>
              </View>

              {isExpanded && (
                <View style={[styles.accordionBody, { borderTopColor: theme.border }]}>
                  <Text style={[styles.detailTxt, { color: theme.textSecondary }]}>{item.detail}</Text>
                </View>
              )}
            </TouchableOpacity>
          );
        })}

        {/* Interactive Consent Checklist */}
        <Text style={[styles.secHeading, { color: theme.textPrimary }]}>
          Simple Consent Checklist
        </Text>

        <TouchableOpacity
          style={[styles.checkRow, { backgroundColor: theme.bgSecondary, borderColor: theme.border }]}
          onPress={() => setConsentTelemetry(prev => !prev)}
          activeOpacity={0.8}
        >
          <View style={[styles.checkbox, { backgroundColor: consentTelemetry ? theme.success : 'transparent', borderColor: consentTelemetry ? theme.success : theme.textMuted }]}>
            {consentTelemetry && <Text style={styles.checkMark}>✓</Text>}
          </View>
          <Text style={[styles.checkTxt, { color: theme.textPrimary }]}>
            I agree to let the app analyze my sensor signals to detect stress and suggest personalized relaxation.
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.checkRow, { backgroundColor: theme.bgSecondary, borderColor: theme.border }]}
          onPress={() => setConsentCalibration(prev => !prev)}
          activeOpacity={0.8}
        >
          <View style={[styles.checkbox, { backgroundColor: consentCalibration ? theme.success : 'transparent', borderColor: consentCalibration ? theme.success : theme.textMuted }]}>
            {consentCalibration && <Text style={styles.checkMark}>✓</Text>}
          </View>
          <Text style={[styles.checkTxt, { color: theme.textPrimary }]}>
            I agree to let the app establish my personal resting state for accurate stress recovery recommendations.
          </Text>
        </TouchableOpacity>

        {/* Action Button */}
        <TouchableOpacity
          style={[styles.acceptBtn, { backgroundColor: theme.accent }]}
          onPress={handleAccept}
          activeOpacity={0.85}
        >
          <Text style={styles.acceptBtnTxt}>Accept & Continue →</Text>
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FAF9FC'
  },
  content: {
    padding: 16
  },
  heroCard: {
    borderRadius: 18,
    padding: 18,
    alignItems: 'center',
    borderWidth: 1,
    marginBottom: 20
  },
  shieldWrap: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: 'rgba(56, 189, 248, 0.15)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10
  },
  shieldIcon: {
    fontSize: 28
  },
  heroTitle: {
    fontSize: 18,
    fontWeight: '800',
    textAlign: 'center'
  },
  heroSub: {
    fontSize: 12,
    textAlign: 'center',
    marginTop: 4,
    marginBottom: 12,
    lineHeight: 18
  },
  badgePill: {
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 12,
    borderWidth: 1
  },
  badgeTxt: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.5
  },
  secHeading: {
    fontSize: 14,
    fontWeight: '800',
    marginTop: 8,
    marginBottom: 10
  },
  accordionCard: {
    borderRadius: 14,
    borderWidth: 1,
    padding: 14,
    marginBottom: 10
  },
  accordionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12
  },
  cardIcon: {
    fontSize: 22
  },
  cardTitle: {
    fontSize: 14,
    fontWeight: '800'
  },
  cardSummary: {
    fontSize: 11,
    marginTop: 2
  },
  arrowIcon: {
    fontSize: 12,
    fontWeight: '800'
  },
  accordionBody: {
    marginTop: 10,
    paddingTop: 10,
    borderTopWidth: 1
  },
  detailTxt: {
    fontSize: 12,
    lineHeight: 18
  },
  checkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 10,
    gap: 12
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center'
  },
  checkMark: {
    color: '#FFF',
    fontSize: 12,
    fontWeight: '900'
  },
  checkTxt: {
    flex: 1,
    fontSize: 12,
    fontWeight: '600',
    lineHeight: 16
  },
  acceptBtn: {
    paddingVertical: 14,
    borderRadius: 14,
    alignItems: 'center',
    marginTop: 16,
    marginBottom: 20
  },
  acceptBtnTxt: {
    color: '#FFFFFF',
    fontWeight: '800',
    fontSize: 16
  }
});
