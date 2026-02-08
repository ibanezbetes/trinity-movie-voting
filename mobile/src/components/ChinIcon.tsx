import React from 'react';
import { Image, StyleSheet, View } from 'react-native';

interface ChinIconProps {
  size?: number;
  color?: string;
}

/**
 * ChinIcon - Icono personalizado para Matches
 * Usa la imagen iconoChin.png de los assets
 * 
 * Nota: Si la imagen PNG es monocromática (blanco/negro), 
 * el color se aplicará como tintColor.
 */
export const ChinIcon: React.FC<ChinIconProps> = ({ 
  size = 24, 
  color
}) => {
  return (
    <View style={[styles.container, { width: size, height: size }]}>
      <Image
        source={require('../../assets/iconoChin.png')}
        style={{ 
          width: size, 
          height: size,
          tintColor: color // Aplica color si la imagen es monocromática
        }}
        resizeMode="contain"
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
  },
});
