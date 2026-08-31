import React, { useState, useContext, useRef, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
  Animated,
  Dimensions,
  ActivityIndicator,
  Vibration
} from 'react-native';
import { AppContext } from '../context/AppContext';
import { Header } from '../components/Header';
import { apiService } from '../api/apiService';

const { width } = Dimensions.get('window');

export const InterventionScreen = () => {
  const {
    userId,
    currentRecommendation,
    setCurrentScreen,
    setSelectedSubOption
  } = useContext(AppContext);

  const [fallbackData, setFallbackData] = useState(null);
  const [isRejecting, setIsRejecting] = useState(false);
  const [isAccepting, setIsAccepting] = useState(false);
  const [showConfidenceMeter, setShowConfidenceMeter] = useState(false);

  // Animation values
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const scaleAnim = useRef(new Animated.Value(0.95)).current;
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const confidenceFadeAnim = useRef(new Animated.Value(0)).current;
  const confidenceWidthAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    // Auto-redirect directly to technique game
    if (currentRecommendation) {
      if (currentRecommendation?.selected_sub_option) {
        setSelectedSubOption(currentRecommendation.selected_sub_option);
      }
      setCurrentScreen('GamePlayer');
      return;
    }

    // Entrance animation
    Animated.parallel([
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 600,
        useNativeDriver: true,
      }),
      Animated.spring(scaleAnim, {
        toValue: 1,
        friction: 8,
        tension: 40,
        useNativeDriver: true,
      }),
      Animated.timing(confidenceFadeAnim, {
        toValue: 1,
        duration: 600,
        useNativeDriver: true,
      }),
      Animated.timing(confidenceWidthAnim, {
        toValue: 1,
        duration: 1500,
        useNativeDriver: false,
      })
    ]).start();
  }, [currentRecommendation]);

  if (!currentRecommendation) {
    return (
      <View style={styles.container}>
        <Header title="Recommended Technique" showBack onBack={() => setCurrentScreen('Dashboard')} />
        <View style={styles.emptyBox}>
          <Text style={styles.emptyTxt}>🔍 No recommendation active. Return to dashboard.</Text>
        </View>
      </View>
    );
  }

  const handleAcceptRecommendation = () => {
    setIsAccepting(true);
    Vibration.vibrate(20);

    // Navigate directly to game player with the selected technique
    setTimeout(() => {
      if (currentRecommendation?.selected_sub_option) {
        setSelectedSubOption(currentRecommendation.selected_sub_option);
      }
      setCurrentScreen('GamePlayer');
      setIsAccepting(false);
    }, 500);
  };

  const handleRejectFallback = async () => {
    setIsRejecting(true);
    Vibration.vibrate(30);

    try {
      const res = await apiService.handleFallback(userId, currentRecommendation.technique_id);
      setFallbackData(res);

      // Animate fallback appearing
      Animated.spring(scaleAnim, {
        toValue: 1,
        friction: 5,
        tension: 40,
        useNativeDriver: true,
      }).start();
    } catch (e) {
      console.warn('Fallback error', e);
      Alert.alert('Error', 'Could not load fallback options. Please try again.');
    } finally {
      setIsRejecting(false);
    }
  };

  const renderConfidenceMeter = () => {
    return null;
  };

  return (
    <View style={styles.container}>
      <Header title="Your Personalized Plan" showBack onBack={() => setCurrentScreen('Dashboard')} />

      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        {/* Recommendation Card */}
        <Animated.View
          style={[
            styles.card,
            {
              opacity: fadeAnim,
              transform: [{ scale: scaleAnim }]
            }
          ]}
        >
          <Animated.View style={{ transform: [{ scale: pulseAnim }] }}>
            <Text style={styles.techTitle}>{currentRecommendation.title}</Text>
          </Animated.View>

          <Text style={styles.techDesc}>{currentRecommendation.description}</Text>

          {/* Action Button */}
          <TouchableOpacity
            style={[styles.acceptBtn, isAccepting && styles.acceptBtnDisabled]}
            onPress={handleAcceptRecommendation}
            disabled={isAccepting}
          >
            {isAccepting ? (
              <ActivityIndicator color="#332F45" />
            ) : (
              <Text style={styles.acceptBtnTxt}>▶️ Start Technique</Text>
            )}
          </TouchableOpacity>
        </Animated.View>
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
    padding: 16,
    paddingBottom: 40
  },
  emptyBox: {
    padding: 24,
    alignItems: 'center',
    marginTop: 40
  },
  emptyTxt: {
    color: '#8B86A3',
    fontSize: 16,
    textAlign: 'center'
  },
  // Header Styles
  headerChip: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#E9E5F2'
  },
  headerChipText: {
    color: '#8B87C4',
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 0.5
  },
  headerChipBadge: {
    color: '#6F6A87',
    fontSize: 10,
    fontWeight: '700',
    backgroundColor: '#FAF9FC',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 12
  },
  mainHeadline: {
    color: '#332F45',
    fontSize: 20,
    fontWeight: '700',
    marginBottom: 4,
    lineHeight: 28
  },
  subHeadline: {
    color: '#6F6A87',
    fontSize: 13,
    marginBottom: 16
  },
  // Confidence Meter
  confidenceContainer: {
    backgroundColor: '#FFFFFF',
    padding: 14,
    borderRadius: 12,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#E9E5F2'
  },
  confidenceHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8
  },
  confidenceLabel: {
    color: '#332F45',
    fontSize: 13,
    fontWeight: '600'
  },
  confidenceValue: {
    fontSize: 20,
    fontWeight: '800'
  },
  confidenceBarBg: {
    height: 6,
    backgroundColor: '#F5F3FA',
    borderRadius: 3,
    overflow: 'hidden'
  },
  confidenceBarFill: {
    height: '100%',
    borderRadius: 3
  },
  confidenceNote: {
    color: '#8B86A3',
    fontSize: 11,
    marginTop: 8,
    fontStyle: 'italic'
  },
  // Card Styles
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 18,
    borderWidth: 1,
    borderColor: '#E9E5F2'
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12
  },
  recommendationBadge: {
    backgroundColor: '#82C0A0',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12
  },
  recommendationBadgeText: {
    color: '#332F45',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.5
  },
  infoButton: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#F5F3FA',
    alignItems: 'center',
    justifyContent: 'center'
  },
  infoButtonText: {
    color: '#8B86A3',
    fontSize: 14
  },
  techTitle: {
    color: '#332F45',
    fontSize: 24,
    fontWeight: '800',
    marginBottom: 6
  },
  techDesc: {
    color: '#8B86A3',
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 16
  },
  // Breakdown Styles
  breakdownBox: {
    backgroundColor: '#FAF9FC',
    borderRadius: 12,
    padding: 14,
    marginVertical: 14,
    borderWidth: 1,
    borderColor: '#F1EEF8'
  },
  breakdownHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10
  },
  breakdownTitle: {
    color: '#332F45',
    fontSize: 13,
    fontWeight: '700'
  },
  breakdownTap: {
    color: '#6F6A87',
    fontSize: 10,
    fontStyle: 'italic'
  },
  scoreRow: {
    marginVertical: 6
  },
  scoreLabelContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4
  },
  scoreEmoji: {
    fontSize: 14,
    marginRight: 6
  },
  scoreLbl: {
    color: '#8B86A3',
    fontSize: 12
  },
  scoreBarContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between'
  },
  scoreBar: {
    flex: 1,
    height: 4,
    backgroundColor: '#F5F3FA',
    borderRadius: 2,
    marginRight: 10,
    overflow: 'hidden'
  },
  scoreBarFill: {
    height: '100%',
    borderRadius: 2
  },
  scoreVal: {
    color: '#8B87C4',
    fontSize: 12,
    fontWeight: '700',
    minWidth: 40,
    textAlign: 'right'
  },
  totalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    borderTopWidth: 1,
    borderTopColor: '#E9E5F2',
    paddingTop: 8,
    marginTop: 6
  },
  totalLbl: {
    color: '#332F45',
    fontSize: 14,
    fontWeight: '700'
  },
  totalVal: {
    color: '#82C0A0',
    fontSize: 16,
    fontWeight: '800'
  },
  latencyContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 8,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: '#F1EEF8'
  },
  latencyTxt: {
    color: '#6F6A87',
    fontSize: 11,
    fontStyle: 'italic',
    marginRight: 8
  },
  latencyDot: {
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#82C0A0'
  },
  // Sub-option Styles
  subOptionHeaderContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
    marginTop: 4
  },
  subOptionHeader: {
    color: '#332F45',
    fontSize: 14,
    fontWeight: '600'
  },
  subOptionCount: {
    color: '#6F6A87',
    fontSize: 11,
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10
  },
  subOptionBox: {
    backgroundColor: '#F5F3FA',
    padding: 14,
    borderRadius: 10,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#8B87C4'
  },
  subTitle: {
    color: '#332F45',
    fontWeight: '700',
    fontSize: 15
  },
  subDesc: {
    color: '#8B86A3',
    fontSize: 13,
    marginTop: 4
  },
  subTapHint: {
    color: '#6F6A87',
    fontSize: 10,
    marginTop: 8,
    textAlign: 'right',
    fontStyle: 'italic'
  },
  // Button Styles
  acceptBtn: {
    backgroundColor: '#8B87C4',
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
    marginBottom: 10,
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 8
  },
  acceptBtnDisabled: {
    opacity: 0.6
  },
  acceptBtnTxt: {
    color: '#FFFFFF',
    fontWeight: '800',
    fontSize: 16
  },
  acceptBtnSub: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '500',
    opacity: 0.85
  },
  rejectBtn: {
    paddingVertical: 12,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#E9E5F2',
    borderRadius: 12
  },
  rejectBtnDisabled: {
    opacity: 0.5
  },
  rejectBtnTxt: {
    color: '#E8B368',
    fontSize: 14,
    fontWeight: '600'
  },
  rejectBtnSub: {
    color: '#6F6A87',
    fontSize: 11,
    marginTop: 2
  },
  // Fallback Styles
  fallbackBox: {
    backgroundColor: '#F1EEF8',
    padding: 16,
    borderRadius: 16,
    marginTop: 16,
    borderWidth: 1,
    borderColor: '#8B87C4'
  },
  fallbackHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12
  },
  fallbackTitle: {
    color: '#6B679F',
    fontWeight: '800',
    fontSize: 16
  },
  fallbackLevelBadge: {
    backgroundColor: '#8B87C4',
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 12
  },
  fallbackLevelText: {
    color: '#FFFFFF',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.5
  },
  fallbackSub: {
    color: '#332F45',
    fontSize: 13,
    marginBottom: 12
  },
  altCard: {
    backgroundColor: '#F1EEF8',
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#8B87C4'
  },
  altCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4
  },
  altNumber: {
    color: '#8B87C4',
    fontSize: 12,
    fontWeight: '700',
    marginRight: 8,
    backgroundColor: '#F1EEF8',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6
  },
  altTitle: {
    color: '#332F45',
    fontWeight: '700',
    fontSize: 15
  },
  altDesc: {
    color: '#6B679F',
    fontSize: 13,
    marginTop: 2
  },
  altAction: {
    color: '#8B87C4',
    fontSize: 11,
    marginTop: 8,
    textAlign: 'right'
  },
  level2Box: {
    alignItems: 'center',
    paddingVertical: 8
  },
  breathingIcon: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: '#F1EEF8',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12
  },
  breathingIconEmoji: {
    fontSize: 32
  },
  level2Title: {
    color: '#332F45',
    fontWeight: '700',
    fontSize: 17
  },
  level2Desc: {
    color: '#332F45',
    fontSize: 14,
    marginVertical: 10,
    textAlign: 'center',
    lineHeight: 20
  },
  breathingResetBtn: {
    backgroundColor: '#8B87C4',
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 12,
    alignItems: 'center',
    width: '100%'
  },
  breathingResetTxt: {
    color: '#FFFFFF',
    fontWeight: '800',
    fontSize: 15
  },
  breathingResetSub: {
    color: '#FFFFFF',
    fontSize: 11,
    opacity: 0.85,
    marginTop: 2
  },
  level3Title: {
    color: '#332F45',
    fontWeight: '700',
    fontSize: 15,
    marginBottom: 12
  },
  promptBtn: {
    backgroundColor: '#F1EEF8',
    padding: 14,
    borderRadius: 12,
    marginBottom: 8,
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#8B87C4'
  },
  promptEmoji: {
    fontSize: 20,
    marginRight: 12
  },
  promptTxt: {
    color: '#332F45',
    fontWeight: '600',
    fontSize: 14,
    flex: 1
  },
  promptArrow: {
    color: '#8B87C4',
    fontSize: 18
  }
});