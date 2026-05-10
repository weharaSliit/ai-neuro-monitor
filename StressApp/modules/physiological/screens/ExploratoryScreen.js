import React, { useState, useEffect } from 'react';
import {
  View, Text, StyleSheet, ScrollView,
  TouchableOpacity, ActivityIndicator,
  Image, Dimensions, Modal, StatusBar,
  TouchableWithoutFeedback
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import axios from 'axios';
import { API_BASE } from '../config/config';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } =
  Dimensions.get('window');

const PLOT_WIDTH        = SCREEN_WIDTH - 32;
const PLOT_HEIGHT_CARD  = PLOT_WIDTH * 0.85;  // taller in card
const PLOT_HEIGHT_MODAL = SCREEN_HEIGHT * 0.75; // fullscreen

const COLORS = {
  normal:    '#22c55e',
  prestress: '#f59e0b',
  stress:    '#ef4444',
  purple:    '#6366f1',
  card:      '#1e293b',
  bg:        '#0f172a',
  text:      '#f1f5f9',
  muted:     '#64748b',
};

const PLOTS = [
  {
    key:   'plot_pca',
    title: 'PCA — Class Separation',
    badge: '60.7% variance',
    desc:  'PCA reduces 22 features to 2 dimensions. Pre-stress centroid (★) sits between Normal and Stress confirming it is a genuine intermediate physiological state. PC1+PC2 explain 60.7% of total variance.',
    tab:   'dimensionality',
    color: COLORS.purple,
  },
  {
    key:   'plot_tsne',
    title: 't-SNE — Natural Cluster Structure',
    badge: 'nonlinear',
    desc:  'Nonlinear dimensionality reduction reveals natural clustering. Normal windows (green) form distinct regions. Pre-stress (orange) consistently appears near Stress (red) confirming physiological proximity.',
    tab:   'dimensionality',
    color: COLORS.prestress,
  },
  {
    key:   'plot_radar',
    title: 'Radar Chart — Feature Profiles',
    badge: 'alarm response',
    desc:  'Each axis = one key feature (z-score). Pre-stress polygon (orange) extends beyond Stress on phasic features (MeanHR, SCR_count) confirming the General Adaptation Syndrome alarm phase.',
    tab:   'patterns',
    color: COLORS.prestress,
  },
  {
    key:   'plot_patterns',
    title: 'Pattern Classification',
    badge: '81.8% distinct',
    desc:  '18 of 22 features (81.8%) distinguish pre-stress. 6 show monotonic N<PS<S rise (tonic EDA). 12 show peak at pre-stress then drop (phasic alarm response). Low F1 reflects data quantity not pattern absence.',
    tab:   'patterns',
    color: COLORS.normal,
  },
  {
    key:   'plot_distributions',
    title: 'Feature Distributions by Class',
    badge: 'boxplots',
    desc:  'Boxplots show feature value distributions per class. Diamond markers show class means. N<PS<S ✓ shows ordinal pattern. Not ordinal shows phasic peak — both are valid pre-stress physiological signatures.',
    tab:   'patterns',
    color: COLORS.stress,
  },
  {
    key:   'plot_subjects',
    title: 'Per-Subject Ordinal Consistency',
    badge: '10/15 subjects',
    desc:  '10 of 15 subjects (66.7%) show N<PS<S ordinal pattern for SCL_mean. ✓ = consistent. ✗ = atypical EDA responders identified during preprocessing. Confirms pre-stress is genuine across individuals.',
    tab:   'subjects',
    color: COLORS.purple,
  },
];

const TABS = [
  { key: 'all',            label: 'All Plots'  },
  { key: 'dimensionality', label: 'PCA/t-SNE'  },
  { key: 'patterns',       label: 'Patterns'   },
  { key: 'subjects',       label: 'Subjects'   },
];

export default function ExploratoryScreen() {
  const [activeTab,  setActiveTab]  = useState('all');
  const [plotStatus, setPlotStatus] = useState({});
  const [checking,   setChecking]   = useState(true);
  const [modalPlot,  setModalPlot]  = useState(null);

  useEffect(() => { checkPlots(); }, []);

  const checkPlots = async () => {
    setChecking(true);
    try {
      const res = await axios.get(
        `${API_BASE}/exploratory/plots/list`
      );
      const status = {};
      res.data.plots.forEach(p => {
        status[p.name] = p.available;
      });
      setPlotStatus(status);
    } catch (e) {
      console.log('Plot check error:', e.message);
    }
    setChecking(false);
  };

  const allAvailable = PLOTS.every(p => plotStatus[p.key]);
  const visiblePlots = PLOTS.filter(p =>
    activeTab === 'all' || p.tab === activeTab
  );

  if (checking) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.centered}>
          <ActivityIndicator
            size="large" color={COLORS.purple}
          />
          <Text style={styles.loadingText}>
            Checking plots...
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar barStyle="light-content" />

      {/* Fullscreen modal */}
      <FullscreenModal
        plot={modalPlot}
        onClose={() => setModalPlot(null)}
      />

      <ScrollView
        style={styles.container}
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.title}>
          Exploratory Analysis
        </Text>
        <Text style={styles.subtitle}>
          WESAD dataset · 883 windows ·
          22 features · 15 subjects
        </Text>

        {/* Key finding */}
        <View style={styles.findingBanner}>
          <Text style={styles.findingNumber}>81.8%</Text>
          <Text style={styles.findingText}>
            of features distinguish pre-stress
          </Text>
          <Text style={styles.findingSub}>
            18 / 22 features — two physiological patterns
          </Text>
          <View style={styles.findingStats}>
            <FindingStat
              value="6"  label="Monotonic"
              color={COLORS.normal}
            />
            <FindingStat
              value="12" label="Phasic peak"
              color={COLORS.prestress}
            />
            <FindingStat
              value="10/15" label="Subjects"
              color={COLORS.purple}
            />
            <FindingStat
              value="60.7%" label="PCA var"
              color={COLORS.stress}
            />
          </View>
        </View>

        {/* Warning */}
        {!allAvailable && (
          <View style={styles.warningCard}>
            <Text style={styles.warningTitle}>
              ⚠️  Plots not generated yet
            </Text>
            <Text style={styles.warningText}>
              Run Cell 7 in
              07_exploratory_analysis.ipynb first.
            </Text>
            <TouchableOpacity
              style={styles.recheckBtn}
              onPress={checkPlots}
            >
              <Text style={styles.recheckBtnText}>
                Re-check
              </Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Hint */}
        {allAvailable && (
          <View style={styles.tapHint}>
            <Text style={styles.tapHintText}>
              🔍  Tap any chart to view fullscreen
            </Text>
          </View>
        )}

        {/* Tabs */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.tabScroll}
          contentContainerStyle={styles.tabContent}
        >
          {TABS.map(tab => (
            <TouchableOpacity
              key={tab.key}
              style={[
                styles.tab,
                activeTab === tab.key && styles.tabActive
              ]}
              onPress={() => setActiveTab(tab.key)}
            >
              <Text style={[
                styles.tabText,
                activeTab === tab.key &&
                  styles.tabTextActive
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
          />
        ))}

        {/* Summary */}
        <View style={[styles.card, styles.summaryCard]}>
          <Text style={styles.summaryTitle}>
            Key Research Findings
          </Text>
          <SummaryRow
            color={COLORS.normal}
            title="Tonic EDA — Monotonic rise (6/22)"
            desc="SCL_mean, EDA_mean, EDA quantiles rise continuously N<PS<S reflecting cumulative sympathetic activation"
          />
          <SummaryRow
            color={COLORS.prestress}
            title="Phasic alarm — Peak at pre-stress (12/22)"
            desc="MeanHR, SCR_count peak at onset then adapt. Consistent with General Adaptation Syndrome alarm phase (Selye 1956)"
          />
          <SummaryRow
            color={COLORS.purple}
            title="Cross-subject — 10/15 subjects (66.7%)"
            desc="SCL_mean shows N<PS<S in 10 subjects. Remaining 5 are atypical EDA responders identified in preprocessing"
          />
          <View style={styles.conclusionBox}>
            <Text style={styles.conclusionEmoji}>💡</Text>
            <Text style={styles.conclusionText}>
              Low F1-pre-stress (0.286) reflects data
              quantity (29 windows) not the absence of
              a physiological pattern. 81.8% of features
              confirm pre-stress is a genuine intermediate
              state. Objective 3 IoT data will resolve the
              data quantity limitation.
            </Text>
          </View>
        </View>

        <View style={{ height: 80 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

// ── Fullscreen Modal ──────────────────────────────────────────
function FullscreenModal({ plot, onClose }) {
  const [imageData,  setImageData]  = useState(null);
  const [loading,    setLoading]    = useState(false);

  useEffect(() => {
    if (plot) loadImage();
    else setImageData(null);
  }, [plot]);

  const loadImage = async () => {
    setLoading(true);
    try {
      const response = await fetch(
        `${API_BASE}/exploratory/plot/${plot.key}`
      );
      const blob   = await response.blob();
      const base64 = await blobToBase64(blob);
      setImageData(base64);
    } catch (e) {
      console.log('Modal image error:', e.message);
    }
    setLoading(false);
  };

  if (!plot) return null;

  return (
    <Modal
      visible={!!plot}
      transparent={false}
      animationType="fade"
      onRequestClose={onClose}
    >
      <View style={styles.modalBg}>
        <StatusBar barStyle="light-content" />

        {/* Header */}
        <View style={styles.modalHeader}>
          <View style={styles.modalTitleArea}>
            <Text style={styles.modalTitle}>
              {plot.title}
            </Text>
            {plot.badge && (
              <View style={[styles.modalBadge,
                { backgroundColor: plot.color + '33',
                  borderColor: plot.color }]}>
                <Text style={[styles.modalBadgeText,
                  { color: plot.color }]}>
                  {plot.badge}
                </Text>
              </View>
            )}
          </View>
          <TouchableOpacity
            style={styles.closeBtn}
            onPress={onClose}
          >
            <Text style={styles.closeBtnText}>✕</Text>
          </TouchableOpacity>
        </View>

        {/* Full size image */}
        <View style={styles.modalImageContainer}>
          {loading && (
            <ActivityIndicator
              size="large" color={COLORS.purple}
            />
          )}
          {!loading && imageData && (
            <Image
              source={{ uri: imageData }}
              style={styles.modalImage}
              resizeMode="contain"
            />
          )}
        </View>

        {/* Description */}
        <ScrollView style={styles.modalDescScroll}>
          <Text style={styles.modalDesc}>
            {plot.desc}
          </Text>
        </ScrollView>

        {/* Close button */}
        <TouchableOpacity
          style={styles.modalCloseBar}
          onPress={onClose}
        >
          <Text style={styles.modalCloseBarText}>
            Close
          </Text>
        </TouchableOpacity>
      </View>
    </Modal>
  );
}

// ── Plot Card ─────────────────────────────────────────────────
function PlotCard({ plot, available, onExpand }) {
  const [imageData,  setImageData]  = useState(null);
  const [imgLoading, setImgLoading] = useState(false);
  const [error,      setError]      = useState(false);

  useEffect(() => {
    if (available) loadImage();
  }, [available]);

  const loadImage = async () => {
    setImgLoading(true);
    setError(false);
    setImageData(null);
    try {
      const response = await fetch(
        `${API_BASE}/exploratory/plot/${plot.key}`
      );
      if (!response.ok)
        throw new Error(`HTTP ${response.status}`);
      const blob   = await response.blob();
      const base64 = await blobToBase64(blob);
      setImageData(base64);
    } catch (e) {
      console.log('Plot error:', plot.key, e.message);
      setError(true);
    }
    setImgLoading(false);
  };

  return (
    <View style={styles.card}>

      {/* Card header */}
      <View style={styles.cardHeader}>
        <View style={styles.cardTitleRow}>
          <Text style={styles.cardTitle}>
            {plot.title}
          </Text>
          {plot.badge && (
            <View style={[styles.badge, {
              backgroundColor: plot.color + '22',
              borderColor:     plot.color
            }]}>
              <Text style={[styles.badgeText,
                { color: plot.color }]}>
                {plot.badge}
              </Text>
            </View>
          )}
        </View>

        {/* Expand button */}
        {imageData && (
          <TouchableOpacity
            style={styles.expandBtn}
            onPress={onExpand}
          >
            <Text style={styles.expandBtnText}>
              ⛶ Fullscreen
            </Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Plot area */}
      <TouchableOpacity
        activeOpacity={imageData ? 0.85 : 1}
        onPress={imageData ? onExpand : undefined}
      >
        <View style={styles.plotContainer}>

          {!available && (
            <View style={styles.plotNotReady}>
              <Text style={styles.plotNotReadyEmoji}>
                📊
              </Text>
              <Text style={styles.plotNotReadyText}>
                Run notebook Cell 7 to generate
              </Text>
            </View>
          )}

          {available && imgLoading && (
            <View style={styles.plotLoading}>
              <ActivityIndicator
                color={COLORS.purple} size="large"
              />
              <Text style={styles.plotLoadingText}>
                Loading {plot.title}...
              </Text>
            </View>
          )}

          {available && !imgLoading && error && (
            <View style={styles.plotError}>
              <Text style={styles.plotErrorEmoji}>
                ⚠️
              </Text>
              <Text style={styles.plotErrorText}>
                Could not load plot
              </Text>
              <TouchableOpacity
                style={styles.retryBtn}
                onPress={loadImage}
              >
                <Text style={styles.retryBtnText}>
                  Retry
                </Text>
              </TouchableOpacity>
            </View>
          )}

          {available && !imgLoading && !error &&
            imageData && (
            <Image
              source={{ uri: imageData }}
              style={styles.plotImage}
              resizeMode="contain"
            />
          )}

          {/* Tap to expand hint overlay */}
          {imageData && (
            <View style={styles.tapOverlay}>
              <Text style={styles.tapOverlayText}>
                Tap to expand
              </Text>
            </View>
          )}
        </View>
      </TouchableOpacity>

      <Text style={styles.plotDesc}>{plot.desc}</Text>
    </View>
  );
}

// ── Helpers ───────────────────────────────────────────────────
function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result);
    reader.onerror  = reject;
    reader.readAsDataURL(blob);
  });
}

function FindingStat({ value, label, color }) {
  return (
    <View style={styles.findingStat}>
      <Text style={[styles.findingStatValue, { color }]}>
        {value}
      </Text>
      <Text style={styles.findingStatLabel}>{label}</Text>
    </View>
  );
}

function SummaryRow({ color, title, desc }) {
  return (
    <View style={styles.summaryRow}>
      <View style={[styles.summaryDot,
        { backgroundColor: color }]} />
      <View style={styles.summaryContent}>
        <Text style={[styles.summaryRowTitle, { color }]}>
          {title}
        </Text>
        <Text style={styles.summaryRowDesc}>{desc}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  safe:                { flex: 1, backgroundColor: COLORS.bg },
  container:           { flex: 1, backgroundColor: COLORS.bg, padding: 16 },
  centered:            { flex: 1, backgroundColor: COLORS.bg, alignItems: 'center', justifyContent: 'center' },
  loadingText:         { color: COLORS.text, fontSize: 15, marginTop: 16 },

  title:               { fontSize: 22, fontWeight: 'bold', color: COLORS.text, marginTop: 16 },
  subtitle:            { fontSize: 12, color: COLORS.muted, marginTop: 4, marginBottom: 14, lineHeight: 18 },

  findingBanner:       { backgroundColor: '#1e1b4b', borderRadius: 16, padding: 20, alignItems: 'center', marginBottom: 14, borderWidth: 1, borderColor: COLORS.purple },
  findingNumber:       { fontSize: 52, fontWeight: 'bold', color: COLORS.purple },
  findingText:         { color: COLORS.text, fontSize: 16, fontWeight: '700', marginTop: 4 },
  findingSub:          { color: COLORS.muted, fontSize: 12, marginTop: 4, marginBottom: 16 },
  findingStats:        { flexDirection: 'row', gap: 12, flexWrap: 'wrap', justifyContent: 'center' },
  findingStat:         { alignItems: 'center', minWidth: 60 },
  findingStatValue:    { fontSize: 18, fontWeight: 'bold' },
  findingStatLabel:    { color: COLORS.muted, fontSize: 10, marginTop: 2 },

  warningCard:         { backgroundColor: '#1a0f00', borderRadius: 12, padding: 16, marginBottom: 14, borderWidth: 1, borderColor: COLORS.prestress },
  warningTitle:        { color: COLORS.prestress, fontWeight: '700', fontSize: 14, marginBottom: 6 },
  warningText:         { color: COLORS.muted, fontSize: 13, lineHeight: 18 },
  recheckBtn:          { backgroundColor: COLORS.prestress + '33', borderRadius: 8, padding: 10, alignItems: 'center', marginTop: 10, borderWidth: 1, borderColor: COLORS.prestress },
  recheckBtnText:      { color: COLORS.prestress, fontWeight: '600', fontSize: 13 },

  tapHint:             { backgroundColor: '#1e293b', borderRadius: 10, padding: 10, alignItems: 'center', marginBottom: 12 },
  tapHintText:         { color: COLORS.muted, fontSize: 12 },

  tabScroll:           { marginBottom: 14 },
  tabContent:          { paddingRight: 16 },
  tab:                 { paddingHorizontal: 18, paddingVertical: 9, borderRadius: 20, backgroundColor: COLORS.card, marginRight: 8 },
  tabActive:           { backgroundColor: COLORS.purple },
  tabText:             { color: COLORS.muted, fontSize: 13, fontWeight: '600' },
  tabTextActive:       { color: '#fff' },

  card:                { backgroundColor: COLORS.card, borderRadius: 16, padding: 16, marginBottom: 20 },
  cardHeader:          { marginBottom: 12 },
  cardTitleRow:        { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginBottom: 6 },
  cardTitle:           { color: COLORS.text, fontWeight: '700', fontSize: 15, flex: 1 },
  badge:               { borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3, borderWidth: 1 },
  badgeText:           { fontSize: 10, fontWeight: '700' },
  expandBtn:           { alignSelf: 'flex-start', backgroundColor: COLORS.purple + '22', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 6, borderWidth: 1, borderColor: COLORS.purple },
  expandBtnText:       { color: COLORS.purple, fontSize: 11, fontWeight: '600' },

  plotContainer:       { borderRadius: 12, overflow: 'hidden', backgroundColor: '#080f1a', minHeight: PLOT_HEIGHT_CARD, alignItems: 'center', justifyContent: 'center', position: 'relative' },
  plotLoading:         { height: PLOT_HEIGHT_CARD, alignItems: 'center', justifyContent: 'center', gap: 12 },
  plotLoadingText:     { color: COLORS.muted, fontSize: 12, marginTop: 8 },
  plotImage:           { width: PLOT_WIDTH - 32, height: PLOT_HEIGHT_CARD },
  plotError:           { height: 140, alignItems: 'center', justifyContent: 'center', gap: 8 },
  plotErrorEmoji:      { fontSize: 32 },
  plotErrorText:       { color: COLORS.stress, fontSize: 13, textAlign: 'center' },
  retryBtn:            { backgroundColor: COLORS.card, borderRadius: 8, paddingHorizontal: 16, paddingVertical: 8, borderWidth: 1, borderColor: COLORS.purple, marginTop: 4 },
  retryBtnText:        { color: COLORS.purple, fontWeight: '600', fontSize: 13 },
  plotNotReady:        { height: 100, alignItems: 'center', justifyContent: 'center', gap: 8 },
  plotNotReadyEmoji:   { fontSize: 32 },
  plotNotReadyText:    { color: COLORS.muted, fontSize: 12, fontStyle: 'italic' },
  tapOverlay:          { position: 'absolute', bottom: 8, right: 8, backgroundColor: 'rgba(0,0,0,0.6)', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 4 },
  tapOverlayText:      { color: 'rgba(255,255,255,0.7)', fontSize: 10 },

  plotDesc:            { color: COLORS.muted, fontSize: 12, marginTop: 12, lineHeight: 20 },

  // Modal
  modalBg:             { flex: 1, backgroundColor: '#000' },
  modalHeader:         { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 16, paddingTop: 48, backgroundColor: COLORS.bg },
  modalTitleArea:      { flex: 1, gap: 6 },
  modalTitle:          { color: COLORS.text, fontSize: 16, fontWeight: '700' },
  modalBadge:          { alignSelf: 'flex-start', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3, borderWidth: 1 },
  modalBadgeText:      { fontSize: 11, fontWeight: '700' },
  closeBtn:            { width: 36, height: 36, borderRadius: 18, backgroundColor: COLORS.card, alignItems: 'center', justifyContent: 'center', marginLeft: 12 },
  closeBtnText:        { color: COLORS.text, fontSize: 16, fontWeight: '700' },
  modalImageContainer: { flex: 1, backgroundColor: '#080f1a', alignItems: 'center', justifyContent: 'center', padding: 8 },
  modalImage:          { width: SCREEN_WIDTH - 16, height: PLOT_HEIGHT_MODAL },
  modalDescScroll:     { maxHeight: 100, backgroundColor: COLORS.bg, paddingHorizontal: 16, paddingTop: 10 },
  modalDesc:           { color: COLORS.muted, fontSize: 12, lineHeight: 19 },
  modalCloseBar:       { backgroundColor: COLORS.purple, padding: 16, alignItems: 'center', marginBottom: 0 },
  modalCloseBarText:   { color: '#fff', fontSize: 16, fontWeight: '700' },

  // Summary
  summaryCard:         { borderWidth: 1, borderColor: COLORS.purple },
  summaryTitle:        { color: COLORS.text, fontWeight: '700', fontSize: 15, marginBottom: 16 },
  summaryRow:          { flexDirection: 'row', marginBottom: 14, alignItems: 'flex-start' },
  summaryDot:          { width: 10, height: 10, borderRadius: 5, marginTop: 4, marginRight: 12 },
  summaryContent:      { flex: 1 },
  summaryRowTitle:     { fontWeight: '700', fontSize: 13, marginBottom: 4 },
  summaryRowDesc:      { color: COLORS.muted, fontSize: 12, lineHeight: 19 },
  conclusionBox:       { backgroundColor: '#0c2218', borderRadius: 12, padding: 14, marginTop: 8, borderWidth: 1, borderColor: COLORS.normal, flexDirection: 'row', gap: 10 },
  conclusionEmoji:     { fontSize: 20, marginTop: 2 },
  conclusionText:      { color: '#94a3b8', fontSize: 12, lineHeight: 19, flex: 1 },
});