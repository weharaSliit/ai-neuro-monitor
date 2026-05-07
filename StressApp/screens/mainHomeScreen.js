import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';

export default function MainHomeScreen({ navigation }) {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Main Application</Text>

      <TouchableOpacity
        style={styles.button}
        onPress={() => navigation.navigate('Physiological')}
      >
        <Text style={styles.buttonText}>
          🧠 Proceed to Physiological Component
        </Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0f172a',
    justifyContent: 'center',
    alignItems: 'center',
  },
  title: {
    color: '#f1f5f9',
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 30,
  },
  button: {
    backgroundColor: '#6366f1',
    padding: 18,
    borderRadius: 12,
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
});