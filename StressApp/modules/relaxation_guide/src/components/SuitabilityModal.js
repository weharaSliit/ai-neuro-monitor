import React, { useContext } from 'react';
import { View, Text, StyleSheet, Modal, TouchableOpacity } from 'react-native';
import { ThemeContext } from '../context/ThemeContext';

export const SuitabilityModal = ({ visible, data, onProceed, onSwitch }) => {
  const { theme } = useContext(ThemeContext);

  if (!visible || !data) return null;

  return (
    <Modal animationType="slide" transparent visible={visible}>
      <View style={styles.overlay}>
        <View style={[styles.modalCard, { backgroundColor: theme.bgSecondary, borderColor: theme.warning }]}>
          <Text style={styles.iconHeader}>⚠️ 🩺</Text>
          <Text style={[styles.title, { color: theme.warning }]}>{data.warning_title || 'Suitability Warning'}</Text>
          <Text style={[styles.message, { color: theme.textSecondary }]}>
            {data.warning_message}
          </Text>

          <View style={[styles.recBox, { backgroundColor: theme.bgPrimary }]}>
            <Text style={[styles.recLabel, { color: theme.accent }]}>Optimal Algorithm Recommendation:</Text>
            <Text style={[styles.recTitle, { color: theme.textPrimary }]}>{data.recommended_title}</Text>
          </View>

          <TouchableOpacity
            style={[styles.switchBtn, { backgroundColor: theme.accent }]}
            onPress={onSwitch}
          >
            <Text style={[styles.switchTxt, { color: theme.accentText }]}>
              ✨ Switch to Recommended ({data.recommended_title})
            </Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.proceedBtn} onPress={onProceed}>
            <Text style={[styles.proceedTxt, { color: theme.textMuted }]}>Proceed Anyway</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.75)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20
  },
  modalCard: {
    width: '100%',
    borderRadius: 20,
    padding: 22,
    alignItems: 'center',
    borderWidth: 2
  },
  iconHeader: {
    fontSize: 40,
    marginBottom: 6
  },
  title: {
    fontSize: 18,
    fontWeight: '800',
    textAlign: 'center',
    marginBottom: 8
  },
  message: {
    fontSize: 12,
    textAlign: 'center',
    lineHeight: 18,
    marginBottom: 16
  },
  recBox: {
    padding: 12,
    borderRadius: 12,
    width: '100%',
    alignItems: 'center',
    marginBottom: 16
  },
  recLabel: {
    fontSize: 11,
    fontWeight: '700'
  },
  recTitle: {
    fontSize: 16,
    fontWeight: '900',
    marginTop: 2
  },
  switchBtn: {
    width: '100%',
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
    marginBottom: 8
  },
  switchTxt: {
    fontWeight: '800',
    fontSize: 14
  },
  proceedBtn: {
    paddingVertical: 8
  },
  proceedTxt: {
    fontSize: 12,
    textDecorationLine: 'underline'
  }
});
