import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import {
  Animated,
  Dimensions,
  Image,
  PanResponder,
  SafeAreaView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  ActivityIndicator,
} from 'react-native';
import { supabase } from '@/lib/supabase';
import { PYTHON_SERVICE_URL } from '@/constants/config';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const IMAGE_HEIGHT = Math.round(SCREEN_WIDTH * 0.75);

type ScanData = {
  id: string;
  image_url: string;
  normalized_image_url: string | null;
  landmarks_json: object | null;
  created_at: string;
};

type Status = 'loading' | 'ready' | 'error';

async function normalizeIfNeeded(scan: ScanData): Promise<ScanData> {
  if (scan.normalized_image_url) return scan;
  try {
    const res = await fetch(`${PYTHON_SERVICE_URL}/normalize-image`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scan_id: scan.id, image_url: scan.image_url }),
    });
    if (!res.ok) return scan;
    const json = await res.json();
    await supabase
      .from('scans')
      .update({ normalized_image_url: json.normalized_image_url, landmarks_json: json.landmarks_json })
      .eq('id', scan.id);
    return { ...scan, normalized_image_url: json.normalized_image_url };
  } catch {
    return scan;
  }
}

export default function CompareScreen() {
  const { before: beforeId, after: afterId } = useLocalSearchParams<{
    before: string;
    after: string;
  }>();
  const router = useRouter();

  const [beforeScan, setBeforeScan] = useState<ScanData | null>(null);
  const [afterScan, setAfterScan] = useState<ScanData | null>(null);
  const [status, setStatus] = useState<Status>('loading');
  const [statusText, setStatusText] = useState('Loading scans…');
  const [swapped, setSwapped] = useState(false);

  // Slider state
  const sliderPosition = useRef(new Animated.Value(SCREEN_WIDTH / 2)).current;
  const startXRef = useRef(SCREEN_WIDTH / 2);

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: () => {
        sliderPosition.stopAnimation((val) => {
          startXRef.current = val;
        });
      },
      onPanResponderMove: (_, gs) => {
        const newX = Math.max(2, Math.min(SCREEN_WIDTH - 2, startXRef.current + gs.dx));
        sliderPosition.setValue(newX);
      },
    })
  ).current;

  const afterClipWidth = sliderPosition.interpolate({
    inputRange: [0, SCREEN_WIDTH],
    outputRange: [SCREEN_WIDTH, 0],
    extrapolate: 'clamp',
  });

  useEffect(() => {
    if (!beforeId || !afterId) return;
    loadScans();
  }, [beforeId, afterId]);

  const loadScans = async () => {
    setStatus('loading');
    setStatusText('Loading scans…');

    const { data, error } = await supabase
      .from('scans')
      .select('id, image_url, normalized_image_url, landmarks_json, created_at')
      .in('id', [beforeId, afterId]);

    if (error || !data || data.length < 2) {
      setStatus('error');
      setStatusText('Failed to load scans.');
      return;
    }

    let before = data.find((s) => s.id === beforeId);
    let after = data.find((s) => s.id === afterId);
    if (!before || !after) {
      setStatus('error');
      setStatusText('Failed to load scans.');
      return;
    }

    if (!before.normalized_image_url || !after.normalized_image_url) {
      setStatusText('Aligning images to eye level…');
      [before, after] = await Promise.all([normalizeIfNeeded(before), normalizeIfNeeded(after)]);
    }

    setBeforeScan(before);
    setAfterScan(after);
    setStatus('ready');
  };

  const formatDate = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' });
  };

  const displayBefore = swapped ? afterScan : beforeScan;
  const displayAfter = swapped ? beforeScan : afterScan;
  const beforeUrl = displayBefore?.normalized_image_url ?? displayBefore?.image_url ?? '';
  const afterUrl = displayAfter?.normalized_image_url ?? displayAfter?.image_url ?? '';
  const isAligned = !!(displayBefore?.normalized_image_url && displayAfter?.normalized_image_url);

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
          <Text style={styles.backText}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Compare</Text>
        {status === 'ready' ? (
          <TouchableOpacity onPress={() => setSwapped((s) => !s)} style={styles.swapButton}>
            <Text style={styles.swapText}>Swap</Text>
          </TouchableOpacity>
        ) : (
          <View style={styles.swapButton} />
        )}
      </View>

      {status === 'loading' && (
        <View style={styles.centered}>
          <ActivityIndicator color="#0a7ea4" size="large" />
          <Text style={styles.statusText}>{statusText}</Text>
        </View>
      )}

      {status === 'error' && (
        <View style={styles.centered}>
          <Text style={styles.errorText}>Could not load scans.</Text>
          <TouchableOpacity onPress={loadScans} style={styles.retryButton}>
            <Text style={styles.retryText}>Retry</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Comparison Slider */}
      {status === 'ready' && displayBefore && displayAfter && (
        <View style={styles.sliderWrapper}>
          <View
            style={[styles.imageContainer, { height: IMAGE_HEIGHT }]}
            {...panResponder.panHandlers}>
            {/* Before image — full width background */}
            <Image
              source={{ uri: beforeUrl }}
              style={[StyleSheet.absoluteFill, { width: SCREEN_WIDTH, height: IMAGE_HEIGHT }]}
              resizeMode="cover"
            />

            {/* After image — clipped to right of divider */}
            <Animated.View
              style={[
                styles.afterClip,
                { width: afterClipWidth, height: IMAGE_HEIGHT },
              ]}>
              <Image
                source={{ uri: afterUrl }}
                style={{
                  position: 'absolute',
                  right: 0,
                  top: 0,
                  width: SCREEN_WIDTH,
                  height: IMAGE_HEIGHT,
                }}
                resizeMode="cover"
              />
            </Animated.View>

            {/* Divider line + handle */}
            <Animated.View style={[styles.divider, { left: sliderPosition }]}>
              <View style={styles.handle}>
                <Text style={styles.handleArrows}>‹ ›</Text>
              </View>
            </Animated.View>

            {/* Labels */}
            <View style={styles.labelBefore}>
              <Text style={styles.labelText}>BEFORE</Text>
              <Text style={styles.labelDate}>{formatDate(displayBefore.created_at)}</Text>
            </View>
            <View style={styles.labelAfter}>
              <Text style={styles.labelText}>AFTER</Text>
              <Text style={styles.labelDate}>{formatDate(displayAfter.created_at)}</Text>
            </View>
          </View>

          {/* Alignment badge */}
          {isAligned && (
            <View style={styles.badgeRow}>
              <View style={[styles.badge, styles.badgeAligned]}>
                <Text style={styles.badgeText}>Face-aligned</Text>
              </View>
            </View>
          )}

          <Text style={styles.hint}>Drag the divider left or right to compare</Text>
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0a0a0a',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  backButton: {
    width: 70,
  },
  backText: {
    color: '#0a7ea4',
    fontSize: 16,
  },
  title: {
    color: '#fff',
    fontSize: 17,
    fontWeight: '600',
  },
  swapButton: {
    width: 70,
    alignItems: 'flex-end',
  },
  swapText: {
    color: '#0a7ea4',
    fontSize: 16,
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
    gap: 12,
  },
  statusText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
    marginTop: 8,
  },
  errorText: {
    color: '#ff4444',
    fontSize: 16,
  },
  retryButton: {
    backgroundColor: '#0a7ea4',
    borderRadius: 10,
    paddingHorizontal: 24,
    paddingVertical: 12,
    marginTop: 8,
  },
  retryText: {
    color: '#fff',
    fontWeight: '600',
  },
  sliderWrapper: {
    flex: 1,
    alignItems: 'center',
  },
  imageContainer: {
    width: SCREEN_WIDTH,
    position: 'relative',
    overflow: 'hidden',
  },
  afterClip: {
    position: 'absolute',
    top: 0,
    right: 0,
    overflow: 'hidden',
  },
  divider: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: 2,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  handle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#fff',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 4,
  },
  handleArrows: {
    fontSize: 18,
    color: '#333',
    fontWeight: '700',
    letterSpacing: -2,
  },
  labelBefore: {
    position: 'absolute',
    top: 12,
    left: 12,
    gap: 2,
  },
  labelAfter: {
    position: 'absolute',
    top: 12,
    right: 12,
    alignItems: 'flex-end',
    gap: 2,
  },
  labelText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 4,
    overflow: 'hidden',
  },
  labelDate: {
    color: 'rgba(255,255,255,0.7)',
    fontSize: 10,
    backgroundColor: 'rgba(0,0,0,0.4)',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 3,
    overflow: 'hidden',
  },
  badgeRow: {
    marginTop: 16,
    alignItems: 'center',
  },
  badge: {
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 6,
  },
  badgeAligned: {
    backgroundColor: '#0a7ea420',
  },
  badgeText: {
    fontSize: 12,
    color: '#0a7ea4',
    fontWeight: '500',
  },
  hint: {
    marginTop: 12,
    color: '#444',
    fontSize: 13,
  },
});
