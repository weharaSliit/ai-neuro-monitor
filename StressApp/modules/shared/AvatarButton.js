import React, { useEffect, useState } from 'react';
import { TouchableOpacity, Image, View, StyleSheet } from 'react-native';
import { ref, onValue, off } from 'firebase/database';
import { db } from '../../firebase';
import Icon, { NAMES } from './Icon';
import { COLORS } from '../physiological/config/theme';

// Header "Profile" button used on every main user-app screen -- shows the
// user's actual set avatar photo (same users/{userId}/avatar_base64 path
// ProfileScreen.js reads/writes) as a small round thumbnail once they've
// set one, instead of always showing the generic person icon regardless.
export default function AvatarButton({ userId, onPress, size = 30 }) {
  const [avatarUri, setAvatarUri] = useState(null);

  useEffect(() => {
    if (!userId) return;
    const avatarRef = ref(db, `users/${userId}/avatar_base64`);
    const handler = onValue(avatarRef, (snap) => setAvatarUri(snap.val() || null));
    return () => off(avatarRef, 'value', handler);
  }, [userId]);

  return (
    <TouchableOpacity onPress={onPress} hitSlop={8}>
      {avatarUri ? (
        <View style={[styles.ring, { width: size + 4, height: size + 4, borderRadius: (size + 4) / 2, borderColor: COLORS.brand }]}>
          <Image source={{ uri: avatarUri }} style={{ width: size, height: size, borderRadius: size / 2 }} />
        </View>
      ) : (
        <Icon name={NAMES.profile} size={size} color={COLORS.brand} />
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  ring: { borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
});
