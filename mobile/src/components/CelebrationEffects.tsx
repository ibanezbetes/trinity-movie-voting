import React, { useEffect, useRef } from 'react';
import { View, StyleSheet, Animated, Dimensions } from 'react-native';

const { width, height } = Dimensions.get('window');

interface ConfettiPiece {
  id: number;
  x: Animated.Value;
  y: Animated.Value;
  rotation: Animated.Value;
  color: string;
  size: number;
}

interface CelebrationEffectsProps {
  onComplete?: () => void;
}

export const CelebrationEffects: React.FC<CelebrationEffectsProps> = ({ onComplete }) => {
  const flashOpacity = useRef(new Animated.Value(0)).current;
  const confettiPieces = useRef<ConfettiPiece[]>([]);

  const colors = ['#9333EA', '#EC4899', '#F59E0B', '#10B981', '#3B82F6', '#8B5CF6'];

  useEffect(() => {
    // Crear piezas de confeti
    confettiPieces.current = Array.from({ length: 50 }, (_, i) => ({
      id: i,
      x: new Animated.Value(Math.random() * width),
      y: new Animated.Value(-50),
      rotation: new Animated.Value(0),
      color: colors[Math.floor(Math.random() * colors.length)],
      size: Math.random() * 8 + 4,
    }));

    // Efecto de destello morado
    Animated.sequence([
      Animated.timing(flashOpacity, {
        toValue: 0.7,
        duration: 300,
        useNativeDriver: true,
      }),
      Animated.timing(flashOpacity, {
        toValue: 0,
        duration: 1200,
        useNativeDriver: true,
      }),
    ]).start();

    // Animación de confeti
    const confettiAnimations = confettiPieces.current.map((piece) => {
      const duration = 3000 + Math.random() * 1000;
      const endX = piece.x._value + (Math.random() - 0.5) * 100;

      return Animated.parallel([
        Animated.timing(piece.y, {
          toValue: height + 50,
          duration,
          useNativeDriver: true,
        }),
        Animated.timing(piece.x, {
          toValue: endX,
          duration,
          useNativeDriver: true,
        }),
        Animated.timing(piece.rotation, {
          toValue: Math.random() * 720 - 360,
          duration,
          useNativeDriver: true,
        }),
      ]);
    });

    Animated.parallel(confettiAnimations).start(() => {
      if (onComplete) {
        onComplete();
      }
    });
  }, []);

  return (
    <View style={styles.container} pointerEvents="none">
      {/* Destello morado */}
      <Animated.View
        style={[
          styles.flash,
          {
            opacity: flashOpacity,
          },
        ]}
      />

      {/* Confeti */}
      {confettiPieces.current.map((piece) => (
        <Animated.View
          key={piece.id}
          style={[
            styles.confetti,
            {
              backgroundColor: piece.color,
              width: piece.size,
              height: piece.size * 1.5,
              transform: [
                { translateX: piece.x },
                { translateY: piece.y },
                {
                  rotate: piece.rotation.interpolate({
                    inputRange: [-360, 360],
                    outputRange: ['-360deg', '360deg'],
                  }),
                },
              ],
            },
          ]}
        />
      ))}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 1000,
  },
  flash: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#9333EA',
  },
  confetti: {
    position: 'absolute',
    borderRadius: 2,
  },
});
