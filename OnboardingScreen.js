import { useState, useRef } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity,
  Dimensions, ScrollView, Animated,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';

const { width } = Dimensions.get('window');

const SLIDES = [
  {
    icon: 'barcode-outline',
    color: '#27ae60',
    title: 'Scan to Add Items',
    subtitle: 'Point your camera at any barcode and we\'ll look up the product automatically. Name, category, and image — all filled in for you.',
  },
  {
    icon: 'add-circle-outline',
    color: '#2980b9',
    title: 'Add Items Manually',
    subtitle: 'No barcode? No problem. Tap Add to enter a product name, pick a category, set a quantity, and even take a photo.',
  },
  {
    icon: 'people-outline',
    color: '#8e44ad',
    title: 'Share With Your Household',
    subtitle: 'Everyone in your home stays in sync. Share your join code so others can see the same inventory in real time. Get low stock alerts before you run out.',
  },
];

export default function OnboardingScreen({ onDone }) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const scrollRef = useRef(null);
  const fadeAnim = useRef(new Animated.Value(1)).current;

  const goToSlide = (index) => {
    Animated.sequence([
      Animated.timing(fadeAnim, { toValue: 0.3, duration: 120, useNativeDriver: true }),
      Animated.timing(fadeAnim, { toValue: 1, duration: 200, useNativeDriver: true }),
    ]).start();
    setCurrentIndex(index);
    scrollRef.current?.scrollTo({ x: index * width, animated: true });
  };

  const handleNext = () => {
    if (currentIndex < SLIDES.length - 1) {
      goToSlide(currentIndex + 1);
    } else {
      handleDone();
    }
  };

  const handleDone = async () => {
    await AsyncStorage.setItem('hasSeenOnboarding', 'true');
    onDone();
  };

  const slide = SLIDES[currentIndex];

  return (
    <View style={styles.container}>

      {/* Skip button */}
      <TouchableOpacity style={styles.skipBtn} onPress={handleDone}>
        <Text style={styles.skipText}>Skip</Text>
      </TouchableOpacity>

      {/* Slide content */}
      <Animated.View style={[styles.slideContent, { opacity: fadeAnim }]}>
        <View style={[styles.iconCircle, { backgroundColor: slide.color + '18' }]}>
          <Ionicons name={slide.icon} size={72} color={slide.color} />
        </View>
        <Text style={styles.title}>{slide.title}</Text>
        <Text style={styles.subtitle}>{slide.subtitle}</Text>
      </Animated.View>

      {/* Dots */}
      <View style={styles.dotsRow}>
        {SLIDES.map((_, i) => (
          <TouchableOpacity key={i} onPress={() => goToSlide(i)}>
            <View style={[
              styles.dot,
              i === currentIndex && { backgroundColor: slide.color, width: 24 }
            ]} />
          </TouchableOpacity>
        ))}
      </View>

      {/* Next / Get Started button */}
      <TouchableOpacity
        style={[styles.nextBtn, { backgroundColor: slide.color }]}
        onPress={handleNext}
      >
        <Text style={styles.nextBtnText}>
          {currentIndex === SLIDES.length - 1 ? 'Get Started' : 'Next'}
        </Text>
        <Ionicons
          name={currentIndex === SLIDES.length - 1 ? 'checkmark' : 'arrow-forward'}
          size={20}
          color="white"
        />
      </TouchableOpacity>

    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f4f4f4',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
    paddingBottom: 48,
  },
  skipBtn: {
    position: 'absolute',
    top: 60,
    right: 24,
    padding: 8,
  },
  skipText: {
    fontSize: 15,
    color: '#999',
    fontWeight: '500',
  },
  slideContent: {
    alignItems: 'center',
    paddingHorizontal: 8,
    marginBottom: 48,
  },
  iconCircle: {
    width: 148,
    height: 148,
    borderRadius: 74,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 40,
  },
  title: {
    fontSize: 26,
    fontWeight: 'bold',
    color: '#2c3e50',
    textAlign: 'center',
    marginBottom: 16,
    lineHeight: 34,
  },
  subtitle: {
    fontSize: 16,
    color: '#666',
    textAlign: 'center',
    lineHeight: 26,
  },
  dotsRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 32,
    alignItems: 'center',
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#ddd',
  },
  nextBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 16,
    paddingHorizontal: 40,
    borderRadius: 50,
    width: '100%',
    shadowOpacity: 0.2,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },
  nextBtnText: {
    color: 'white',
    fontSize: 17,
    fontWeight: 'bold',
  },
});