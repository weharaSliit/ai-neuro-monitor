import React, { useState, useEffect, useRef } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Animated } from 'react-native';

const STROOP_COLORS = [
  { label: 'RED', color: '#EF4444' },
  { label: 'BLUE', color: '#3B82F6' },
  { label: 'GREEN', color: '#10B981' },
  { label: 'YELLOW', color: '#F59E0B' },
  { label: 'PURPLE', color: '#8B5CF6' }
];

export const StressInductionStroopScreen = ({ onComplete }) => {
  // Phases: 'intro' | 'stroop' | 'stroop_done' | 'math' | 'complete'
  const [phase, setPhase] = useState('intro');
  const [timeLeft, setTimeLeft] = useState(30); // 30s per game stage

  // Scores
  const [stroopScore, setStroopScore] = useState(0);
  const [stroopAttempts, setStroopAttempts] = useState(0);
  const [mathScore, setMathScore] = useState(0);
  const [mathAttempts, setMathAttempts] = useState(0);

  // Stage 1 State: Stroop
  const [currentWord, setCurrentWord] = useState(STROOP_COLORS[0]);
  const [currentColor, setCurrentColor] = useState(STROOP_COLORS[1]);
  const [feedback, setFeedback] = useState(null);

  // Stage 2 State: Speed Math
  const [mathProblem, setMathProblem] = useState({ expr: '17 + 28', answer: 45, options: [45, 43, 49, 35] });

  // STROOP GENERATOR
  const generateStroop = () => {
    const wordObj = STROOP_COLORS[Math.floor(Math.random() * STROOP_COLORS.length)];
    let colorObj = STROOP_COLORS[Math.floor(Math.random() * STROOP_COLORS.length)];
    if (Math.random() < 0.75) {
      while (colorObj.label === wordObj.label) {
        colorObj = STROOP_COLORS[Math.floor(Math.random() * STROOP_COLORS.length)];
      }
    }
    setCurrentWord(wordObj);
    setCurrentColor(colorObj);
  };

  // MATH GENERATOR
  const generateMath = () => {
    const ops = ['+', '-', 'x'];
    const op = ops[Math.floor(Math.random() * ops.length)];
    let a, b, ans;
    if (op === '+') {
      a = Math.floor(Math.random() * 45) + 12;
      b = Math.floor(Math.random() * 45) + 12;
      ans = a + b;
    } else if (op === '-') {
      a = Math.floor(Math.random() * 50) + 30;
      b = Math.floor(Math.random() * 25) + 10;
      ans = a - b;
    } else {
      a = Math.floor(Math.random() * 9) + 4;
      b = Math.floor(Math.random() * 9) + 3;
      ans = a * b;
    }

    const opts = new Set([ans]);
    while (opts.size < 4) {
      const offset = (Math.random() < 0.5 ? 1 : -1) * (Math.floor(Math.random() * 6) + 1);
      opts.add(ans + offset);
    }
    setMathProblem({
      expr: `${a} ${op === 'x' ? '×' : op} ${b}`,
      answer: ans,
      options: Array.from(opts).sort(() => Math.random() - 0.5)
    });
  };

  // TIMER FOR STROOP (STAGE 1)
  useEffect(() => {
    if (phase !== 'stroop') return;
    const interval = setInterval(() => {
      setTimeLeft((prev) => {
        if (prev <= 1) {
          clearInterval(interval);
          setPhase('stroop_done');
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [phase]);

  // TIMER FOR SPEED MATH (STAGE 2)
  useEffect(() => {
    if (phase !== 'math') return;
    const interval = setInterval(() => {
      setTimeLeft((prev) => {
        if (prev <= 1) {
          clearInterval(interval);
          setPhase('complete');
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [phase]);

  // ACTION HANDLERS
  const startStroopStage = () => {
    setStroopScore(0);
    setStroopAttempts(0);
    setMathScore(0);
    setMathAttempts(0);
    setTimeLeft(30);
    setPhase('stroop');
    generateStroop();
  };

  const startMathStage = () => {
    setTimeLeft(30);
    setPhase('math');
    generateMath();
  };

  const handleStroopAnswer = (selectedColor) => {
    setStroopAttempts((prev) => prev + 1);
    if (selectedColor.label === currentColor.label) {
      setStroopScore((prev) => prev + 1);
      setFeedback('CORRECT');
    } else {
      setFeedback('WRONG!');
    }
    setTimeout(() => {
      setFeedback(null);
      generateStroop();
    }, 120);
  };

  const handleMathAnswer = (selectedAns) => {
    setMathAttempts((prev) => prev + 1);
    if (selectedAns === mathProblem.answer) {
      setMathScore((prev) => prev + 1);
      setFeedback('CORRECT');
    } else {
      setFeedback('WRONG!');
    }
    setTimeout(() => {
      setFeedback(null);
      generateMath();
    }, 120);
  };

  // FINAL CALCULATIONS
  const calculateResults = () => {
    const totalAtt = (stroopAttempts + mathAttempts) || 1;
    const totalRight = stroopScore + mathScore;
    const accuracyRatio = totalRight / totalAtt;
    const accuracyPct = Math.round(accuracyRatio * 100);

    let prob = 0.25;
    let stressState = 'normal';
    let labelText = 'CALM / HIGH FOCUS';
    let pillColor = '#10B981'; // Green

    if (accuracyPct >= 88) {
      prob = 0.25;
      stressState = 'normal';
      labelText = 'CALM / HIGH FOCUS';
      pillColor = '#10B981';
    } else if (accuracyPct >= 75) {
      prob = 0.55;
      stressState = 'normal';
      labelText = 'MODERATE FOCUS';
      pillColor = '#38BDF8'; // Blue
    } else if (accuracyPct >= 60) {
      prob = 0.75;
      stressState = 'stress';
      labelText = 'ELEVATED STRESS';
      pillColor = '#F59E0B'; // Amber
    } else {
      prob = 0.90;
      stressState = 'high_stress';
      labelText = 'HIGH ACUTE STRESS';
      pillColor = '#EF4444'; // Red
    }

    return { accuracy: accuracyPct, stressProbability: prob, stressState, totalAtt, totalRight, labelText, pillColor };
  };

  const results = calculateResults();

  return (
    <View style={styles.container}>
      {/* ─── PHASE 1: INTRO ─── */}
      {phase === 'intro' && (
        <View style={styles.card}>
          <Text style={styles.title}>🧠 2-Stage Stress Challenge</Text>
          <Text style={styles.subtitle}>
            Test your speed and focus under pressure before starting relaxation!
          </Text>
          <View style={styles.rulesBox}>
            <Text style={styles.ruleTitle}>2 RAPID STAGES (30s EACH):</Text>
            <Text style={styles.ruleText}>⚡ <Text style={{fontWeight: 'bold', color: '#F59E0B'}}>Stage 1: Color Clash</Text> — Tap the INK COLOR of the word.</Text>
            <Text style={styles.ruleText}>🔢 <Text style={{fontWeight: 'bold', color: '#38BDF8'}}>Stage 2: Speed Math</Text> — Solve rapid math problems under time pressure.</Text>
          </View>
          <TouchableOpacity style={styles.primaryButton} onPress={startStroopStage}>
            <Text style={styles.primaryButtonText}>START STAGE 1: COLOR CLASH 🚀</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* ─── PHASE 2: STAGE 1 COLOR CLASH ─── */}
      {phase === 'stroop' && (
        <View style={styles.activeContainer}>
          <View style={styles.timerHeader}>
            <Text style={styles.stageTag}>STAGE 1: COLOR CLASH</Text>
            <Text style={styles.timerText}>⏳ {timeLeft}s</Text>
          </View>
          <View style={styles.targetBox}>
            <Text style={[styles.targetWord, { color: currentColor.color }]}>
              {currentWord.label}
            </Text>
            {feedback && (
              <Text style={[styles.feedbackText, feedback === 'CORRECT' ? styles.correctText : styles.wrongText]}>
                {feedback}
              </Text>
            )}
          </View>
          <Text style={styles.promptText}>Tap the INK COLOR of the word above:</Text>
          <View style={styles.optionsGrid}>
            {STROOP_COLORS.map((item) => (
              <TouchableOpacity
                key={item.label}
                style={[styles.optionBtn, { backgroundColor: item.color }]}
                onPress={() => handleStroopAnswer(item)}
              >
                <Text style={styles.optionBtnText}>{item.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      )}

      {/* ─── PHASE 3: TRANSITION TO SPEED MATH ─── */}
      {phase === 'stroop_done' && (
        <View style={styles.card}>
          <Text style={styles.title}>⚡ Stage 1 Complete!</Text>
          <Text style={styles.subtitle}>Great job on Color Clash!</Text>
          
          <View style={styles.statsBox}>
            <Text style={styles.statLabel}>Color Clash Score: {stroopScore} / {stroopAttempts}</Text>
            <Text style={styles.statSub}>Now get ready for Stage 2: Speed Math Challenge!</Text>
          </View>

          <TouchableOpacity style={[styles.primaryButton, { backgroundColor: '#38BDF8' }]} onPress={startMathStage}>
            <Text style={styles.primaryButtonText}>START STAGE 2: SPEED MATH 🔢</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* ─── PHASE 4: STAGE 2 SPEED MATH ─── */}
      {phase === 'math' && (
        <View style={styles.activeContainer}>
          <View style={styles.timerHeader}>
            <Text style={[styles.stageTag, { color: '#38BDF8' }]}>STAGE 2: SPEED MATH</Text>
            <Text style={styles.timerText}>⏳ {timeLeft}s</Text>
          </View>
          <View style={[styles.targetBox, { borderColor: '#38BDF8' }]}>
            <Text style={[styles.targetWord, { color: '#F8FAFC', fontSize: 38 }]}>
              {mathProblem.expr} = ?
            </Text>
            {feedback && (
              <Text style={[styles.feedbackText, feedback === 'CORRECT' ? styles.correctText : styles.wrongText]}>
                {feedback}
              </Text>
            )}
          </View>
          <Text style={styles.promptText}>Tap the correct answer fast:</Text>
          <View style={styles.optionsGrid}>
            {mathProblem.options.map((ansVal, idx) => (
              <TouchableOpacity
                key={idx}
                style={[styles.optionBtn, { backgroundColor: '#1E293B', borderWidth: 2, borderColor: '#38BDF8' }]}
                onPress={() => handleMathAnswer(ansVal)}
              >
                <Text style={[styles.optionBtnText, { color: '#F8FAFC' }]}>{ansVal}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      )}

      {/* ─── PHASE 5: ALL COMPLETE ─── */}
      {phase === 'complete' && (
        <View style={styles.card}>
          <Text style={styles.title}>✅ Stress Battery Completed!</Text>
          <Text style={styles.subtitle}>
            Your acute mental stress level has been calculated for the AI Engine.
          </Text>

          <View style={styles.statsBox}>
            <Text style={styles.statLabel}>Total Accuracy: {results.accuracy}%</Text>
            <Text style={styles.statSub}>Color Clash: {stroopScore}/{stroopAttempts} | Speed Math: {mathScore}/{mathAttempts}</Text>

            <View style={[styles.badgePill, { borderColor: results.pillColor, backgroundColor: results.pillColor + '22' }]}>
              <Text style={[styles.badgeText, { color: results.pillColor }]}>
                Stress Level: {results.labelText} ({Math.round(results.stressProbability * 100)}%)
              </Text>
            </View>
          </View>

          <TouchableOpacity 
            style={styles.primaryButton} 
            onPress={() => onComplete && onComplete(results)}
          >
            <Text style={styles.primaryButtonText}>SEE BEST & ALTERNATIVE GAMES 🎯</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0F172A',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20
  },
  card: {
    backgroundColor: '#1E293B',
    borderRadius: 20,
    padding: 24,
    width: '100%',
    maxWidth: 400,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#334155'
  },
  title: {
    fontSize: 22,
    fontWeight: 'bold',
    color: '#F8FAFC',
    textAlign: 'center',
    marginBottom: 8
  },
  subtitle: {
    fontSize: 14,
    color: '#94A3B8',
    textAlign: 'center',
    marginBottom: 16
  },
  rulesBox: {
    backgroundColor: '#0F172A',
    padding: 16,
    borderRadius: 12,
    width: '100%',
    marginBottom: 24
  },
  ruleTitle: {
    color: '#F59E0B',
    fontWeight: 'bold',
    fontSize: 13,
    marginBottom: 6
  },
  ruleText: {
    color: '#CBD5E1',
    fontSize: 13,
    marginBottom: 6,
    lineHeight: 18
  },
  primaryButton: {
    backgroundColor: '#3B82F6',
    paddingVertical: 14,
    paddingHorizontal: 28,
    borderRadius: 12,
    width: '100%',
    alignItems: 'center'
  },
  primaryButtonText: {
    color: '#FFFFFF',
    fontWeight: 'bold',
    fontSize: 15
  },
  activeContainer: {
    width: '100%',
    alignItems: 'center'
  },
  timerHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    width: '100%',
    paddingHorizontal: 16,
    marginBottom: 20,
    alignItems: 'center'
  },
  stageTag: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#F59E0B'
  },
  timerText: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#EF4444'
  },
  targetBox: {
    backgroundColor: '#1E293B',
    borderRadius: 24,
    width: '90%',
    height: 160,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 20,
    borderWidth: 2,
    borderColor: '#475569'
  },
  targetWord: {
    fontSize: 44,
    fontWeight: '900',
    letterSpacing: 2
  },
  feedbackText: {
    position: 'absolute',
    bottom: 12,
    fontWeight: 'bold',
    fontSize: 14
  },
  correctText: { color: '#10B981' },
  wrongText: { color: '#EF4444' },
  promptText: {
    color: '#94A3B8',
    fontSize: 14,
    marginBottom: 16
  },
  optionsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 12,
    width: '100%'
  },
  optionBtn: {
    width: '44%',
    paddingVertical: 16,
    borderRadius: 14,
    alignItems: 'center'
  },
  optionBtnText: {
    color: '#FFFFFF',
    fontWeight: 'bold',
    fontSize: 16
  },
  statsBox: {
    backgroundColor: '#0F172A',
    padding: 16,
    borderRadius: 12,
    width: '100%',
    alignItems: 'center',
    marginBottom: 20
  },
  statLabel: {
    color: '#38BDF8',
    fontSize: 18,
    fontWeight: 'bold'
  },
  statSub: {
    color: '#94A3B8',
    fontSize: 13,
    marginTop: 4,
    textAlign: 'center'
  },
  badgePill: {
    backgroundColor: 'rgba(239,68,68,0.2)',
    borderColor: '#EF4444',
    borderWidth: 1,
    borderRadius: 20,
    paddingVertical: 6,
    paddingHorizontal: 12,
    marginTop: 12
  },
  badgeText: {
    color: '#F8FAFC',
    fontSize: 12,
    fontWeight: 'bold'
  }
});
