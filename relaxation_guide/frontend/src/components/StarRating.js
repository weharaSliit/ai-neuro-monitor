import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';

export const StarRating = ({ rating, onRate }) => {
  const stars = [1, 2, 3, 4, 5];

  return (
    <View style={styles.container}>
      {stars.map((star) => (
        <TouchableOpacity
          key={star}
          onPress={() => onRate(star)}
          style={styles.starBtn}
        >
          <Text style={[styles.starIcon, star <= rating ? styles.starFilled : styles.starEmpty]}>
            ★
          </Text>
        </TouchableOpacity>
      ))}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    marginVertical: 12,
    gap: 12
  },
  starBtn: {
    padding: 6
  },
  starIcon: {
    fontSize: 36
  },
  starFilled: {
    color: '#F59E0B' // Gold star
  },
  starEmpty: {
    color: '#334155' // Dark slate star
  }
});
