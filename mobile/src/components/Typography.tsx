import React from 'react';
import { Text, StyleSheet, TextStyle } from 'react-native';

interface TypographyProps {
  children: React.ReactNode;
  variant?: 'h1' | 'h2' | 'h3' | 'body' | 'caption' | 'label';
  color?: string;
  align?: 'left' | 'center' | 'right';
  style?: TextStyle;
}

export const Typography: React.FC<TypographyProps> = ({
  children,
  variant = 'body',
  color,
  align = 'left',
  style,
}) => {
  return (
    <Text
      style={[
        styles.text,
        styles[variant],
        { color: color || styles[variant].color, textAlign: align },
        style,
      ]}
    >
      {children}
    </Text>
  );
};

const styles = StyleSheet.create({
  text: {
    color: '#ffffff',
  },
  h1: {
    fontSize: 32,
    fontWeight: 'bold',
    letterSpacing: 2,
    color: '#ffffff',
  },
  h2: {
    fontSize: 24,
    fontWeight: 'bold',
    letterSpacing: 1,
    color: '#ffffff',
  },
  h3: {
    fontSize: 18,
    fontWeight: '600',
    letterSpacing: 0.5,
    color: '#ffffff',
  },
  body: {
    fontSize: 16,
    fontWeight: '400',
    color: '#cccccc',
    lineHeight: 24,
  },
  caption: {
    fontSize: 14,
    fontWeight: '400',
    color: '#888888',
    lineHeight: 20,
  },
  label: {
    fontSize: 12,
    fontWeight: '600',
    color: '#888888',
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
});
