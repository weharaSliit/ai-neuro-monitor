import { Platform } from 'react-native';

/**
 * Pure JavaScript Base64 Binary Encoder.
 * Works natively across React Native Hermes engine, iOS, Android, and Web without external modules or btoa.
 */
function base64Encode(bytes) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let result = '';
  const len = bytes.length;
  for (let i = 0; i < len; i += 3) {
    const b1 = bytes[i];
    const b2 = i + 1 < len ? bytes[i + 1] : 0;
    const b3 = i + 2 < len ? bytes[i + 2] : 0;

    const c1 = b1 >> 2;
    const c2 = ((b1 & 3) << 4) | (b2 >> 4);
    const c3 = i + 1 < len ? (((b2 & 15) << 2) | (b3 >> 6)) : 64;
    const c4 = i + 2 < len ? (b3 & 63) : 64;

    result += chars.charAt(c1) + chars.charAt(c2) +
      (c3 === 64 ? '=' : chars.charAt(c3)) +
      (c4 === 64 ? '=' : chars.charAt(c4));
  }
  return result;
}

/**
 * High-Fidelity 16-bit 22.05kHz PCM WAV Data URI Sound Synthesizer with Dynamic Breath Bio-Feedback.
 * Synthesizes instrumental relaxation music and dynamic breath-synchronized audio modulation:
 * - Inhale: Pitch & volume smoothly swell upwards (300Hz -> 528Hz)
 * - Hold Top: Steady 10Hz Binaural Alpha focus drone
 * - Exhale: Pitch & volume glide downwards (528Hz -> 300Hz)
 * - Rest: Low 150Hz grounding tone
 */
function generateWavDataUri(type = 'piano_rain', durationSeconds = 4, breathPhase = 'inhale') {
  const sampleRate = 22050; // High quality 22.05kHz audio
  const numSamples = sampleRate * durationSeconds;
  const buffer = new Uint8Array(44 + numSamples * 2); // 16-bit PCM = 2 bytes/sample

  const writeString = (offset, str) => {
    for (let i = 0; i < str.length; i++) {
      buffer[offset + i] = str.charCodeAt(i);
    }
  };
  const writeUint32 = (offset, val) => {
    buffer[offset] = val & 0xff;
    buffer[offset + 1] = (val >> 8) & 0xff;
    buffer[offset + 2] = (val >> 16) & 0xff;
    buffer[offset + 3] = (val >> 24) & 0xff;
  };
  const writeUint16 = (offset, val) => {
    buffer[offset] = val & 0xff;
    buffer[offset + 1] = (val >> 8) & 0xff;
  };

  // 16-bit Mono PCM WAV Header
  writeString(0, 'RIFF');
  writeUint32(4, 36 + numSamples * 2);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  writeUint32(16, 16);
  writeUint16(20, 1);  // 1 = PCM
  writeUint16(22, 1);  // 1 = Mono
  writeUint32(24, sampleRate);
  writeUint32(28, sampleRate * 2); // ByteRate (22050 * 2)
  writeUint16(32, 2);  // BlockAlign (2 bytes)
  writeUint16(34, 16); // 16-bit PCM
  writeString(36, 'data');
  writeUint32(40, numSamples * 2);

  // Smooth 100ms Loop Envelope
  const fadeSamples = Math.floor(sampleRate * 0.1);
  let b0 = 0, b1 = 0, b2 = 0;

  for (let i = 0; i < numSamples; i++) {
    const t = i / sampleRate;
    const progress = Math.min(1.0, Math.max(0.0, i / numSamples)); // 0 to 1 over step
    let sampleVal = 0.0;

    // Loop Fade Envelope
    let loopEnv = 1.0;
    if (i < fadeSamples) {
      loopEnv = i / fadeSamples;
    } else if (i > numSamples - fadeSamples) {
      loopEnv = (numSamples - i) / fadeSamples;
    }

    // Dynamic Breath Pitch & Volume Modulation Math
    let breathFreq = 432;
    let breathGain = 0.6;

    if (breathPhase === 'inhale') {
      // Swell upwards: 300Hz -> 528Hz, Volume 0.25 -> 0.85
      breathFreq = 300 + (528 - 300) * progress;
      breathGain = 0.25 + 0.6 * progress;
    } else if (breathPhase === 'hold') {
      // Sustained 528Hz + 10Hz Binaural Alpha beat (538Hz)
      breathFreq = 528;
      breathGain = 0.8;
    } else if (breathPhase === 'exhale') {
      // Glide downwards: 528Hz -> 300Hz, Volume 0.85 -> 0.25
      breathFreq = 528 - (528 - 300) * progress;
      breathGain = 0.85 - 0.6 * progress;
    } else {
      // Rest / Grounding: Low 150Hz tone
      breathFreq = 150;
      breathGain = 0.35;
    }

    if (type === 'chakra_breath' || type === 'chakra') {
      // Dynamic 432Hz/528Hz Solfeggio Synth Pad with 10Hz Binaural Alpha pulse
      const f1 = breathFreq;
      const f2 = breathFreq + (breathPhase === 'hold' ? 10 : 5); // Binaural beat
      const sub = breathFreq / 2;
      const t1 = Math.sin(2 * Math.PI * f1 * t);
      const t2 = Math.sin(2 * Math.PI * f2 * t);
      const tSub = Math.sin(2 * Math.PI * sub * t);
      sampleVal = (0.4 * t1 + 0.4 * t2 + 0.2 * tSub) * breathGain * 0.4;

    } else if (type === 'piano_rain' || type === 'rain') {
      // Ambient Piano Chords + Soft Rain Acoustics
      const chordFreqs = [261.63, 329.63, 392.00, 523.25]; // C-Major7 acoustic chord
      const currentChord = chordFreqs[Math.floor((t * 2) % chordFreqs.length)];
      const decay = Math.exp(-0.8 * (t % 1.0));
      const pianoTone = Math.sin(2 * Math.PI * currentChord * t) * decay;

      // Soft low-pass rain background
      const white = Math.random() * 2 - 1;
      b0 = 0.96 * b0 + white * 0.04;

      sampleVal = (0.5 * pianoTone + 0.5 * b0) * breathGain * 0.35;

    } else if (type === 'zen_flute') {
      // Japanese Bamboo Zen Flute (Shakuhachi 432Hz Pentatonic melody + 5Hz vibrato)
      const pentatonic = [432, 486, 576, 648];
      const note = pentatonic[Math.floor((t * 1.5) % pentatonic.length)];
      const vibrato = Math.sin(2 * Math.PI * 5 * t) * 6;
      const fluteTone = Math.sin(2 * Math.PI * (note + vibrato) * t);

      sampleVal = fluteTone * breathGain * 0.35;

    } else if (type === 'ocean_harp' || type === 'ocean') {
      // Acoustic Plucked Harp + Rhythmic Sea Tides
      const harpNotes = [261.63, 329.63, 392.00, 523.25, 659.25];
      const harpFreq = harpNotes[Math.floor((t * 3) % harpNotes.length)];
      const harpDecay = Math.exp(-2.0 * (t % 0.33));
      const harpTone = Math.sin(2 * Math.PI * harpFreq * t) * harpDecay;

      // Low-pass sea tide swell
      const white = Math.random() * 2 - 1;
      b1 = 0.985 * b1 + white * 0.015;

      sampleVal = (0.55 * harpTone + 0.45 * b1) * breathGain * 0.35;

    } else if (type === 'singing_bowl' || type === 'bowl') {
      // Tibetan Bronze Singing Bowl Gong (528Hz & 264Hz) with 2.5s exponential decay
      const strikeInterval = t % 2.5;
      const decay = Math.exp(-1.2 * strikeInterval);
      const shimmer = 1.0 + 0.08 * Math.sin(2 * Math.PI * 3 * t);
      const tone1 = Math.sin(2 * Math.PI * 528 * t);
      const tone2 = Math.sin(2 * Math.PI * 264 * t);
      sampleVal = (0.6 * tone1 + 0.4 * tone2) * decay * shimmer * breathGain * 0.35;

    } else if (type === 'forest') {
      // Serene Forest Canopy Stream (380Hz stream acoustics + 120Hz breeze)
      const white = Math.random() * 2 - 1;
      b2 = 0.94 * b2 + white * 0.06;
      const breeze = 0.8 + 0.2 * Math.sin(2 * Math.PI * 0.3 * t);
      const softTone = 0.05 * Math.sin(2 * Math.PI * 528 * t);
      sampleVal = (b2 * breeze + softTone) * breathGain * 0.35;

    } else {
      const white = Math.random() * 2 - 1;
      b0 = 0.95 * b0 + white * 0.05;
      sampleVal = b0 * breathGain * 0.25;
    }

    // Apply loop envelope & convert to 16-bit Signed PCM [-32768, 32767]
    const pcmSample = Math.max(-32768, Math.min(32767, Math.floor(sampleVal * loopEnv * 24000)));

    // Write Little-Endian 16-bit PCM
    const sampleIdx = 44 + i * 2;
    buffer[sampleIdx] = pcmSample & 0xff;
    buffer[sampleIdx + 1] = (pcmSample >> 8) & 0xff;
  }

  const base64Str = base64Encode(buffer);
  return `data:audio/wav;base64,${base64Str}`;
}

/**
 * Synthesizes a soft, tranquil 16-bit pentatonic instrument chime on user touch:
 * @param {number} positionRatio - 0.0 to 1.0 touch coordinate ratio
 */
function generateTouchChimeWavDataUri(positionRatio = 0.5) {
  const sampleRate = 22050;
  const durationSeconds = 0.4;
  const numSamples = Math.floor(sampleRate * durationSeconds);
  const buffer = new Uint8Array(44 + numSamples * 2);

  const writeString = (offset, str) => {
    for (let i = 0; i < str.length; i++) buffer[offset + i] = str.charCodeAt(i);
  };
  const writeUint32 = (offset, val) => {
    buffer[offset] = val & 0xff;
    buffer[offset + 1] = (val >> 8) & 0xff;
    buffer[offset + 2] = (val >> 16) & 0xff;
    buffer[offset + 3] = (val >> 24) & 0xff;
  };
  const writeUint16 = (offset, val) => {
    buffer[offset] = val & 0xff;
    buffer[offset + 1] = (val >> 8) & 0xff;
  };

  writeString(0, 'RIFF');
  writeUint32(4, 36 + numSamples * 2);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  writeUint32(16, 16);
  writeUint16(20, 1);
  writeUint16(22, 1);
  writeUint32(24, sampleRate);
  writeUint32(28, sampleRate * 2);
  writeUint16(32, 2);
  writeUint16(34, 16);
  writeString(36, 'data');
  writeUint32(40, numSamples * 2);

  const pentatonicScale = [261.63, 329.63, 392.00, 440.00, 523.25, 659.25];
  const scaleIdx = Math.min(pentatonicScale.length - 1, Math.max(0, Math.floor(positionRatio * pentatonicScale.length)));
  const freq = pentatonicScale[scaleIdx];

  for (let i = 0; i < numSamples; i++) {
    const t = i / sampleRate;
    const decay = Math.exp(-7.0 * t);
    const chimeTone = Math.sin(2 * Math.PI * freq * t) + 0.3 * Math.sin(2 * Math.PI * (freq * 2) * t);
    const sampleVal = chimeTone * decay * 0.45;

    const pcmSample = Math.max(-32768, Math.min(32767, Math.floor(sampleVal * 24000)));
    const sampleIdx = 44 + i * 2;
    buffer[sampleIdx] = pcmSample & 0xff;
    buffer[sampleIdx + 1] = (pcmSample >> 8) & 0xff;
  }

  return `data:audio/wav;base64,${base64Encode(buffer)}`;
}

class SoundEngine {
  constructor() {
    this.soundObject = null;
    this.audioElement = null;
    this.audioCtx = null;
    this.webNodes = [];
    this.currentTrackType = 'piano_rain';
    this.currentBreathPhase = 'inhale';
  }

  /**
   * Triggers a soft, peaceful instrument chime note on user touch interaction.
   * @param {number} positionRatio - 0.0 to 1.0 (X touch position relative to screen width)
   */
  async playTouchChime(positionRatio = 0.5) {
    try {
      if (typeof window !== 'undefined' && window.Audio) {
        const chimeUri = generateTouchChimeWavDataUri(positionRatio);
        const audio = new window.Audio(chimeUri);
        audio.volume = 0.6;
        audio.play().catch(() => {});
        return;
      }
    } catch (e) {
      // Fallback
    }

    try {
      const expoAudio = require('expo-audio');
      if (expoAudio && (expoAudio.AudioPlayer || expoAudio.createAudioPlayer)) {
        const chimeUri = generateTouchChimeWavDataUri(positionRatio);
        const createPlayer = expoAudio.createAudioPlayer || ((uri) => new expoAudio.AudioPlayer(uri));
        const player = createPlayer(chimeUri);
        player.volume = 0.6;
        if (player.play) player.play();
      }
    } catch (err) {}
  }

  /**
   * Stops any currently playing audio stream cleanly.
   */
  async stopSound() {
    try {
      if (this.soundObject) {
        await this.soundObject.stopAsync().catch(() => { });
        await this.soundObject.unloadAsync().catch(() => { });
        this.soundObject = null;
      }

      if (this.audioElement) {
        this.audioElement.pause();
        this.audioElement.currentTime = 0;
        this.audioElement = null;
      }

      if (this.webNodes.length > 0) {
        this.webNodes.forEach(node => {
          try {
            if (node.stop) node.stop();
            if (node.disconnect) node.disconnect();
          } catch (err) { }
        });
        this.webNodes = [];
      }
    } catch (e) {
      // Ignore cleanup error
    }
  }

  /**
   * Updates breath phase dynamically in real-time.
   * Modulates frequency and volume: Inhale (swells up) -> Hold (steady alpha) -> Exhale (glides down).
   * @param {string} phase - 'inhale', 'hold', 'exhale', 'rest'
   * @param {number} durationSeconds - duration of step
   */
  async updateBreathPhase(phase = 'inhale', durationSeconds = 4) {
    if (this.currentBreathPhase === phase) return;
    this.currentBreathPhase = phase;

    if (this.currentTrackType) {
      await this.playSoundTrack(this.currentTrackType, phase, durationSeconds);
    }
  }

  /**
   * Plays relaxation track through the smartphone's built-in speaker system.
   * @param {string} trackType - 'piano_rain', 'zen_flute', 'ocean_harp', 'chakra_breath', 'singing_bowl', 'forest'
   * @param {string} breathPhase - 'inhale', 'hold', 'exhale', 'rest'
   * @param {number} durationSeconds - duration in seconds
   */
  async playSoundTrack(trackType = 'piano_rain', breathPhase = 'inhale', durationSeconds = 4) {
    await this.stopSound();

    this.currentTrackType = trackType;
    this.currentBreathPhase = breathPhase;

    const wavDataUri = generateWavDataUri(trackType, durationSeconds, breathPhase);

    // 1. Try modern expo-audio API (SDK 54+)
    try {
      const expoAudio = require('expo-audio');
      if (expoAudio && (expoAudio.AudioPlayer || expoAudio.createAudioPlayer)) {
        const createPlayer = expoAudio.createAudioPlayer || ((uri) => new expoAudio.AudioPlayer(uri));
        const player = createPlayer(wavDataUri);
        player.loop = true;
        player.volume = 1.0;
        if (player.play) player.play();
        this.soundObject = player;
        return;
      }
    } catch (e) {
      // Fall through to HTML5 Audio / Web Audio
    }

    // 3. Try HTML5 Audio element (Browsers)
    try {
      if (typeof window !== 'undefined' && window.Audio) {
        const audio = new window.Audio(wavDataUri);
        audio.loop = true;
        audio.volume = 1.0;
        await audio.play().catch(() => { });
        this.audioElement = audio;
        return;
      }
    } catch (e) {
      // Fall through to Web Audio API
    }

    // 4. Fallback to Web Audio API Synthesizer
    this.playWebAudioSynthesizer(trackType, breathPhase);
  }

  /**
   * Web Audio API Synthesizer fallback with dynamic breath phase modulation
   */
  playWebAudioSynthesizer(type, breathPhase = 'inhale') {
    try {
      const AudioCtxClass = typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext);
      if (!AudioCtxClass) return;

      if (!this.audioCtx) {
        this.audioCtx = new AudioCtxClass();
      }
      const ctx = this.audioCtx;
      if (ctx.state === 'suspended') {
        ctx.resume();
      }

      let baseFreq = breathPhase === 'inhale' ? 480 : breathPhase === 'exhale' ? 320 : 432;

      if (type === 'piano_rain' || type === 'ocean_harp' || type === 'forest') {
        const bufferSize = ctx.sampleRate * 2;
        const noiseBuffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
        const output = noiseBuffer.getChannelData(0);
        let b0 = 0, b1 = 0;

        for (let i = 0; i < bufferSize; i++) {
          const white = Math.random() * 2 - 1;
          b0 = 0.96 * b0 + white * 0.04;
          output[i] = b0 * 0.08;
        }

        const whiteNoise = ctx.createBufferSource();
        whiteNoise.buffer = noiseBuffer;
        whiteNoise.loop = true;

        const filter = ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.value = breathPhase === 'inhale' ? 500 : 300;

        const gainNode = ctx.createGain();
        gainNode.gain.value = breathPhase === 'inhale' ? 0.3 : 0.15;

        whiteNoise.connect(filter);
        filter.connect(gainNode);
        gainNode.connect(ctx.destination);

        whiteNoise.start();
        this.webNodes.push(whiteNoise, filter, gainNode);
      } else {
        const osc = ctx.createOscillator();
        const gainNode = ctx.createGain();

        osc.type = 'sine';
        osc.frequency.setValueAtTime(baseFreq, ctx.currentTime);

        gainNode.gain.value = breathPhase === 'inhale' ? 0.25 : 0.12;

        osc.connect(gainNode);
        gainNode.connect(ctx.destination);

        osc.start();
        this.webNodes.push(osc, gainNode);
      }
    } catch (e) {
      console.warn('Web Audio synthesis fallback error:', e);
    }
  }
}

export const soundEngine = new SoundEngine();