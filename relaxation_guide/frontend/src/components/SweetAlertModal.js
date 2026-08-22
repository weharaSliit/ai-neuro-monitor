import React, { useEffect, useState } from 'react';
import {
  Modal,
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Animated,
  Platform
} from 'react-native';

export const SweetAlertModal = ({
  visible,
  onClose,
  title,
  text,
  icon = 'info', // 'success' | 'error' | 'warning' | 'info' | 'question' | 'celebration'
  confirmButtonText = 'OK',
  showCancelButton = false,
  cancelButtonText = 'Cancel',
  onConfirm,
  onCancel,
  timer = 0
}) => {
  const [scaleAnim] = useState(new Animated.Value(0.7));
  const [opacityAnim] = useState(new Animated.Value(0));

  useEffect(() => {
    if (visible) {
      Animated.parallel([
        Animated.spring(scaleAnim, {
          toValue: 1,
          friction: 6,
          tension: 80,
          useNativeDriver: true
        }),
        Animated.timing(opacityAnim, {
          toValue: 1,
          duration: 200,
          useNativeDriver: true
        })
      ]).start();

      if (timer > 0) {
        const timeout = setTimeout(() => {
          handleClose();
        }, timer);
        return () => clearTimeout(timeout);
      }
    } else {
      scaleAnim.setValue(0.7);
      opacityAnim.setValue(0);
    }
  }, [visible]);

  const handleClose = () => {
    Animated.parallel([
      Animated.timing(scaleAnim, {
        toValue: 0.8,
        duration: 150,
        useNativeDriver: true
      }),
      Animated.timing(opacityAnim, {
        toValue: 0,
        duration: 150,
        useNativeDriver: true
      })
    ]).start(() => {
      onClose();
    });
  };

  const handleConfirm = () => {
    handleClose();
    if (onConfirm) onConfirm();
  };

  const handleCancel = () => {
    handleClose();
    if (onCancel) onCancel();
  };

  if (!visible) return null;

  const getIconData = () => {
    switch (icon) {
      case 'success':
        return { emoji: '✔️', color: '#10B981', bg: 'rgba(16, 185, 129, 0.15)', border: '#10B981' };
      case 'error':
        return { emoji: '❌', color: '#EF4444', bg: 'rgba(239, 68, 68, 0.15)', border: '#EF4444' };
      case 'warning':
        return { emoji: '⚠️', color: '#F59E0B', bg: 'rgba(245, 158, 11, 0.15)', border: '#F59E0B' };
      case 'question':
        return { emoji: '❓', color: '#A855F7', bg: 'rgba(168, 85, 247, 0.15)', border: '#A855F7' };
      case 'celebration':
        return { emoji: '🎉', color: '#F59E0B', bg: 'rgba(245, 158, 11, 0.2)', border: '#F59E0B' };
      case 'info':
      default:
        return { emoji: 'ℹ️', color: '#38BDF8', bg: 'rgba(56, 189, 248, 0.15)', border: '#38BDF8' };
    }
  };

  const iconInfo = getIconData();

  return (
    <Modal transparent visible={visible} animationType="none" onRequestClose={handleClose}>
      <View style={styles.overlay}>
        <Animated.View
          style={[
            styles.container,
            {
              opacity: opacityAnim,
              transform: [{ scale: scaleAnim }]
            }
          ]}
        >
          {/* SweetAlert2 Animated Icon Badge */}
          <View style={[styles.iconContainer, { backgroundColor: iconInfo.bg, borderColor: iconInfo.border }]}>
            <Text style={styles.iconEmoji}>{iconInfo.emoji}</Text>
          </View>

          {/* Title */}
          {title ? <Text style={styles.title}>{title}</Text> : null}

          {/* Body Text */}
          {text ? <Text style={styles.text}>{text}</Text> : null}

          {/* Action Buttons */}
          <View style={styles.btnRow}>
            {showCancelButton && (
              <TouchableOpacity
                style={[styles.btn, styles.cancelBtn]}
                onPress={handleCancel}
                activeOpacity={0.8}
              >
                <Text style={styles.cancelBtnText}>{cancelButtonText}</Text>
              </TouchableOpacity>
            )}

            <TouchableOpacity
              style={[styles.btn, styles.confirmBtn, { backgroundColor: iconInfo.border }]}
              onPress={handleConfirm}
              activeOpacity={0.8}
            >
              <Text style={styles.confirmBtnText}>{confirmButtonText}</Text>
            </TouchableOpacity>
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.75)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24
  },
  container: {
    width: '100%',
    maxWidth: 380,
    backgroundColor: '#1E293B',
    borderRadius: 24,
    padding: 24,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#334155',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.4,
    shadowRadius: 16,
    elevation: 20
  },
  iconContainer: {
    width: 72,
    height: 72,
    borderRadius: 36,
    borderWidth: 3,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16
  },
  iconEmoji: {
    fontSize: 32
  },
  title: {
    fontSize: 20,
    fontWeight: '800',
    color: '#F8FAFC',
    textAlign: 'center',
    marginBottom: 8
  },
  text: {
    fontSize: 14,
    color: '#94A3B8',
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 20
  },
  btnRow: {
    flexDirection: 'row',
    gap: 12,
    width: '100%',
    justifyContent: 'center'
  },
  btn: {
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 12,
    minWidth: 100,
    alignItems: 'center',
    justifyContent: 'center'
  },
  confirmBtn: {
    flex: 1
  },
  confirmBtnText: {
    color: '#FFFFFF',
    fontWeight: '800',
    fontSize: 14
  },
  cancelBtn: {
    flex: 1,
    backgroundColor: '#334155'
  },
  cancelBtnText: {
    color: '#94A3B8',
    fontWeight: '700',
    fontSize: 14
  }
});
