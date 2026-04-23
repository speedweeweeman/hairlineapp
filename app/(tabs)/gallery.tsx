import { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
  Image,
  StyleSheet,
  TouchableOpacity,
  RefreshControl,
  SafeAreaView,
  Dimensions,
  ActivityIndicator,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useAuth } from '@/context/auth';
import { supabase } from '@/lib/supabase';

type Scan = {
  id: string;
  image_url: string;
  created_at: string;
  type: string;
};

const ITEM_SIZE = (Dimensions.get('window').width - 48) / 2;

export default function GalleryScreen() {
  const { user } = useAuth();
  const router = useRouter();
  const [scans, setScans] = useState<Scan[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchScans = useCallback(async () => {
    if (!user) return;
    const { data, error } = await supabase
      .from('scans')
      .select('id, image_url, created_at, type')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false });

    if (!error && data) setScans(data);
    setLoading(false);
    setRefreshing(false);
  }, [user]);

  useEffect(() => {
    fetchScans();
  }, [fetchScans]);

  const onRefresh = () => {
    setRefreshing(true);
    fetchScans();
  };

  const formatDate = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' });
  };

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator color="#0a7ea4" size="large" />
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>My Scans</Text>
        <Text style={styles.count}>{scans.length} total</Text>
      </View>

      {scans.length === 0 ? (
        <View style={styles.emptyContainer}>
          <Text style={styles.emptyTitle}>No scans yet</Text>
          <Text style={styles.emptySub}>Take your first scan to start tracking.</Text>
          <TouchableOpacity
            style={styles.emptyCTA}
            onPress={() => router.push('/(tabs)/camera')}>
            <Text style={styles.emptyCTAText}>Take First Scan</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={scans}
          keyExtractor={(item) => item.id}
          numColumns={2}
          contentContainerStyle={styles.grid}
          columnWrapperStyle={styles.row}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor="#0a7ea4"
            />
          }
          renderItem={({ item }) => (
            <View style={styles.scanItem}>
              <Image
                source={{ uri: item.image_url }}
                style={styles.scanImage}
                resizeMode="cover"
              />
              <View style={styles.scanMeta}>
                <Text style={styles.scanDate}>{formatDate(item.created_at)}</Text>
                {item.type === 'baseline' && (
                  <View style={styles.baselineBadge}>
                    <Text style={styles.baselineBadgeText}>Baseline</Text>
                  </View>
                )}
              </View>
            </View>
          )}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0a0a0a',
  },
  centered: {
    flex: 1,
    backgroundColor: '#0a0a0a',
    justifyContent: 'center',
    alignItems: 'center',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 12,
  },
  title: {
    fontSize: 24,
    fontWeight: '700',
    color: '#fff',
  },
  count: {
    fontSize: 14,
    color: '#555',
  },
  grid: {
    paddingHorizontal: 16,
    paddingBottom: 24,
  },
  row: {
    gap: 16,
    marginBottom: 16,
  },
  scanItem: {
    width: ITEM_SIZE,
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: '#1a1a1a',
  },
  scanImage: {
    width: ITEM_SIZE,
    height: ITEM_SIZE * 1.1,
  },
  scanMeta: {
    padding: 10,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  scanDate: {
    fontSize: 12,
    color: '#888',
  },
  baselineBadge: {
    backgroundColor: '#0a7ea420',
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  baselineBadgeText: {
    fontSize: 10,
    color: '#0a7ea4',
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
  },
  emptyTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: '#fff',
    marginBottom: 8,
  },
  emptySub: {
    fontSize: 15,
    color: '#555',
    textAlign: 'center',
    marginBottom: 32,
  },
  emptyCTA: {
    backgroundColor: '#0a7ea4',
    borderRadius: 12,
    paddingHorizontal: 32,
    paddingVertical: 14,
  },
  emptyCTAText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
});
