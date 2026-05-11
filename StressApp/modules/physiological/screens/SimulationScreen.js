import React, { useState, useRef, useEffect } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity,
  ScrollView, Animated, Alert, Dimensions
} from 'react-native';
import Svg, {
  Path, Line, Circle, Rect,
  Text as SvgText, Defs,
  LinearGradient, Stop
} from 'react-native-svg';
import { SafeAreaView } from 'react-native-safe-area-context';
import axios from 'axios';
import { useTheme } from '../config/ThemeContext';
import {
  API_BASE, getSimulationUserId,
  STRESS_COLORS, STRESS_LABELS, STRESS_EMOJI
} from '../config/config';
import { useAppState } from './AppState';

const { width } = Dimensions.get('window');
const GRAPH_W   = width - 72;
const GRAPH_H   = 95;
const MAX_PTS   = 25;

// ── Live Signal Graph ─────────────────────────────────────────
function LiveGraph({ data, color, label, unit, isDark, theme }) {
  const t = theme;

  if (!data || data.length < 2) {
    return (
      <View style={[gStyles.wrap, {
        backgroundColor: isDark ? color + '08' : color + '05',
        borderColor: color + '22',
      }]}>
        <View style={gStyles.emptyBox}>
          <Text style={[gStyles.emptyText, { color: t.textMuted }]}>
            {label} — waiting for data...
          </Text>
        </View>
      </View>
    );
  }

  const values = data.map(d => d.value);
  const n      = data.length;
  const minVal = Math.min(...values);
  const maxVal = Math.max(...values);
  const range  = maxVal - minVal || 1;

  const padT = 12;
  const padB = 22;
  const padL = 4;
  const padR = 28;
  const plotW = GRAPH_W - padL - padR;
  const plotH = GRAPH_H - padT - padB;

  const getX = (i) => padL + (i / (MAX_PTS - 1)) * plotW;
  const getY = (v) => padT + plotH - ((v - minVal) / range) * plotH;

  // Build smooth bezier path
  let pathD = '';
  let areaD = '';
  data.forEach((pt, i) => {
    const x = getX(i);
    const y = getY(pt.value);
    if (i === 0) {
      pathD += `M ${x.toFixed(1)} ${y.toFixed(1)}`;
      areaD += `M ${x.toFixed(1)} ${(padT + plotH).toFixed(1)} L ${x.toFixed(1)} ${y.toFixed(1)}`;
    } else {
      const px  = getX(i - 1);
      const py  = getY(data[i-1].value);
      const cpx = ((px + x) / 2).toFixed(1);
      pathD += ` C ${cpx} ${py.toFixed(1)} ${cpx} ${y.toFixed(1)} ${x.toFixed(1)} ${y.toFixed(1)}`;
      areaD += ` C ${cpx} ${py.toFixed(1)} ${cpx} ${y.toFixed(1)} ${x.toFixed(1)} ${y.toFixed(1)}`;
    }
  });
  const lastX  = getX(n - 1).toFixed(1);
  const firstX = getX(0).toFixed(1);
  const botY   = (padT + plotH).toFixed(1);
  areaD += ` L ${lastX} ${botY} L ${firstX} ${botY} Z`;

  const latest = values[n - 1];
  const prev   = values[n - 2] ?? latest;
  const diff   = latest - prev;
  const trend  = diff >  0.5 ? '↑' : diff < -0.5 ? '↓' : '→';
  const trendColor =
    trend === '↑'
      ? (label.includes('HRV') ? STRESS_COLORS[2] : STRESS_COLORS[2])
      : trend === '↓'
      ? (label.includes('HRV') ? STRESS_COLORS[0] : STRESS_COLORS[0])
      : t.textMuted;

  const zoneAlpha = { 'Normal':'18', 'Pre-Stress':'28', 'Stress':'22' };

  const gradId = label.replace(/[^a-z]/gi, '');

  return (
    <View style={[gStyles.wrap, {
      backgroundColor: isDark ? color + '07' : color + '04',
      borderColor: color + '22',
    }]}>
      {/* Header */}
      <View style={gStyles.header}>
        <View style={gStyles.headerLeft}>
          <View style={[gStyles.dot, { backgroundColor: color }]} />
          <Text style={[gStyles.label, { color: t.text }]}>{label}</Text>
        </View>
        <View style={gStyles.headerRight}>
          <Text style={[gStyles.value, { color }]}>
            {latest.toFixed(label.includes('GSR') ? 3 : 1)}
          </Text>
          <Text style={[gStyles.unit, { color: t.textMuted }]}>
            {' '}{unit}
          </Text>
          <Text style={[gStyles.trend, { color: trendColor }]}>
            {' '}{trend}
          </Text>
        </View>
      </View>

      {/* SVG */}
      <Svg width={GRAPH_W} height={GRAPH_H + padB}>
        <Defs>
          <LinearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0"   stopColor={color} stopOpacity="0.40" />
            <Stop offset="0.7" stopColor={color} stopOpacity="0.08" />
            <Stop offset="1"   stopColor={color} stopOpacity="0.00" />
          </LinearGradient>
        </Defs>

        {/* Stress zone backgrounds */}
        {data.map((pt, i) => {
          if (i >= data.length - 1) return null;
          const x1  = getX(i);
          const x2  = getX(i + 1);
          const lbl = pt.stressLabel;
          const sc  = STRESS_COLORS[pt.prediction];
          const al  = zoneAlpha[lbl] || '10';
          return (
            <Rect
              key={i}
              x={x1.toFixed(1)} y={padT}
              width={(x2 - x1).toFixed(1)}
              height={plotH}
              fill={sc + al}
            />
          );
        })}

        {/* Grid lines */}
        {[0, 0.5, 1].map((pct, i) => {
          const y   = padT + plotH * (1 - pct);
          const val = minVal + range * pct;
          return (
            <React.Fragment key={i}>
              <Line
                x1={padL} y1={y.toFixed(1)}
                x2={(GRAPH_W - padR).toFixed(1)} y2={y.toFixed(1)}
                stroke={isDark ? '#ffffff0a' : '#0000000a'}
                strokeWidth="1"
              />
              <SvgText
                x={(GRAPH_W - padR + 3).toFixed(1)}
                y={(y + 3.5).toFixed(1)}
                fontSize="8"
                fill={isDark ? '#3a5a7a' : '#8aacc8'}
                textAnchor="start"
              >
                {val.toFixed(label.includes('GSR') ? 1 : 0)}
              </SvgText>
            </React.Fragment>
          );
        })}

        {/* Area fill */}
        <Path d={areaD} fill={`url(#${gradId})`} />

        {/* Line */}
        <Path
          d={pathD}
          stroke={color}
          strokeWidth="2.2"
          fill="none"
          strokeLinecap="round"
          strokeLinejoin="round"
        />

        {/* Data points */}
        {data.map((pt, i) => (
          <Circle
            key={i}
            cx={getX(i).toFixed(1)}
            cy={getY(pt.value).toFixed(1)}
            r={i === n - 1 ? 4.5 : 2.5}
            fill={STRESS_COLORS[pt.prediction] || color}
            stroke={isDark ? '#040d1c' : '#ffffff'}
            strokeWidth="1.5"
          />
        ))}

        {/* Latest value vertical line */}
        <Line
          x1={getX(n-1).toFixed(1)} y1={padT}
          x2={getX(n-1).toFixed(1)} y2={(padT + plotH).toFixed(1)}
          stroke={color}
          strokeWidth="1"
          strokeDasharray="3,3"
          opacity="0.45"
        />

        {/* X axis window labels */}
        {data.map((pt, i) => {
          if (i % 5 !== 0) return null;
          return (
            <SvgText
              key={i}
              x={getX(i).toFixed(1)}
              y={(GRAPH_H + padB - 4).toFixed(1)}
              fontSize="8"
              fill={isDark ? '#3a5a7a' : '#8aacc8'}
              textAnchor="middle"
            >
              W{pt.windowIdx}
            </SvgText>
          );
        })}
      </Svg>

      {/* State zone legend */}
      <View style={gStyles.zoneLegend}>
        {[
          { label: 'Normal',     color: STRESS_COLORS[0] },
          { label: 'Pre-stress', color: STRESS_COLORS[1] },
          { label: 'Stress',     color: STRESS_COLORS[2] },
        ].map((z, i) => (
          <View key={i} style={gStyles.zoneItem}>
            <View style={[gStyles.zoneDot, { backgroundColor: z.color }]} />
            <Text style={[gStyles.zoneText, { color: t.textMuted }]}>
              {z.label}
            </Text>
          </View>
        ))}
        <Text style={[gStyles.zoneNote, { color: t.textMuted }]}>
          dots = state
        </Text>
      </View>
    </View>
  );
}

// ── Glow Gauge ────────────────────────────────────────────────
function GlowGauge({ prediction, pulseAnim, isDark, COLORS }) {
  const color = prediction ? STRESS_COLORS[prediction.prediction] : '#334155';
  const emoji = prediction ? STRESS_EMOJI[prediction.prediction]  : '😴';
  const label = prediction ? STRESS_LABELS[prediction.prediction] : 'Ready';

  const rotAnim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.loop(
      Animated.timing(rotAnim, { toValue: 1, duration: 12000, useNativeDriver: true })
    ).start();
  }, []);
  const rotate = rotAnim.interpolate({ inputRange:[0,1], outputRange:['0deg','360deg'] });

  return (
    <View style={sStyles.gaugeWrap}>
      <Animated.View style={[sStyles.outerRing, {
        borderColor: color + '25', transform: [{ rotate }]
      }]} />
      <Animated.View style={[sStyles.midRing, {
        borderColor: color + '50', transform: [{ scale: pulseAnim }]
      }]} />
      <Animated.View style={[sStyles.gauge, {
        backgroundColor: isDark ? '#0a1628' : '#ffffff',
        borderColor: color,
        transform: [{ scale: pulseAnim }],
        shadowColor: color, shadowOpacity: 0.5,
        shadowRadius: 24, elevation: 10,
      }]}>
        <Text style={sStyles.gaugeEmoji}>{emoji}</Text>
        <Text style={[sStyles.gaugeLabel, { color }]}>{label}</Text>
        {prediction && (
          <>
            <View style={[sStyles.gaugeLine, { backgroundColor: color + '40' }]} />
            <Text style={[sStyles.gaugeProb, { color: color + 'cc' }]}>
              Pre-stress {(prediction.probabilities?.prestress * 100 || 0).toFixed(0)}%
            </Text>
            {prediction.state && (
              <Text style={sStyles.gaugeState}>{prediction.state}</Text>
            )}
          </>
        )}
      </Animated.View>
    </View>
  );
}

// ── Timeline Block ────────────────────────────────────────────
function TBlock({ w, idx }) {
  const s = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.spring(s, {
      toValue: 1, tension: 200, friction: 8,
      delay: idx * 15, useNativeDriver: true
    }).start();
  }, []);
  return (
    <Animated.View style={[sStyles.tBlock, {
      backgroundColor: STRESS_COLORS[w.prediction],
      transform: [{ scaleY: s }],
      borderWidth: w.trend_alert ? 1.5 : 0,
      borderColor: '#fff',
      opacity: w.trend_alert ? 1 : 0.82,
    }]} />
  );
}

// ── Main Screen ───────────────────────────────────────────────
export default function SimulationScreen({ navigation }) {
  const { isDark, theme, COLORS } = useTheme();
  const {
    selectedSubject, setSelectedSubject,
    setLastSessionId, setLastEmaResult
  } = useAppState();

  const [running,   setRunning]   = useState(false);
  const [curPred,   setCurPred]   = useState(null);
  const [windowLog, setWindowLog] = useState([]);
  const [progress,  setProgress]  = useState(0);
  const [stats,     setStats]     = useState({
    normal: 0, prestress: 0, stress: 0
  });

  // Live graph data
  const [hrvData, setHrvData] = useState([]);
  const [gsrData, setGsrData] = useState([]);

  const intervalRef  = useRef(null);
  const pulseAnim    = useRef(new Animated.Value(1)).current;
  const trendShown   = useRef(false);
  const sessionIdRef = useRef(null);
  const userIdRef    = useRef(getSimulationUserId(2));
  const logRef       = useRef(null);
  const t = theme;

  useEffect(() => {
    if (!running)
      userIdRef.current = getSimulationUserId(selectedSubject);
  }, [selectedSubject, running]);

  const pulse = () => {
    Animated.sequence([
      Animated.timing(pulseAnim, { toValue: 1.1, duration: 220, useNativeDriver: true }),
      Animated.timing(pulseAnim, { toValue: 1,   duration: 220, useNativeDriver: true }),
    ]).start();
  };

  const startSim = async () => {
    const uid = getSimulationUserId(selectedSubject);
    userIdRef.current = uid;
    try {
      const res = await axios.post(`${API_BASE}/simulate/start`, {
        user_id: uid, subject_id: selectedSubject
      });
      sessionIdRef.current = res.data.session_id;
      trendShown.current   = false;
      setLastSessionId(res.data.session_id);
      setWindowLog([]); setProgress(0); setCurPred(null);
      setStats({ normal: 0, prestress: 0, stress: 0 });
      setHrvData([]); setGsrData([]);
      setRunning(true);
      intervalRef.current = setInterval(fetchNext, 2000);
    } catch {
      Alert.alert('Error', 'Could not start. Is backend running?');
    }
  };

  const fetchNext = async () => {
    try {
      const res  = await axios.post(
        `${API_BASE}/simulate/next`,
        { user_id: userIdRef.current }
      );
      const data = res.data;

      if (data.done) {
        clearInterval(intervalRef.current);
        setRunning(false);
        handleDone();
        return;
      }

      setCurPred(data);
      setProgress(data.progress);

      const pred = data.prediction;
      const wIdx = data.window_idx;
      const sLbl = STRESS_LABELS[pred];

      setStats(p => ({
        normal:    p.normal    + (pred === 0 ? 1 : 0),
        prestress: p.prestress + (pred === 1 ? 1 : 0),
        stress:    p.stress    + (pred === 2 ? 1 : 0),
      }));

      // Update HRV graph (AVNN)
      const avnn = data.features?.AVNN ?? null;
      if (avnn !== null) {
        setHrvData(prev => [...prev, {
          windowIdx:   wIdx,
          value:       parseFloat(avnn),
          prediction:  pred,
          stressLabel: sLbl,
        }].slice(-MAX_PTS));
      }

      // Update GSR graph (SCL_mean)
      const scl = data.features?.SCL_mean ?? null;
      if (scl !== null) {
        setGsrData(prev => [...prev, {
          windowIdx:   wIdx,
          value:       parseFloat(scl),
          prediction:  pred,
          stressLabel: sLbl,
        }].slice(-MAX_PTS));
      }

      setWindowLog(p => [...p, {
        idx:         wIdx,
        prediction:  pred,
        label:       data.label,
        raw_label:   data.raw_label,
        state:       data.state,
        true_label:  data.true_label,
        true_name:   data.true_name,
        trend_alert: data.trend_alert,
        hr:          data.features?.MeanHR?.toFixed(1),
        scl:         data.features?.SCL_mean?.toFixed(2),
        prob_pre:    data.probabilities?.prestress
          ? (data.probabilities.prestress * 100).toFixed(0)
          : '0',
      }]);

      pulse();

      if (data.trend_alert && !trendShown.current) {
        trendShown.current = true;
        Alert.alert(
          '⚠️ Pre-Stress Detected',
          'Rising stress trend detected.\nNovel Contribution N1 — Early warning active.',
          [{ text: 'OK' }]
        );
      }

      setTimeout(() => logRef.current?.scrollToEnd({ animated: true }), 100);

    } catch (e) {
      console.log('Fetch error:', e.message);
    }
  };

  const handleDone = async () => {
    const sid = sessionIdRef.current;
    const uid = userIdRef.current;
    try {
      await axios.post(`${API_BASE}/simulate/stop`, { user_id: uid });
    } catch {}
    try {
      const br = await axios.get(`${API_BASE}/baseline/${uid}`);
      if (!br.data?.exists) {
        Alert.alert(
          'Complete',
          `No baseline for ${uid}.\nRun calibration first.`,
          [{ text: 'Calibrate',
             onPress: () => navigation.navigate('Calibration') },
           { text: 'OK' }]
        );
        return;
      }
      const er = await axios.post(
        `${API_BASE}/ema/update`,
        { user_id: uid, session_id: sid }
      );
      setLastEmaResult(er.data);
      Alert.alert(
        '✅ Simulation Complete',
        `Session saved.\nEMA updated for ${uid}.`,
        [{ text: 'View EMA', onPress: () => navigation.navigate('EMA Update') },
         { text: 'PSS-4',   onPress: () => navigation.navigate('PSS-4') },
         { text: 'OK' }]
      );
    } catch {
      Alert.alert('Complete', 'Session saved. EMA failed.');
    }
  };

  const stopSim = async () => {
    if (intervalRef.current) clearInterval(intervalRef.current);
    setRunning(false);
    await handleDone();
  };

  useEffect(() => {
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, []);

  // Phase detection
  const phases = [];
  let cur = null;
  windowLog.forEach(w => {
    const lbl = STRESS_LABELS[w.prediction];
    if (!cur || cur.label !== lbl) {
      if (cur) phases.push(cur);
      cur = {
        label: lbl, prediction: w.prediction,
        start: w.idx, end: w.idx, count: 1
      };
    } else { cur.end = w.idx; cur.count++; }
  });
  if (cur) phases.push(cur);

  const gaugeColor = curPred
    ? STRESS_COLORS[curPred.prediction]
    : '#334155';

  // Always show the graph card so the user sees the UI state
  // (idle vs waiting vs plotting) instead of the section disappearing.
  const showGraphs = true;
  const missingSeriesData =
    running && windowLog.length >= 2 && hrvData.length < 2 && gsrData.length < 2;
  const idleNoData =
    !running && windowLog.length === 0 && hrvData.length < 2 && gsrData.length < 2;

  return (
    <SafeAreaView style={[sStyles.safe, { backgroundColor: t.bg }]}>
      <ScrollView showsVerticalScrollIndicator={false}>

        {/* Header */}
        <View style={sStyles.header}>
          <View>
            <Text style={[sStyles.title, { color: t.text }]}>
              Simulation
            </Text>
            <Text style={[sStyles.sub, { color: COLORS.brand }]}>
              {getSimulationUserId(selectedSubject)} · S{selectedSubject}
            </Text>
          </View>
          {running && (
            <View style={[sStyles.liveBadge, {
              backgroundColor: COLORS.stress + '18',
              borderColor: COLORS.stress + '40',
            }]}>
              <View style={[sStyles.liveDot, {
                backgroundColor: COLORS.stress
              }]} />
              <Text style={[sStyles.liveText, { color: COLORS.stress }]}>
                LIVE
              </Text>
            </View>
          )}
        </View>

        {/* Gauge */}
        <GlowGauge
          prediction={curPred}
          pulseAnim={pulseAnim}
          isDark={isDark}
          COLORS={COLORS}
        />

        {/* Pre-stress alert */}
        {curPred?.trend_alert && (
          <View style={[sStyles.alertBar, {
            backgroundColor: COLORS.prestress + '15',
            borderColor: COLORS.prestress + '60',
          }]}>
            <Text style={{ fontSize: 24 }}>⚠️</Text>
            <View>
              <Text style={[sStyles.alertTitle, {
                color: COLORS.prestress
              }]}>
                Pre-Stress Trend Detected
              </Text>
              <Text style={[sStyles.alertSub, {
                color: COLORS.prestress + '80'
              }]}>
                Novel Contribution N1 — 5-window sliding trend
              </Text>
            </View>
          </View>
        )}

        {/* Progress */}
        <View style={sStyles.progressWrap}>
          <View style={[sStyles.progressBg, { backgroundColor: t.card }]}>
            <Animated.View style={[sStyles.progressFill, {
              width: `${progress * 100}%`,
              backgroundColor: gaugeColor,
            }]} />
          </View>
          <View style={sStyles.progressRow}>
            <Text style={[sStyles.progText, { color: t.textMuted }]}>
              {(progress * 100).toFixed(0)}% · W{curPred?.window_idx ?? 0}
            </Text>
            <Text style={[sStyles.progText, { color: gaugeColor }]}>
              {running ? 'Running...' : 'Idle'}
            </Text>
          </View>
        </View>

        {/* Stats */}
        <View style={sStyles.statsRow}>
          {[
            { label: 'Normal',     value: stats.normal,    color: COLORS.normal },
            { label: 'Pre-Stress', value: stats.prestress, color: COLORS.prestress },
            { label: 'Stress',     value: stats.stress,    color: COLORS.stress },
          ].map((s, i) => (
            <View key={i} style={[sStyles.statCard, {
              backgroundColor: isDark ? s.color + '10' : s.color + '08',
              borderColor: s.color + '28',
            }]}>
              <Text style={[sStyles.statVal, { color: s.color }]}>
                {s.value}
              </Text>
              <Text style={[sStyles.statLabel, { color: t.textMuted }]}>
                {s.label}
              </Text>
            </View>
          ))}
        </View>

        {/* Subject selector */}
        {!running && (
          <View style={[sStyles.card, {
            backgroundColor: t.card, borderColor: t.border
          }]}>
            <Text style={[sStyles.cardTitle, { color: t.text }]}>
              Select Subject
            </Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={{ marginTop: 10 }}
            >
              {[2,3,4,5,6,7,8,9,10,11,13,14,15,16,17].map(sid => (
                <TouchableOpacity
                  key={sid}
                  style={[sStyles.subChip,
                    selectedSubject === sid
                      ? { backgroundColor: COLORS.brand,
                          borderColor: COLORS.brand }
                      : { backgroundColor: isDark
                            ? COLORS.brand + '12'
                            : COLORS.brand + '08',
                          borderColor: t.border }
                  ]}
                  onPress={() => setSelectedSubject(sid)}
                >
                  <Text style={[sStyles.subChipText, {
                    color: selectedSubject === sid
                      ? '#fff' : t.textMuted
                  }]}>
                    S{sid}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        )}

        {/* Control button */}
        <TouchableOpacity
          style={[sStyles.ctrlBtn, {
            backgroundColor: running ? COLORS.stress : COLORS.brand
          }]}
          onPress={running ? stopSim : startSim}
          activeOpacity={0.87}
        >
          <Text style={sStyles.ctrlBtnText}>
            {running ? '⏹  Stop Simulation' : '▶️  Start Simulation'}
          </Text>
        </TouchableOpacity>

        {/* ── LIVE SIGNAL GRAPHS ───────────────────────────── */}
        {showGraphs && (
          <View style={[sStyles.card, {
            backgroundColor: t.card, borderColor: t.border
          }]}>
            <Text style={[sStyles.cardTitle, { color: t.text }]}>
              Live Signal Trends
            </Text>
            <Text style={[sStyles.cardSub, { color: t.textMuted }]}>
              HRV and GSR updated every window ·
              background zone = stress state
            </Text>

            {idleNoData && (
              <Text style={[sStyles.cardSub, { marginBottom: 10, color: t.textMuted }]}>
                Start the simulation to see live graphs.
              </Text>
            )}

            {running && windowLog.length === 0 && (
              <Text style={[sStyles.cardSub, { marginBottom: 10, color: t.textMuted }]}>
                Waiting for the first window…
              </Text>
            )}

            {missingSeriesData && (
              <Text style={[sStyles.cardSub, { marginBottom: 10, color: t.textMuted }]}>
                Windows are arriving, but AVNN/SCL_mean are missing.
              </Text>
            )}

            <LiveGraph
              data={hrvData}
              color={COLORS.hrv}
              label="HRV (AVNN)"
              unit="ms"
              isDark={isDark}
              theme={t}
            />

            <View style={sStyles.graphDivider} />

            <LiveGraph
              data={gsrData}
              color={COLORS.gsr}
              label="GSR (SCL_mean)"
              unit="μS"
              isDark={isDark}
              theme={t}
            />
          </View>
        )}

        {/* Timeline */}
        {windowLog.length > 0 && (
          <View style={[sStyles.card, {
            backgroundColor: t.card, borderColor: t.border
          }]}>
            <Text style={[sStyles.cardTitle, { color: t.text }]}>
              Stress Sequence Timeline
            </Text>
            <Text style={[sStyles.cardSub, { color: t.textMuted }]}>
              Each block = 60-second window
            </Text>
            <View style={sStyles.timeline}>
              {windowLog.map((w, i) => (
                <TBlock key={i} w={w} idx={i} />
              ))}
            </View>
            <View style={sStyles.legendRow}>
              {[
                [COLORS.normal,    'Normal'],
                [COLORS.prestress, 'Pre-stress'],
                [COLORS.stress,    'Stress'],
              ].map(([c, l], i) => (
                <View key={i} style={sStyles.legendItem}>
                  <View style={[sStyles.legendDot, { backgroundColor: c }]} />
                  <Text style={[sStyles.legendText, { color: t.textMuted }]}>
                    {l}
                  </Text>
                </View>
              ))}
            </View>
            {phases.length > 0 && (
              <View style={[sStyles.phaseRow, {
                borderTopColor: t.border
              }]}>
                {phases.map((p, i) => (
                  <React.Fragment key={i}>
                    <View style={[sStyles.phaseChip, {
                      backgroundColor: STRESS_COLORS[p.prediction] + '18',
                      borderColor: STRESS_COLORS[p.prediction] + '50',
                    }]}>
                      <Text style={[sStyles.phaseLabel, {
                        color: STRESS_COLORS[p.prediction]
                      }]}>
                        {p.label}
                      </Text>
                      <Text style={[sStyles.phaseRange, {
                        color: t.textMuted
                      }]}>
                        W{p.start}–{p.end}
                      </Text>
                    </View>
                    {i < phases.length - 1 && (
                      <Text style={[sStyles.phaseArrow, {
                        color: t.textMuted
                      }]}>→</Text>
                    )}
                  </React.Fragment>
                ))}
              </View>
            )}
          </View>
        )}

        {/* Live feed */}
        {windowLog.length > 0 && (
          <View style={[sStyles.card, {
            backgroundColor: t.card, borderColor: t.border
          }]}>
            <Text style={[sStyles.cardTitle, { color: t.text }]}>
              Live Prediction Feed
            </Text>
            <Text style={[sStyles.cardSub, { color: t.textMuted }]}>
              {windowLog.length} windows ·{' '}
              {windowLog.filter(w => w.raw_label !== w.label).length} SM overrides
            </Text>
            <ScrollView
              ref={logRef}
              style={sStyles.logScroll}
              showsVerticalScrollIndicator
              onContentSizeChange={() =>
                logRef.current?.scrollToEnd({ animated: false })
              }
            >
              {windowLog.map((w, i) => (
                <View key={i} style={[
                  sStyles.logRow,
                  w.prediction === 1 && {
                    backgroundColor: COLORS.prestress + '08'
                  },
                  w.trend_alert && {
                    backgroundColor: COLORS.prestress + '14'
                  },
                  { borderBottomColor: t.border }
                ]}>
                  <View style={[sStyles.logDot, {
                    backgroundColor: STRESS_COLORS[w.prediction]
                  }]} />
                  <View style={sStyles.logContent}>
                    <Text style={[sStyles.logMain, { color: t.text }]}>
                      W{w.idx} →{' '}
                      <Text style={{
                        color: STRESS_COLORS[w.prediction],
                        fontWeight: '800'
                      }}>
                        {w.label}
                      </Text>
                      {w.trend_alert ? '  ⚠️' : ''}
                    </Text>
                    <Text style={[sStyles.logDetail, { color: t.textMuted }]}>
                      HR:{w.hr}bpm · SCL:{w.scl}μS · Pre:{w.prob_pre}%
                    </Text>
                    {w.raw_label !== w.label && (
                      <Text style={[sStyles.logOverride, {
                        color: COLORS.prestress
                      }]}>
                        XGB:{w.raw_label} → SM:{w.label}
                      </Text>
                    )}
                  </View>
                  {w.prediction !== w.true_label && (
                    <Text style={[sStyles.logTrue, { color: t.textMuted }]}>
                      ≠{w.true_name}
                    </Text>
                  )}
                </View>
              ))}
            </ScrollView>
          </View>
        )}

        <View style={{ height: 80 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

// ── Graph Styles ──────────────────────────────────────────────
const gStyles = StyleSheet.create({
  wrap:       { borderRadius: 16, borderWidth: 1, padding: 12, overflow: 'hidden' },
  emptyBox:   { height: GRAPH_H + 22, alignItems: 'center', justifyContent: 'center' },
  emptyText:  { fontSize: 12, fontStyle: 'italic' },
  header:     { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  dot:        { width: 8, height: 8, borderRadius: 4 },
  label:      { fontSize: 13, fontWeight: '800' },
  headerRight:{ flexDirection: 'row', alignItems: 'baseline' },
  value:      { fontSize: 17, fontWeight: '900' },
  unit:       { fontSize: 11 },
  trend:      { fontSize: 15, fontWeight: '900' },
  zoneLegend: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 4 },
  zoneItem:   { flexDirection: 'row', alignItems: 'center', gap: 4 },
  zoneDot:    { width: 7, height: 7, borderRadius: 3.5 },
  zoneText:   { fontSize: 10, fontWeight: '600' },
  zoneNote:   { fontSize: 9, fontStyle: 'italic', marginLeft: 'auto' },
});

// ── Screen Styles ─────────────────────────────────────────────
const sStyles = StyleSheet.create({
  safe:         { flex: 1 },
  header:       { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, paddingTop: 16, paddingBottom: 8 },
  title:        { fontSize: 22, fontWeight: '900' },
  sub:          { fontSize: 12, marginTop: 2, fontWeight: '700' },
  liveBadge:    { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 14, borderWidth: 1 },
  liveDot:      { width: 6, height: 6, borderRadius: 3 },
  liveText:     { fontSize: 11, fontWeight: '800', letterSpacing: 1 },
  gaugeWrap:    { alignItems: 'center', justifyContent: 'center', height: 250, paddingVertical: 20 },
  outerRing:    { position: 'absolute', width: 240, height: 240, borderRadius: 120, borderWidth: 1, borderStyle: 'dashed' },
  midRing:      { position: 'absolute', width: 218, height: 218, borderRadius: 109, borderWidth: 2 },
  gauge:        { width: 190, height: 190, borderRadius: 95, borderWidth: 3, alignItems: 'center', justifyContent: 'center', shadowOffset: { width: 0, height: 0 } },
  gaugeEmoji:   { fontSize: 44 },
  gaugeLabel:   { fontSize: 17, fontWeight: '900', marginTop: 4 },
  gaugeLine:    { width: 80, height: 1, marginVertical: 7 },
  gaugeProb:    { fontSize: 11 },
  gaugeState:   { fontSize: 10, color: '#5a7a9a', marginTop: 2, fontStyle: 'italic' },
  alertBar:     { flexDirection: 'row', alignItems: 'center', gap: 12, marginHorizontal: 20, marginBottom: 12, borderRadius: 16, padding: 14, borderWidth: 1.5 },
  alertTitle:   { fontWeight: '800', fontSize: 14 },
  alertSub:     { fontSize: 10, marginTop: 2 },
  progressWrap: { paddingHorizontal: 20, marginBottom: 14 },
  progressBg:   { height: 6, borderRadius: 3, overflow: 'hidden' },
  progressFill: { height: 6, borderRadius: 3 },
  progressRow:  { flexDirection: 'row', justifyContent: 'space-between', marginTop: 6 },
  progText:     { fontSize: 11, fontWeight: '600' },
  statsRow:     { flexDirection: 'row', paddingHorizontal: 20, gap: 10, marginBottom: 14 },
  statCard:     { flex: 1, padding: 14, borderRadius: 16, borderWidth: 1, alignItems: 'center' },
  statVal:      { fontSize: 24, fontWeight: '900' },
  statLabel:    { fontSize: 10, marginTop: 3, fontWeight: '600' },
  card:         { marginHorizontal: 20, marginBottom: 14, padding: 16, borderRadius: 20, borderWidth: 1 },
  cardTitle:    { fontSize: 15, fontWeight: '800' },
  cardSub:      { fontSize: 11, marginTop: 3, marginBottom: 12, fontStyle: 'italic' },
  graphDivider: { height: 12 },
  subChip:      { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 10, marginRight: 8, borderWidth: 1 },
  subChipText:  { fontWeight: '700', fontSize: 13 },
  ctrlBtn:      { marginHorizontal: 20, marginBottom: 14, padding: 18, borderRadius: 18, alignItems: 'center' },
  ctrlBtnText:  { color: '#fff', fontSize: 17, fontWeight: '800' },
  timeline:     { flexDirection: 'row', flexWrap: 'wrap', gap: 2, marginBottom: 10 },
  tBlock:       { width: 9, height: 30, borderRadius: 2 },
  legendRow:    { flexDirection: 'row', gap: 14, marginBottom: 10 },
  legendItem:   { flexDirection: 'row', alignItems: 'center', gap: 5 },
  legendDot:    { width: 8, height: 8, borderRadius: 4 },
  legendText:   { fontSize: 11 },
  phaseRow:     { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6, paddingTop: 12, borderTopWidth: 1 },
  phaseChip:    { borderRadius: 10, borderWidth: 1, paddingHorizontal: 10, paddingVertical: 6, alignItems: 'center' },
  phaseLabel:   { fontWeight: '800', fontSize: 11 },
  phaseRange:   { fontSize: 9, marginTop: 2 },
  phaseArrow:   { fontSize: 13, fontWeight: '700' },
  logScroll:    { maxHeight: 280 },
  logRow:       { flexDirection: 'row', alignItems: 'center', paddingVertical: 8, borderBottomWidth: 1 },
  logDot:       { width: 8, height: 8, borderRadius: 4, marginRight: 10 },
  logContent:   { flex: 1 },
  logMain:      { fontSize: 13 },
  logDetail:    { fontSize: 10, marginTop: 2 },
  logOverride:  { fontSize: 9, fontStyle: 'italic', marginTop: 1 },
  logTrue:      { fontSize: 9, fontStyle: 'italic' },
});