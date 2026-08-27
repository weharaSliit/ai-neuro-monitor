import React, { useContext } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { AppContext } from '../context/AppContext';
import { ThemeContext } from '../context/ThemeContext';
import { Header } from '../components/Header';
import { Timer } from '../components/Timer';

// Import Games
import { FlowerMeadowGame } from '../games/FlowerMeadowGame';
import { LilyPondGame } from '../games/LilyPondGame';
import { PulseWaveGame } from '../games/PulseWaveGame';
import { CognitiveDeStressGame } from '../games/CognitiveDeStressGame';
import { MeditationGame } from '../games/MeditationGame';

export const GamePlayerScreen = () => {
  const { selectedSubOption, setCurrentScreen } = useContext(AppContext);
  const { theme } = useContext(ThemeContext);

  const subId = selectedSubOption ? selectedSubOption.id : 'box_meditation';

  const renderGameCanvas = () => {
    switch (subId) {
      // Guided Meditation & Breathwork
      case 'box_meditation':
      case 'chakra_harmonizer':
      case 'silent_zen_timer':
        return <MeditationGame mode={subId} initialMode={subId} />;

      // Breathing Garden
      case 'flower_meadow':
        return <FlowerMeadowGame />;
      case 'water_lily_pond':
        return <LilyPondGame />;
      case 'cosmic_nebula':
        return <PulseWaveGame mode="cosmic_nebula" />;

      // Cognitive De-Stress Arcade
      case 'muscle':
      case 'pattern':
      case 'nature':
      case 'bubble_pop':
      case 'pattern_align':
      case 'cloud_float':
        return <CognitiveDeStressGame mode={subId} subOptionId={subId} onFinish={handleFinishGame} />;

      default:
        return <MeditationGame mode="box_meditation" initialMode="box_meditation" />;
    }
  };

  const handleFinishGame = () => {
    setCurrentScreen('Rating');
  };

  const isSelfTimedGame = [
    // Cognitive De-Stress Arcade
    'muscle', 'pattern', 'nature', 'bubble_pop', 'pattern_align', 'cloud_float'
  ].includes(subId);

  return (
    <View style={[styles.container, { backgroundColor: theme.bgPrimary }]}>
      <Header
        title={selectedSubOption ? selectedSubOption.title : 'Gamified Relaxation'}
        showBack
        onBack={() => setCurrentScreen('SubOptionSelector')}
      />

      {!isSelfTimedGame && (
        <View style={styles.timerBar}>
          <Timer initialSeconds={60} onComplete={handleFinishGame} />
        </View>
      )}

      <View style={styles.canvasContainer}>
        {renderGameCanvas()}
      </View>

      <View style={[styles.footer, { borderTopColor: theme.border }]}>
        <TouchableOpacity style={[styles.finishBtn, { backgroundColor: theme.success }]} onPress={handleFinishGame}>
          <Text style={styles.finishBtnTxt}>Complete Exercise & Submit Rating →</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1
  },
  timerBar: {
    paddingVertical: 2
  },
  canvasContainer: {
    flex: 1,
    padding: 2
  },
  footer: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderTopWidth: 1
  },
  finishBtn: {
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: 'center'
  },
  finishBtnTxt: {
    color: '#FFFFFF',
    fontWeight: '800',
    fontSize: 14
  }
});
