import React, { useEffect, useRef } from 'react';
import {
  View,
  ScrollView,
  Image,
  StyleSheet,
  Dimensions,
  Animated,
} from 'react-native';

const { width, height } = Dimensions.get('window');

interface Movie {
  id: number;
  title: string;
  poster: string;
}

interface MovieCarouselProps {
  movies: Movie[];
  autoScroll?: boolean;
  scrollInterval?: number;
}

export const MovieCarousel: React.FC<MovieCarouselProps> = ({
  movies,
  autoScroll = true,
  scrollInterval = 3000,
}) => {
  const scrollX = useRef(new Animated.Value(0)).current;
  const scrollViewRef = useRef<ScrollView>(null);
  const currentIndexRef = useRef(0);

  useEffect(() => {
    if (!autoScroll) return;

    const interval = setInterval(() => {
      currentIndexRef.current = (currentIndexRef.current + 1) % movies.length;
      
      scrollViewRef.current?.scrollTo({
        x: currentIndexRef.current * width,
        animated: true,
      });
    }, scrollInterval);

    return () => clearInterval(interval);
  }, [autoScroll, scrollInterval, movies.length]);

  return (
    <View style={styles.container}>
      <ScrollView
        ref={scrollViewRef}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onScroll={Animated.event(
          [{ nativeEvent: { contentOffset: { x: scrollX } } }],
          { useNativeDriver: false }
        )}
        scrollEventThrottle={16}
        style={styles.scrollView}
      >
        {movies.map((movie) => (
          <View key={movie.id} style={styles.carouselItem}>
            <Image
              source={{ uri: movie.poster }}
              style={styles.posterImage}
              resizeMode="cover"
            />
          </View>
        ))}
      </ScrollView>
      
      {/* Overlay oscuro para mejorar legibilidad */}
      <View style={styles.overlay} />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  scrollView: {
    flex: 1,
  },
  carouselItem: {
    width: width,
    height: height,
  },
  posterImage: {
    width: '100%',
    height: '100%',
    opacity: 0.3,
  },
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
  },
});
