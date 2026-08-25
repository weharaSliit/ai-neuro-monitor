import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';

export const PatternMatrixGame = () => {
  const [sequence, setSequence] = useState([]);
  const [userStep, setUserStep] = useState(0);
  const [score, setScore] = useState(0);
  const [level, setLevel] = useState(1);
  const [activeTile, setActiveTile] = useState(null);
  const [isDisplaying, setIsDisplaying] = useState(false);
  const [statusMsg, setStatusMsg] = useState('Watch the glowing grid pattern...');

  const tiles = [0, 1, 2, 3, 4, 5, 6, 7, 8]; // 3x3 Grid

  // Start round
  useEffect(() => {
    startNewRound(1);
  }, []);

  const startNewRound = (lvl) => {
    setLevel(lvl);
    setUserStep(0);
    setIsDisplaying(true);
    setStatusMsg(`Level ${lvl}: Memorize the pattern...`);

    // Generate sequence of length = lvl + 2
    const seqLength = lvl + 2;
    const newSeq = [];
    for (let i = 0; i < seqLength; i++) {
      newSeq.push(Math.floor(Math.random() * 9));
    }
    setSequence(newSeq);

    // Display pattern to user
    playSequence(newSeq);
  };

  const playSequence = (seq) => {
    let idx = 0;
    const interval = setInterval(() => {
      if (idx < seq.length) {
        setActiveTile(seq[idx]);
        setTimeout(() => setActiveTile(null), 400);
        idx++;
      } else {
        clearInterval(interval);
        setIsDisplaying(false);
        setStatusMsg('Your turn! Repeat the pattern');
      }
    }, 750);
  };

  const handleTilePress = (tileId) => {
    if (isDisplaying) return;

    setActiveTile(tileId);
    setTimeout(() => setActiveTile(null), 250);

    if (tileId === sequence[userStep]) {
      // Correct tile!
      const nextStep = userStep + 1;
      setUserStep(nextStep);

      if (nextStep === sequence.length) {
        // Completed sequence!
        const bonus = 100 * level;
        setScore(s => s + bonus);
        setStatusMsg(`✨ Perfect! Level ${level} Mastered (+${bonus} pts)`);

        setTimeout(() => {
          startNewRound(level + 1);
        }, 1200);
      }
    } else {
      // Wrong tile - reset round
      setStatusMsg('❌ Pattern Missed! Retrying level...');
      setTimeout(() => {
        startNewRound(level);
      }, 1200);
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.hud}>
        <View style={styles.hudItem}>
          <Text style={styles.hudLabel}>🧩 MATRIX SCORE</Text>
          <Text style={styles.hudValue}>{score}</Text>
        </View>
        <View style={styles.hudItem}>
          <Text style={styles.hudLabel}>🎯 LEVEL</Text>
          <Text style={styles.hudValue}>{level}</Text>
        </View>
      </View>

      <Text style={styles.statusTxt}>{statusMsg}</Text>

      {/* 3x3 Pattern Grid */}
      <View style={styles.grid}>
        {tiles.map(tileId => {
          const isActive = activeTile === tileId;
          return (
            <TouchableOpacity
              key={tileId}
              disabled={isDisplaying}
              onPress={() => handleTilePress(tileId)}
              style={[
                styles.tile,
                isActive && styles.tileActive
              ]}
            >
              <Text style={styles.tileTxt}>{isActive ? '⚡' : ''}</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      <View style={styles.footer}>
        <Text style={styles.footerTxt}>🧠 MAXIMUM FOCUS • IMMERSE YOUR ATTENTION IN PATTERN MEMORY</Text>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0F172A',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
  },
  hud: {
    position: 'absolute',
    top: 20,
    left: 16,
    right: 16,
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  hudItem: {
    backgroundColor: 'rgba(30, 41, 59, 0.85)',
    paddingVertical: 6,
    paddingHorizontal: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#38BDF8',
  },
  hudLabel: {
    color: '#38BDF8',
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 1,
  },
  hudValue: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '800',
  },
  statusTxt: {
    color: '#F1F5F9',
    fontSize: 15,
    fontWeight: '700',
    marginBottom: 24,
    textAlign: 'center',
  },
  grid: {
    width: 270,
    height: 270,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  tile: {
    width: 78,
    height: 78,
    borderRadius: 16,
    backgroundColor: '#1E293B',
    borderWidth: 2,
    borderColor: '#334155',
    justifyContent: 'center',
    alignItems: 'center',
  },
  tileActive: {
    backgroundColor: '#0284C7',
    borderColor: '#38BDF8',
    shadowColor: '#38BDF8',
    shadowRadius: 15,
    shadowOpacity: 1,
    elevation: 8,
  },
  tileTxt: {
    fontSize: 28,
  },
  footer: {
    position: 'absolute',
    bottom: 20,
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  footerTxt: {
    color: '#64748B',
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1,
  },
});
