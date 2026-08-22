import React, { useState, useEffect, useContext } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { AppContext } from '../context/AppContext';
import { ThemeContext } from '../context/ThemeContext';
import { Header } from '../components/Header';

import { useSweetAlert } from '../context/SweetAlertContext';

export const BaselineCalibrationScreen = () => {
  const { showAlert } = useSweetAlert();
  const { setCurrentScreen, setIsCalibrated } = useContext(AppContext);
  const { theme } = useContext(ThemeContext);

  const [secondsLeft, setSecondsLeft] = useState(60);
  const [isCalibrating, setIsCalibrating] = useState(false);

  const startCalibration = () => {
    setIsCalibrating(true);
  };

  useEffect(() => {
    let timer = null;
    if (isCalibrating && secondsLeft > 0) {
      timer = setInterval(() => {
        setSecondsLeft((prev) => prev - 1);
      }, 1000);
    } else if (isCalibrating && secondsLeft === 0) {
      setIsCalibrated(true);
      setCurrentScreen('Dashboard');
    }
    return () => {
      if (timer) clearInterval(timer);
    };
  }, [isCalibrating, secondsLeft]);

  const progressPct = ((60 - secondsLeft) / 60) * 100;

  return (
    <View style={[styles.container, { backgroundColor: theme.bgPrimary }]}>
      <Header title="Baseline Calibration" showBack onBack={() => setCurrentScreen('Permissions')} />

      <View style={styles.body}>
        <Text style={[styles.heading, { color: theme.textPrimary }]}>60-Second Baseline Calibration</Text>
        <Text style={[styles.sub, { color: theme.textSecondary }]}>
          Sit comfortably while Calm AI records baseline HRV (RMSSD/SDNN), GSR skin conductance, and EEG alpha/beta ratios for 60 seconds.
        </Text>

        <View style={[styles.circle, { backgroundColor: theme.bgSecondary, borderColor: theme.accent }]}>
          <Text style={[styles.counterTxt, { color: theme.accent }]}>{secondsLeft}s</Text>
          <Text style={[styles.statusTxt, { color: theme.textMuted }]}>
            {isCalibrating ? `Recording Baseline (${progressPct.toFixed(0)}%)` : 'Ready'}
          </Text>
        </View>

        {!isCalibrating ? (
          <TouchableOpacity style={[styles.startBtn, { backgroundColor: theme.accent }]} onPress={startCalibration}>
            <Text style={[styles.startBtnTxt, { color: theme.accentText }]}>Begin 60s Calibration →</Text>
          </TouchableOpacity>
        ) : (
          <View style={styles.noteBox}>
            <Text style={[styles.calibNote, { color: theme.warning }]}>
              🧘 Remain still, relax your jaw, and breathe naturally...
            </Text>
          </View>
        )}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1
  },
  body: {
    padding: 24,
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center'
  },
  heading: {
    fontSize: 22,
    fontWeight: '800',
    marginBottom: 6,
    textAlign: 'center'
  },
  sub: {
    fontSize: 13,
    textAlign: 'center',
    marginBottom: 32,
    lineHeight: 18
  },
  circle: {
    width: 170,
    height: 170,
    borderRadius: 85,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 3,
    marginBottom: 32,
    elevation: 4
  },
  counterTxt: {
    fontSize: 44,
    fontWeight: '900'
  },
  statusTxt: {
    fontSize: 11,
    marginTop: 4,
    fontWeight: '600'
  },
  startBtn: {
    paddingVertical: 14,
    paddingHorizontal: 32,
    borderRadius: 12
  },
  startBtnTxt: {
    fontWeight: '800',
    fontSize: 16
  },
  noteBox: {
    padding: 12,
    borderRadius: 12
  },
  calibNote: {
    fontSize: 13,
    fontWeight: '600',
    textAlign: 'center'
  }
});
