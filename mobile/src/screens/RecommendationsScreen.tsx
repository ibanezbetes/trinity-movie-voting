import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Image,
  StatusBar,
  FlatList,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { staticRecommendations, RecommendationCategory, RecommendationMovie } from '../data/staticRecommendations';
import { AppTabBar, Icon } from '../components';

export default function RecommendationsScreen() {
  const navigation = useNavigation();

  const renderMovieCard = ({ item }: { item: RecommendationMovie }) => (
    <TouchableOpacity style={styles.movieCard} activeOpacity={0.8}>
      <Image 
        source={{ uri: item.posterPath }} 
        style={styles.moviePoster}
        resizeMode="cover"
      />
      <View style={styles.movieInfo}>
        <Text style={styles.movieTitle} numberOfLines={2}>
          {item.title}
        </Text>
        <Text style={styles.movieYear}>{item.year}</Text>
      </View>
    </TouchableOpacity>
  );

  const renderCategory = ({ item }: { item: RecommendationCategory }) => (
    <View style={styles.categoryContainer}>
      <View style={styles.categoryHeader}>
        <Text style={styles.categoryTitle}>{item.title}</Text>
        <Text style={styles.categoryDescription}>{item.description}</Text>
      </View>
      
      <FlatList
        data={item.movies}
        renderItem={renderMovieCard}
        keyExtractor={(movie) => movie.id.toString()}
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.moviesContainer}
        ItemSeparatorComponent={() => <View style={{ width: 12 }} />}
      />
    </View>
  );

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#1a1a1a" />
      
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity 
          style={styles.backButton} 
          onPress={() => navigation.goBack()}
        >
          <Icon name="arrow-back" size={24} color="#ffffff" />
        </TouchableOpacity>
        <Text style={styles.title}>RECOMENDACIONES</Text>
        <View style={styles.placeholder} />
      </View>

      {/* Categories List */}
      <FlatList
        data={staticRecommendations}
        renderItem={renderCategory}
        keyExtractor={(category) => category.id}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.categoriesContainer}
        ItemSeparatorComponent={() => <View style={{ height: 30 }} />}
      />

      {/* Floating Tab Bar */}
      <AppTabBar activeTab="recommendations" />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#1a1a1a',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 15,
    borderBottomWidth: 1,
    borderBottomColor: '#333333',
  },
  backButton: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 20,
    backgroundColor: '#333333',
  },
  title: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#ffffff',
    letterSpacing: 1,
  },
  placeholder: {
    width: 40,
  },
  categoriesContainer: {
    paddingVertical: 20,
    paddingBottom: 100, // Space for floating tab bar
  },
  categoryContainer: {
    paddingHorizontal: 20,
  },
  categoryHeader: {
    marginBottom: 15,
  },
  categoryTitle: {
    fontSize: 22,
    fontWeight: 'bold',
    color: '#ffffff',
    marginBottom: 5,
  },
  categoryDescription: {
    fontSize: 14,
    color: '#888888',
    lineHeight: 20,
  },
  moviesContainer: {
    paddingLeft: 0,
  },
  movieCard: {
    width: 140,
    backgroundColor: '#2a2a2a',
    borderRadius: 12,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 5,
  },
  moviePoster: {
    width: '100%',
    height: 200,
    backgroundColor: '#333333',
  },
  movieInfo: {
    padding: 12,
  },
  movieTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#ffffff',
    marginBottom: 4,
    lineHeight: 18,
  },
  movieYear: {
    fontSize: 12,
    color: '#888888',
  },
});