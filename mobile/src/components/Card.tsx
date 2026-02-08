import React from 'react';
import { View, StyleSheet, ViewStyle, TouchableOpacity } from 'react-native';

interface CardProps {
  children: React.ReactNode;
  style?: ViewStyle;
  variant?: 'default' | 'elevated' | 'outlined';
  onPress?: () => void;
}

export const Card: React.FC<CardProps> = ({ children, style, variant = 'default', onPress }) => {
  if (onPress) {
    return (
      <TouchableOpacity
        style={[styles.card, styles[`card_${variant}`], style]}
        onPress={onPress}
        activeOpacity={0.7}
      >
        {children}
      </TouchableOpacity>
    );
  }

  return (
    <View style={[styles.card, styles[`card_${variant}`], style]}>
      {children}
    </View>
  );
};

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#2a2a2a',
    borderRadius: 16,
    padding: 20,
  },
  card_default: {
    borderWidth: 1,
    borderColor: '#3a3a3a',
  },
  card_elevated: {
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 4,
    },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
  },
  card_outlined: {
    borderWidth: 2,
    borderColor: '#7c3aed',
  },
});
