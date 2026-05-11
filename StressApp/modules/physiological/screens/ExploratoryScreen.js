import React, { useState, useEffect } from 'react';
import {
  View, Text, StyleSheet, ScrollView,
  TouchableOpacity, ActivityIndicator,
  Image, Dimensions, Modal, StatusBar
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import axios from 'axios';
import { useTheme } from '../config/ThemeContext';
import { API_BASE } from '../config/config';

const { width: SW, height: SH } = Dimensions.get('window');
const PLOT_W      = SW - 32;
const PLOT_H_CARD = PLOT_W * 0.85;
const PLOT_H_FULL = SH * 0.72;

const PLOTS = [
  {
    key:   'plot_pca',
    title: 'PCA — Class Separation',
    badge: '60.7% variance',
    desc:  'PCA reduces 22 features to 2 dimensions. Pre-stress centroid (★) sits between Normal and Stress confirming it is a genuine intermediate physiological state. PC1+PC2 explain 60.7% of total variance.',
    tab:   'dimensionality',
    accent: '#6366f1',
  },
  {
    key:   'plot_tsne',
    title: 't-SNE — Natural Cluster Structure',
    badge: 'nonlinear',
    desc:  'Nonlinear dimensionality reduction reveals natural clustering. Normal windows form distinct groups. Pre-stress (orange) consistently appears near Stress confirming physiological proximity.',
    tab:   'dimensionality',
    accent: '#06b6d4',
  },
  {
    key:   'plot_radar',
    title: 'Radar Chart — Feature Profiles',
    badge: 'alarm response',
    desc:  'Each axis = one key feature (z-score). Pre-stress polygon (orange) extends beyond Stress on phasic features (MeanHR, SCR_count) confirming the General Adaptation Syndrome alarm phase.',
    tab:   'patterns',
    accent: '#f59e0b',
  },
  {
    key:   'plot_patterns',
    title: 'Pattern Classification',
    badge: '81.8% distinct',
    desc:  '18 of 22 features (81.8%) distinguish pre-stress. 6 show monotonic N<PS<S rise (tonic EDA). 12 show peak at pre-stress then drop (phasic alarm response).',
    tab:   'patterns',
    accent: '#10b981',
  },
  {
    key:   'plot_distributions',
    title: 'Feature Distributions by Class',
    badge: 'boxplots',
    desc:  'Boxplots show feature value distributions per class. Diamond markers show class means. N<PS<S ✓ shows ordinal pattern. Not ordinal shows phasic peak — both are valid pre-stress signatures.',
    tab:   'patterns',
    accent: '#ef4444',
  },
  {
    key:   'plot_subjects',
    title: 'Per-Subject Ordinal Consistency',
    badge: '10/15 subjects',
    desc:  '10 of 15 subjects (66.7%) show N<PS<S ordinal pattern for SCL_mean. Confirms pre-stress is a genuine physiological state across individuals.',
    tab:   'subjects',
    accent: '#8b5cf6',
  },
];

const TABS = [
  { key: 'all',            label: 'All'       },
  { key: 'dimensionality', label: 'PCA/t-SNE' },
  { key: 'patterns',       label: 'Patterns'  },
  { key: 'subjects',       label: 'Subjects'  },
];

export default function ExploratoryScreen() {
  const { isDark, theme, COLORS } = useTheme();
  const [activeTab,  setActiveTab]  = useState('all');
  const [plotStatus, setPlotStatus] = useState({});
  const [checking,   setChecking]   = useState(true);
  const [modalPlot,  setModalPlot]  = useState(null);

  const t = theme;

  useEffect(() => { checkPlots(); }, []);

  const checkPlots = async () => {
    setChecking(true);
    try {
      const res = await axios.get(`${API_BASE}/exploratory/plots/list`);
      const status = {};
      res.data.plots.forEach(p => { status[p.name] = p.available; });
      setPlotStatus(status);
    } catch (e) { console.log('Plot check error:', e.message); }
    setChecking(false);
  };

  const allAvailable = PLOTS.every(p => plotStatus[p.key]);
  const visiblePlots = PLOTS.filter(p =>
    activeTab === 'all' || p.tab === activeTab
  );

  if (checking) {
    return (
      <SafeAreaView style={[eStyles.safe, { backgroundColor: t.bg }]}>
        <View style={eStyles.centered}>
          <ActivityIndicator size="large" color={COLORS.brand} />
          <Text style={[eStyles.loadingText, { color: t.text }]}>
            Checking plots...
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[eStyles.safe, { backgroundColor: t.bg }]}>
      <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} />

      <FullscreenModal
        plot={modalPlot}
        onClose={() => setModalPlot(null)}
        isDark={isDark}
        theme={t}
        COLORS={COLORS}
      />

      <ScrollView
        style={[eStyles.container, { backgroundColor: t.bg }]}
        showsVerticalScrollIndicator={false}
      >
        {/* Header */}
        <View style={eStyles.header}>
          <Text style={[eStyles.title, { color: t.text }]}>
            Exploratory Analysis
          </Text>
          <Text style={[eStyles.subtitle, { color: t.textMuted }]}>
            WESAD · 883 windows · 22 features · 15 subjects
          </Text>
        </View>

        {/* 81.8% banner */}
        <View style={[eStyles.banner, {
          backgroundColor: isDark ? COLORS.brand + '12' : COLORS.brand + '0d',
          borderColor: COLORS.brand + '30',
        }]}>
          <Text style={[eStyles.bannerNumber, { color: COLORS.brand }]}>
            81.8%
          </Text>
          <Text style={[eStyles.bannerLabel, { color: t.text }]}>
            of features distinguish pre-stress
          </Text>
          <Text style={[eStyles.bannerSub, { color: t.textMuted }]}>
            18 / 22 features — two physiological patterns
          </Text>

          {/* Stats row */}
          <View style={eStyles.bannerStats}>
            {[
              { value: '6',     label: 'Monotonic', color: COLORS.normal    },
              { value: '12',    label: 'Phasic',    color: COLORS.prestress },
              { value: '10/15', label: 'Subjects',  color: COLORS.brand     },
              { value: '60.7%', label: 'PCA var',   color: COLORS.hrv       },
            ].map((s, i) => (
              <View key={i} style={eStyles.bannerStat}>
                <Text style={[eStyles.bannerStatVal, { color: s.color }]}>
                  {s.value}
                </Text>
                <Text style={[eStyles.bannerStatLabel, { color: t.textMuted }]}>
                  {s.label}
                </Text>
              </View>
            ))}
          </View>
        </View>

        {/* Warning */}
        {!allAvailable && (
          <View style={[eStyles.warningCard, {
            backgroundColor: COLORS.prestress + '10',
            borderColor: COLORS.prestress + '30',
          }]}>
            <Text style={[eStyles.warningTitle, { color: COLORS.prestress }]}>
              ⚠️ Plots not generated yet
            </Text>
            <Text style={[eStyles.warningText, { color: t.textMuted }]}>
              Run Cell 7 in 07_exploratory_analysis.ipynb first.
            </Text>
            <TouchableOpacity
              style={[eStyles.recheckBtn, {
                backgroundColor: COLORS.prestress + '18',
                borderColor: COLORS.prestress + '40',
              }]}
              onPress={checkPlots}
            >
              <Text style={[eStyles.recheckText, { color: COLORS.prestress }]}>
                Re-check
              </Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Tap hint */}
        {allAvailable && (
          <View style={[eStyles.tapHint, {
            backgroundColor: t.card, borderColor: t.border
          }]}>
            <Text style={[eStyles.tapHintText, { color: t.textMuted }]}>
              🔍  Tap any chart to view fullscreen
            </Text>
          </View>
        )}

        {/* Tabs */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={eStyles.tabRow}
          contentContainerStyle={{ paddingRight: 16 }}
        >
          {TABS.map(tab => (
            <TouchableOpacity
              key={tab.key}
              style={[
                eStyles.tab,
                {
                  backgroundColor: activeTab === tab.key
                    ? COLORS.brand
                    : isDark ? COLORS.brand + '12' : COLORS.brand + '0d',
                  borderColor: activeTab === tab.key
                    ? COLORS.brand
                    : COLORS.brand + '25',
                }
              ]}
              onPress={() => setActiveTab(tab.key)}
            >
              <Text style={[
                eStyles.tabText,
                { color: activeTab === tab.key ? '#fff' : t.textMuted }
              ]}>
                {tab.label}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        {/* Plot cards */}
        {visiblePlots.map(plot => (
          <PlotCard
            key={plot.key}
            plot={plot}
            available={!!plotStatus[plot.key]}
            onExpand={() => setModalPlot(plot)}
            isDark={isDark}
            theme={t}
            COLORS={COLORS}
          />
        ))}

        {/* Research summary */}
        <View style={[eStyles.summaryCard, {
          backgroundColor: t.card, borderColor: COLORS.brand + '28',
        }]}>
          <Text style={[eStyles.summaryTitle, { color: t.text }]}>
            Key Research Findings
          </Text>

          {[
            {
              color: COLORS.normal,
              title: 'Tonic EDA — Monotonic rise (6/22)',
              desc:  'SCL_mean, EDA_mean, EDA quantiles rise continuously N<PS<S reflecting cumulative sympathetic activation',
            },
            {
              color: COLORS.prestress,
              title: 'Phasic alarm — Peak at pre-stress (12/22)',
              desc:  'MeanHR, SCR_count peak at onset then adapt — General Adaptation Syndrome alarm phase (Selye 1956)',
            },
            {
              color: COLORS.brand,
              title: 'Cross-subject consistency (10/15)',
              desc:  'SCL_mean shows N<PS<S in 10 of 15 subjects. Remaining 5 are atypical EDA responders from preprocessing',
            },
          ].map((row, i) => (
            <View key={i} style={eStyles.summaryRow}>
              <View style={[eStyles.summaryDot, { backgroundColor: row.color }]} />
              <View style={{ flex: 1 }}>
                <Text style={[eStyles.summaryRowTitle, { color: row.color }]}>
                  {row.title}
                </Text>
                <Text style={[eStyles.summaryRowDesc, { color: t.textMuted }]}>
                  {row.desc}
                </Text>
              </View>
            </View>
          ))}

          <View style={[eStyles.conclusionBox, {
            backgroundColor: COLORS.normal + '0d',
            borderColor: COLORS.normal + '28',
          }]}>
            <Text style={{ fontSize: 18, marginTop: 2 }}>💡</Text>
            <Text style={[eStyles.conclusionText, { color: t.textSub }]}>
              Low F1-pre-stress (0.286) reflects data quantity
              (29 windows) not absence of physiological pattern.
              81.8% of features confirm pre-stress is genuine.
              Objective 3 IoT data will resolve the limitation.
            </Text>
          </View>
        </View>

        <View style={{ height: 80 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

// ── Fullscreen Modal ──────────────────────────────────────────
function FullscreenModal({ plot, onClose, isDark, theme, COLORS }) {
  const [imageData, setImageData] = useState(null);
  const [loading,   setLoading]   = useState(false);
  const t = theme;

  useEffect(() => {
    if (plot) loadImage();
    else setImageData(null);
  }, [plot]);

  const loadImage = async () => {
    setLoading(true);
    try {
      const res  = await fetch(`${API_BASE}/exploratory/plot/${plot.key}`);
      const blob = await res.blob();
      const b64  = await blobToBase64(blob);
      setImageData(b64);
    } catch (e) { console.log('Modal load error:', e.message); }
    setLoading(false);
  };

  if (!plot) return null;

  return (
    <Modal visible={!!plot} transparent={false} animationType="fade" onRequestClose={onClose}>
      <View style={[mStyles.bg, { backgroundColor: isDark ? '#040d1c' : '#f0f7ff' }]}>
        <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} />

        {/* Header */}
        <View style={[mStyles.header, {
          backgroundColor: isDark ? '#0a1628' : '#ffffff',
          borderBottomColor: isDark ? '#1a3352' : '#dceaf7',
        }]}>
          <View style={{ flex: 1, gap: 6 }}>
            <Text style={[mStyles.title, { color: t.text }]}>{plot.title}</Text>
            {plot.badge && (
              <View style={[mStyles.badge, {
                backgroundColor: plot.accent + '20',
                borderColor: plot.accent + '50',
              }]}>
                <Text style={[mStyles.badgeText, { color: plot.accent }]}>
                  {plot.badge}
                </Text>
              </View>
            )}
          </View>
          <TouchableOpacity
            style={[mStyles.closeBtn, {
              backgroundColor: isDark ? '#162033' : '#f0f7ff',
              borderColor: isDark ? '#1a3352' : '#dceaf7',
            }]}
            onPress={onClose}
          >
            <Text style={[mStyles.closeTxt, { color: t.text }]}>✕</Text>
          </TouchableOpacity>
        </View>

        {/* Image */}
        <View style={[mStyles.imgWrap, {
          backgroundColor: isDark ? '#060d1a' : '#e8f4fd'
        }]}>
          {loading && <ActivityIndicator size="large" color={COLORS.brand} />}
          {!loading && imageData && (
            <Image
              source={{ uri: imageData }}
              style={mStyles.img}
              resizeMode="contain"
            />
          )}
        </View>

        {/* Desc */}
        <ScrollView style={[mStyles.descScroll, {
          backgroundColor: isDark ? '#0a1628' : '#ffffff',
        }]}>
          <Text style={[mStyles.desc, { color: t.textMuted }]}>
            {plot.desc}
          </Text>
        </ScrollView>

        {/* Close bar */}
        <TouchableOpacity
          style={[mStyles.closeBar, { backgroundColor: COLORS.brand }]}
          onPress={onClose}
        >
          <Text style={mStyles.closeBarText}>Close</Text>
        </TouchableOpacity>
      </View>
    </Modal>
  );
}

// ── Plot Card ─────────────────────────────────────────────────
function PlotCard({ plot, available, onExpand, isDark, theme, COLORS }) {
  const [imageData,  setImageData]  = useState(null);
  const [imgLoading, setImgLoading] = useState(false);
  const [error,      setError]      = useState(false);
  const t = theme;

  useEffect(() => { if (available) loadImage(); }, [available]);

  const loadImage = async () => {
    setImgLoading(true); setError(false); setImageData(null);
    try {
      const res = await fetch(`${API_BASE}/exploratory/plot/${plot.key}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const b64  = await blobToBase64(blob);
      setImageData(b64);
    } catch (e) {
      console.log('Plot error:', plot.key, e.message);
      setError(true);
    }
    setImgLoading(false);
  };

  return (
    <View style={[pStyles.card, {
      backgroundColor: t.card, borderColor: t.border
    }]}>
      {/* Header */}
      <View style={pStyles.cardHeader}>
        <View style={pStyles.titleRow}>
          <Text style={[pStyles.cardTitle, { color: t.text }]}>
            {plot.title}
          </Text>
          {plot.badge && (
            <View style={[pStyles.badge, {
              backgroundColor: plot.accent + '18',
              borderColor: plot.accent + '40',
            }]}>
              <Text style={[pStyles.badgeText, { color: plot.accent }]}>
                {plot.badge}
              </Text>
            </View>
          )}
        </View>
        {imageData && (
          <TouchableOpacity
            style={[pStyles.expandBtn, {
              backgroundColor: COLORS.brand + '15',
              borderColor: COLORS.brand + '35',
            }]}
            onPress={onExpand}
          >
            <Text style={[pStyles.expandText, { color: COLORS.brandLight }]}>
              ⛶ Fullscreen
            </Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Plot image area */}
      <TouchableOpacity
        activeOpacity={imageData ? 0.88 : 1}
        onPress={imageData ? onExpand : undefined}
      >
        <View style={[pStyles.plotBox, {
          backgroundColor: isDark ? '#060d1a' : '#e8f4fd',
          borderColor: plot.accent + '20',
        }]}>
          {!available && (
            <View style={pStyles.placeholder}>
              <Text style={{ fontSize: 32 }}>📊</Text>
              <Text style={[pStyles.placeholderText, { color: t.textMuted }]}>
                Run notebook Cell 7 to generate
              </Text>
            </View>
          )}

          {available && imgLoading && (
            <View style={pStyles.loadingBox}>
              <ActivityIndicator color={COLORS.brand} size="large" />
              <Text style={[pStyles.loadingText, { color: t.textMuted }]}>
                Loading {plot.title}...
              </Text>
            </View>
          )}

          {available && !imgLoading && error && (
            <View style={pStyles.errorBox}>
              <Text style={{ fontSize: 28 }}>⚠️</Text>
              <Text style={[pStyles.errorText, { color: COLORS.stress }]}>
                Could not load plot
              </Text>
              <TouchableOpacity
                style={[pStyles.retryBtn, {
                  backgroundColor: COLORS.brand + '15',
                  borderColor: COLORS.brand + '35',
                }]}
                onPress={loadImage}
              >
                <Text style={[pStyles.retryText, { color: COLORS.brandLight }]}>
                  Retry
                </Text>
              </TouchableOpacity>
            </View>
          )}

          {available && !imgLoading && !error && imageData && (
            <Image
              source={{ uri: imageData }}
              style={pStyles.plotImg}
              resizeMode="contain"
            />
          )}

          {imageData && (
            <View style={pStyles.tapOverlay}>
              <Text style={pStyles.tapOverlayText}>Tap to expand</Text>
            </View>
          )}
        </View>
      </TouchableOpacity>

      {/* Accent line */}
      <View style={[pStyles.accentLine, { backgroundColor: plot.accent }]} />

      <Text style={[pStyles.desc, { color: t.textMuted }]}>
        {plot.desc}
      </Text>
    </View>
  );
}

// ── Helper ────────────────────────────────────────────────────
function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result);
    reader.onerror  = reject;
    reader.readAsDataURL(blob);
  });
}

// ── Styles ────────────────────────────────────────────────────
const eStyles = StyleSheet.create({
  safe:             { flex: 1 },
  container:        { flex: 1, padding: 16 },
  centered:         { flex: 1, alignItems: 'center', justifyContent: 'center' },
  loadingText:      { fontSize: 15, marginTop: 16 },
  header:           { paddingTop: 16, marginBottom: 16 },
  title:            { fontSize: 24, fontWeight: '900' },
  subtitle:         { fontSize: 12, marginTop: 4, lineHeight: 18 },
  banner:           { borderRadius: 20, padding: 22, alignItems: 'center', marginBottom: 14, borderWidth: 1 },
  bannerNumber:     { fontSize: 54, fontWeight: '900', letterSpacing: -1 },
  bannerLabel:      { fontSize: 16, fontWeight: '800', marginTop: 4 },
  bannerSub:        { fontSize: 12, marginTop: 4, marginBottom: 18 },
  bannerStats:      { flexDirection: 'row', gap: 16, flexWrap: 'wrap', justifyContent: 'center' },
  bannerStat:       { alignItems: 'center', minWidth: 58 },
  bannerStatVal:    { fontSize: 18, fontWeight: '900' },
  bannerStatLabel:  { fontSize: 10, marginTop: 2, fontWeight: '600' },
  warningCard:      { borderRadius: 16, padding: 16, marginBottom: 14, borderWidth: 1 },
  warningTitle:     { fontWeight: '800', fontSize: 14, marginBottom: 6 },
  warningText:      { fontSize: 13, lineHeight: 18 },
  recheckBtn:       { borderRadius: 10, padding: 10, alignItems: 'center', marginTop: 10, borderWidth: 1 },
  recheckText:      { fontWeight: '700', fontSize: 13 },
  tapHint:          { borderRadius: 12, padding: 11, alignItems: 'center', marginBottom: 12, borderWidth: 1 },
  tapHintText:      { fontSize: 12, fontWeight: '600' },
  tabRow:           { marginBottom: 14 },
  tab:              { paddingHorizontal: 18, paddingVertical: 9, borderRadius: 20, marginRight: 8, borderWidth: 1 },
  tabText:          { fontSize: 13, fontWeight: '700' },
  summaryCard:      { borderRadius: 20, padding: 18, marginBottom: 20, borderWidth: 1 },
  summaryTitle:     { fontSize: 16, fontWeight: '800', marginBottom: 16 },
  summaryRow:       { flexDirection: 'row', marginBottom: 14, alignItems: 'flex-start', gap: 12 },
  summaryDot:       { width: 10, height: 10, borderRadius: 5, marginTop: 4 },
  summaryRowTitle:  { fontWeight: '700', fontSize: 13, marginBottom: 4 },
  summaryRowDesc:   { fontSize: 12, lineHeight: 19 },
  conclusionBox:    { borderRadius: 14, padding: 14, marginTop: 6, borderWidth: 1, flexDirection: 'row', gap: 10 },
  conclusionText:   { fontSize: 12, lineHeight: 19, flex: 1 },
});

const pStyles = StyleSheet.create({
  card:         { borderRadius: 20, padding: 16, marginBottom: 20, borderWidth: 1 },
  cardHeader:   { marginBottom: 10 },
  titleRow:     { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginBottom: 8 },
  cardTitle:    { fontWeight: '800', fontSize: 15, flex: 1 },
  badge:        { borderRadius: 8, paddingHorizontal: 9, paddingVertical: 3, borderWidth: 1 },
  badgeText:    { fontSize: 10, fontWeight: '700' },
  expandBtn:    { alignSelf: 'flex-start', borderRadius: 9, paddingHorizontal: 12, paddingVertical: 6, borderWidth: 1 },
  expandText:   { fontSize: 11, fontWeight: '700' },
  plotBox:      { borderRadius: 14, overflow: 'hidden', minHeight: PLOT_H_CARD, alignItems: 'center', justifyContent: 'center', borderWidth: 1, position: 'relative' },
  placeholder:  { height: PLOT_H_CARD, alignItems: 'center', justifyContent: 'center', gap: 12 },
  placeholderText: { fontSize: 12, fontStyle: 'italic' },
  loadingBox:   { height: PLOT_H_CARD, alignItems: 'center', justifyContent: 'center', gap: 12 },
  loadingText:  { fontSize: 12, marginTop: 6 },
  errorBox:     { height: 140, alignItems: 'center', justifyContent: 'center', gap: 8 },
  errorText:    { fontSize: 13, textAlign: 'center' },
  retryBtn:     { borderRadius: 10, paddingHorizontal: 16, paddingVertical: 8, borderWidth: 1, marginTop: 4 },
  retryText:    { fontWeight: '700', fontSize: 13 },
  plotImg:      { width: PLOT_W - 32, height: PLOT_H_CARD },
  tapOverlay:   { position: 'absolute', bottom: 8, right: 8, backgroundColor: 'rgba(0,0,0,0.55)', borderRadius: 8, paddingHorizontal: 9, paddingVertical: 4 },
  tapOverlayText: { color: 'rgba(255,255,255,0.8)', fontSize: 10, fontWeight: '600' },
  accentLine:   { height: 2, borderRadius: 1, marginTop: 14, marginBottom: 10, opacity: 0.6 },
  desc:         { fontSize: 12, lineHeight: 20 },
});

const mStyles = StyleSheet.create({
  bg:           { flex: 1 },
  header:       { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 16, paddingTop: 48, borderBottomWidth: 1 },
  title:        { fontSize: 16, fontWeight: '800' },
  badge:        { alignSelf: 'flex-start', borderRadius: 8, paddingHorizontal: 9, paddingVertical: 3, borderWidth: 1, marginTop: 5 },
  badgeText:    { fontSize: 11, fontWeight: '700' },
  closeBtn:     { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center', borderWidth: 1, marginLeft: 12 },
  closeTxt:     { fontSize: 16, fontWeight: '700' },
  imgWrap:      { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 8 },
  img:          { width: SW - 16, height: PLOT_H_FULL },
  descScroll:   { maxHeight: 110, paddingHorizontal: 16, paddingTop: 12 },
  desc:         { fontSize: 12, lineHeight: 20, paddingBottom: 12 },
  closeBar:     { padding: 18, alignItems: 'center' },
  closeBarText: { color: '#fff', fontSize: 16, fontWeight: '800' },
});