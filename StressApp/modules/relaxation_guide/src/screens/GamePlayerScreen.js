import React, { useContext } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { AppContext } from '../context/AppContext';
import { ThemeContext } from '../context/ThemeContext';
import { Header } from '../components/Header';
import { Timer } from '../components/Timer';

// Import Games
import { AdaptiveRainGame } from '../games/AdaptiveRainGame';
import { ForestGame } from '../games/ForestGame';
import { OceanGame } from '../games/OceanGame';
import { FlowerMeadowGame } from '../games/FlowerMeadowGame';
import { ZenGardenGame } from '../games/ZenGardenGame';
import { LilyPondGame } from '../games/LilyPondGame';
import { PulseWaveGame } from '../games/PulseWaveGame';
import { ParticleFieldGame } from '../games/ParticleFieldGame';
import { BreathingLightGame } from '../games/BreathingLightGame';
import { SoundscapeGame } from '../games/SoundscapeGame';
import { CognitiveDeStressGame } from '../games/CognitiveDeStressGame';
import { MeditationGame } from '../games/MeditationGame';

export const GamePlayerScreen = () => {
  const { selectedSubOption, setCurrentScreen } = useContext(AppContext);
  const { theme } = useContext(ThemeContext);

  const subId = selectedSubOption ? selectedSubOption.id : 'rain_scene';

  const renderGameCanvas = () => {
    switch (subId) {
      case 'box_meditation':
        return <MeditationGame mode="box_meditation" initialMode="box_meditation" />;
      case 'zen_body_scan':
        return <MeditationGame mode="zen_body_scan" initialMode="zen_body_scan" />;
      case 'chakra_meditation':
        return <MeditationGame mode="chakra_meditation" initialMode="chakra_meditation" />;
      case 'transcendental_mind':
        return <MeditationGame mode="transcendental_mind" initialMode="transcendental_mind" />;
      case 'sound_meditation':
        return <MeditationGame mode="sound_meditation" initialMode="sound_meditation" />;
      case 'rain_scene':
      case 'sunset_glow':
      case 'mountain_breeze':
        return <AdaptiveRainGame />;
      case 'forest_scene':
        return <ForestGame />;
      case 'ocean_scene':
        return <OceanGame />;
      case 'flower_meadow':
      case 'cosmic_nebula':
      case 'crystal_cave':
        return <FlowerMeadowGame />;
      case 'zen_rock_garden':
        return <ZenGardenGame />;
      case 'water_lily_pond':
        return <LilyPondGame />;
      case 'pulse_wave':
      case 'ripple_matrix':
      case 'bio_pulse_ring':
        return <PulseWaveGame />;
      case 'particle_field':
        return <ParticleFieldGame />;
      case 'breathing_light':
        return <BreathingLightGame onCalibrationComplete={handleFinishGame} />;
      case 'singing_bowls':
      case 'forest_stream':
      case 'solfeggio_528':
      case 'alpha_waves':
      case 'cosmic_frequency':
        return <SoundscapeGame />;
      case 'bubble_pop':
      case 'pattern_align':
      case 'stress_shatter':
      case 'cloud_float':
      case 'sand_drop':
        return <CognitiveDeStressGame />;
      default:
        return <AdaptiveRainGame />;
    }
  };

  const handleFinishGame = () => {
    setCurrentScreen('Rating');
  };

  // The calibration flow drives its own completion (once every triggered
  // capture -- Ring ~210s, EEG ~85s -- actually reports done/error) via
  // onCalibrationComplete above, not a fixed timer -- a 60s force-end would
  // cut a real capture short mid-flight. No footer "abandon" button either,
  // so a capture can't be walked away from by accident.
  const isCalibrating = subId === 'breathing_light';

  return (
    <View style={[styles.container, { backgroundColor: theme.bgPrimary }]}>
      <Header
        title={selectedSubOption ? selectedSubOption.title : 'Gamified Relaxation'}
        showBack
        onBack={() => setCurrentScreen('SubOptionSelector')}
      />

      {!isCalibrating && (
        <View style={styles.timerBar}>
          <Timer initialSeconds={60} onComplete={handleFinishGame} />
        </View>
      )}

      <View style={styles.canvasContainer}>
        {renderGameCanvas()}
      </View>

      {!isCalibrating && (
        <View style={[styles.footer, { borderTopColor: theme.border }]}>
          <TouchableOpacity style={[styles.finishBtn, { backgroundColor: theme.success }]} onPress={handleFinishGame}>
            <Text style={styles.finishBtnTxt}>Complete Exercise & Submit Rating →</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1
  },
  timerBar: {
    paddingVertical: 4
  },
  canvasContainer: {
    flex: 1,
    padding: 12
  },
  footer: {
    padding: 16,
    borderTopWidth: 1
  },
  finishBtn: {
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center'
  },
  finishBtnTxt: {
    color: '#FFFFFF',
    fontWeight: '800',
    fontSize: 15
  }
});
