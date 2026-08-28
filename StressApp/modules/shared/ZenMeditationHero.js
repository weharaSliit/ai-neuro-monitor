import React from 'react';
import { View, StyleSheet } from 'react-native';
import Svg, {
  G, Path, Circle, Rect, Defs, LinearGradient, RadialGradient, Stop, Ellipse
} from 'react-native-svg';
import { COLORS } from '../physiological/config/theme';

/**
 * ZenMeditationHero — A serene vector illustration of a person meditating
 * peacefully in lotus pose, surrounded by gentle sage leaves and soft clouds.
 * Inspired by the "Practice Yoga" reference artwork.
 */
export default function ZenMeditationHero({ size = 260 }) {
  const scale = size / 260;

  return (
    <View style={[styles.container, { width: size, height: size }]}>
      <Svg width={size} height={size} viewBox="0 0 260 260" style={styles.svg}>
        <Defs>
          {/* Background Ambient Glow */}
          <RadialGradient id="zenAura" cx="50%" cy="50%" r="50%">
            <Stop offset="0%" stopColor={COLORS.brandSoft} stopOpacity="0.8" />
            <Stop offset="65%" stopColor={COLORS.normalSoft} stopOpacity="0.5" />
            <Stop offset="100%" stopColor="#FFFFFF" stopOpacity="0" />
          </RadialGradient>

          {/* Plant Leaf Gradient */}
          <LinearGradient id="leafGradLeft" x1="0%" y1="100%" x2="100%" y2="0%">
            <Stop offset="0%" stopColor="#688E6F" />
            <Stop offset="100%" stopColor="#9EBE99" />
          </LinearGradient>

          <LinearGradient id="leafGradRight" x1="100%" y1="100%" x2="0%" y2="0%">
            <Stop offset="0%" stopColor="#5E8365" />
            <Stop offset="100%" stopColor="#8EAF8A" />
          </LinearGradient>

          {/* Robe / Clothing Gradient */}
          <LinearGradient id="robeGrad" x1="0%" y1="0%" x2="0%" y2="100%">
            <Stop offset="0%" stopColor="#9FAEC6" />
            <Stop offset="100%" stopColor="#7E90B0" />
          </LinearGradient>

          {/* Pants Gradient */}
          <LinearGradient id="pantsGrad" x1="0%" y1="0%" x2="0%" y2="100%">
            <Stop offset="0%" stopColor="#6C7F9B" />
            <Stop offset="100%" stopColor="#52647E" />
          </LinearGradient>

          {/* Skin Tone Gradient */}
          <LinearGradient id="skinGrad" x1="0%" y1="0%" x2="0%" y2="100%">
            <Stop offset="0%" stopColor="#F9D7C2" />
            <Stop offset="100%" stopColor="#F0C3A8" />
          </LinearGradient>
        </Defs>

        {/* Ambient Halo Disc */}
        <Circle cx="130" cy="130" r="110" fill="url(#zenAura)" />

        {/* Floating Soft Zen Clouds */}
        <G opacity="0.65">
          {/* Top Left Cloud */}
          <Path
            d="M 45 60 Q 55 45 70 52 Q 85 45 95 58 Q 100 70 85 75 Q 40 76 45 60 Z"
            fill="#E0EFF0"
          />
          {/* Top Right Cloud */}
          <Path
            d="M 175 48 Q 188 35 205 42 Q 220 36 228 50 Q 232 62 218 66 Q 170 67 175 48 Z"
            fill="#E0EFF0"
          />
          {/* Floating Mindful Sparkles/Circles */}
          <Circle cx="55" cy="100" r="4" fill="#C3DFD9" />
          <Circle cx="210" cy="95" r="3.5" fill="#C3DFD9" />
          <Circle cx="198" cy="115" r="2.5" fill="#C3DFD9" />
        </G>

        {/* Serene Foliage / Botanical Branches Behind Meditator */}
        {/* Left Botanical Branch */}
        <G>
          <Path d="M 68 185 Q 60 145 65 110" stroke="#7BA07E" strokeWidth="2.5" strokeLinecap="round" fill="none" />
          <Ellipse cx="56" cy="155" rx="14" ry="7" transform="rotate(-35 56 155)" fill="url(#leafGradLeft)" />
          <Ellipse cx="72" cy="140" rx="13" ry="6" transform="rotate(25 72 140)" fill="url(#leafGradLeft)" />
          <Ellipse cx="54" cy="128" rx="13" ry="6" transform="rotate(-30 54 128)" fill="url(#leafGradLeft)" />
          <Ellipse cx="70" cy="118" rx="12" ry="5.5" transform="rotate(20 70 118)" fill="url(#leafGradLeft)" />
          <Ellipse cx="62" cy="104" rx="11" ry="5" transform="rotate(-15 62 104)" fill="url(#leafGradLeft)" />
        </G>

        {/* Right Botanical Branch */}
        <G>
          <Path d="M 192 185 Q 200 145 195 110" stroke="#7BA07E" strokeWidth="2.5" strokeLinecap="round" fill="none" />
          <Ellipse cx="204" cy="155" rx="14" ry="7" transform="rotate(35 204 155)" fill="url(#leafGradRight)" />
          <Ellipse cx="188" cy="140" rx="13" ry="6" transform="rotate(-25 188 140)" fill="url(#leafGradRight)" />
          <Ellipse cx="206" cy="128" rx="13" ry="6" transform="rotate(30 206 128)" fill="url(#leafGradRight)" />
          <Ellipse cx="190" cy="118" rx="12" ry="5.5" transform="rotate(-20 190 118)" fill="url(#leafGradRight)" />
          <Ellipse cx="198" cy="104" rx="11" ry="5" transform="rotate(15 198 104)" fill="url(#leafGradRight)" />
        </G>

        {/* Ground Meditation Cushion / Shadow */}
        <Ellipse cx="130" cy="208" rx="68" ry="12" fill="#E2DDD5" opacity="0.6" />
        <Ellipse cx="130" cy="206" rx="55" ry="9" fill="#D3CBC2" opacity="0.5" />

        {/* Person Meditating */}
        {/* Crossed Legs in Lotus Pose */}
        <Path
          d="M 80 195 C 75 190 85 180 105 182 C 120 183 130 186 130 186 C 130 186 140 183 155 182 C 175 180 185 190 180 195 C 172 205 145 206 130 206 C 115 206 88 205 80 195 Z"
          fill="url(#pantsGrad)"
        />
        {/* Left Foot */}
        <Ellipse cx="88" cy="194" rx="11" ry="6" transform="rotate(15 88 194)" fill="url(#skinGrad)" />
        {/* Right Foot */}
        <Ellipse cx="172" cy="194" rx="11" ry="6" transform="rotate(-15 172 194)" fill="url(#skinGrad)" />

        {/* Torso / Meditation Shirt */}
        <Path
          d="M 108 142 L 95 185 C 105 188 155 188 165 185 L 152 142 Z"
          fill="url(#robeGrad)"
        />

        {/* Arms Resting on Knees in Mudra */}
        {/* Left Arm */}
        <Path
          d="M 108 142 C 90 150 78 168 76 182 C 75 190 88 192 94 186 C 98 182 105 170 110 160 Z"
          fill="url(#robeGrad)"
        />
        {/* Left Hand / Gyan Mudra */}
        <Circle cx="76" cy="184" r="6.5" fill="url(#skinGrad)" />

        {/* Right Arm */}
        <Path
          d="M 152 142 C 170 150 182 168 184 182 C 185 190 172 192 166 186 C 162 182 155 170 150 160 Z"
          fill="url(#robeGrad)"
        />
        {/* Right Hand / Gyan Mudra */}
        <Circle cx="184" cy="184" r="6.5" fill="url(#skinGrad)" />

        {/* Neck */}
        <Rect x="124" y="132" width="12" height="13" rx="4" fill="url(#skinGrad)" />

        {/* Head */}
        <Ellipse cx="130" cy="118" rx="14" ry="17" fill="url(#skinGrad)" />

        {/* Peaceful Facial Features */}
        {/* Closed Eyes */}
        <Path d="M 122 118 Q 125 121 127 118" stroke="#7A5643" strokeWidth="1.6" strokeLinecap="round" fill="none" />
        <Path d="M 133 118 Q 135 121 138 118" stroke="#7A5643" strokeWidth="1.6" strokeLinecap="round" fill="none" />
        {/* Subtle Peaceful Smile */}
        <Path d="M 127 126 Q 130 128 133 126" stroke="#9E6954" strokeWidth="1.4" strokeLinecap="round" fill="none" />
        {/* Soft Blush */}
        <Circle cx="120" cy="122" r="3" fill="#E89680" opacity="0.35" />
        <Circle cx="140" cy="122" r="3" fill="#E89680" opacity="0.35" />

        {/* Hair */}
        <Path
          d="M 116 114 C 114 100 125 96 130 96 C 135 96 146 100 144 114 C 141 106 135 104 130 104 C 125 104 119 106 116 114 Z"
          fill="#5A4032"
        />
        <Circle cx="130" cy="98" r="7" fill="#5A4032" />
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  svg: {
    overflow: 'visible',
  },
});

