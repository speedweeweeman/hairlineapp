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
  normalized_image_url: string | null;
  created_at: string;
  type: string;
  hairline_status: string | null;
};

const ITEM_SIZE = (Dimensions.get('window').width - 48) / 2;

const STATUS_COLORS: Record<string, string> = {
  stable: '#4ade80',
  slight_recession: '#facc15',
  moderate: '#f87171',
};
const STATUS_LABELS: Record<string, string> = {
  stable: 'Stable',
  slight_recession: 'Slight',
  moderate: 'Moderate',
};

export default function GalleryScreen() {
  const { user } = useAuth();
  const router = useRouter();
  const [scans, setScans] = useState<Scan[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [compareMode, setCompareMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  const fetchScans = useCallback(async () => {
    if (!user) return;
    const { data, error } = await supabase
      .from('scans')
      .select('id, image_url, normalized_image_url, created_at, type, hairline_status')
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

  const toggleCompareMode = () => {
    setCompareMode((m) => !m);
    setSelectedIds([]);
  };

  const handleScanPress = (id: string) => {
    if (compareMode) {
      if (selectedIds.includes(id)) {
        setSelectedIds(selectedIds.filter((s) => s !== id));
      } else if (selectedIds.length < 2) {
        setSelectedIds([...selectedIds, id]);
      }
      return;
    }
    router.push(`/scan/${id}`);
  };

  const startComparison = () => {
    if (selectedIds.length !== 2) return;
    router.push(`/compare?before=${selectedIds[0]}&after=${selectedIds[1]}`);
    setCompareMode(false);
    setSelectedIds([]);
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
        <View style={styles.headerRight}>
          {scans.length >= 2 && (
            <TouchableOpacity onPress={toggleCompareMode} style={styles.compareToggle}>
              <Text style={[styles.compareToggleText, compareMode && styles.compareToggleActive]}>
                {compareMode ? 'Cancel' : 'Compare'}
              </Text>
            </TouchableOpacity>
          )}
          {!compareMode && (
            <Text style={styles.count}>{scans.length} total</Text>
          )}
        </View>
      </View>

      {compareMode && (
        <View style={styles.compareBanner}>
          <Text style={styles.compareBannerText}>
            {selectedIds.length === 0
              ? 'Tap a scan to select (pick 2)'
              : selectedIds.length === 1
              ? 'Now tap a second scan'
              : 'Ready to compare'}
          </Text>
        </View>
      )}

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
        <>
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
            renderItem={({ item }) => {
              const selectionIndex = selectedIds.indexOf(item.id);
              const isSelected = selectionIndex !== -1;

              return (
                <TouchableOpacity
                  style={[styles.scanItem, isSelected && styles.scanItemSelected]}
                  onPress={() => handleScanPress(item.id)}
                  activeOpacity={0.7}>
                  <Image
                    source={{ uri: item.image_url }}
                    style={styles.scanImage}
                    resizeMode="cover"
                  />
                  {/* Selection number badge */}
                  {isSelected && (
                    <View style={styles.selectionBadge}>
                      <Text style={styles.selectionBadgeText}>{selectionIndex + 1}</Text>
                    </View>
                  )}
                  {/* Normalized indicator */}
                  {item.normalized_image_url && (
                    <View style={styles.alignedDot} />
                  )}
                  <View style={styles.scanMeta}>
                    <Text style={styles.scanDate}>{formatDate(item.created_at)}</Text>
                    {item.hairline_status ? (
                      <View style={[styles.statusBadge, { backgroundColor: STATUS_COLORS[item.hairline_status] + '25' }]}>
                        <Text style={[styles.statusBadgeText, { color: STATUS_COLORS[item.hairline_status] }]}>
                          {STATUS_LABELS[item.hairline_status]}
                        </Text>
                      </View>
                    ) : item.type === 'baseline' ? (
                      <View style={styles.baselineBadge}>
                        <Text style={styles.baselineBadgeText}>Baseline</Text>
                      </View>
                    ) : null}
                  </View>
                </TouchableOpacity>
              );
            }}
          />

          {/* Compare action bar */}
          {compareMode && (
            <View style={styles.compareBar}>
              <TouchableOpacity
                style={[styles.compareButton, selectedIds.length !== 2 && styles.compareButtonDisabled]}
                onPress={startComparison}
                disabled={selectedIds.length !== 2}>
                <Text style={styles.compareButtonText}>
                  {selectedIds.length === 2 ? 'Compare Selected' : `Select ${2 - selectedIds.length} more`}
                </Text>
              </TouchableOpacity>
            </View>
          )}
        </>
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
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 12,
  },
  title: {
    fontSize: 24,
    fontWeight: '700',
    color: '#fff',
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  count: {
    fontSize: 14,
    color: '#555',
  },
  compareToggle: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#2a2a2a',
  },
  compareToggleText: {
    fontSize: 14,
    color: '#0a7ea4',
    fontWeight: '500',
  },
  compareToggleActive: {
    color: '#ff6b6b',
  },
  compareBanner: {
    marginHorizontal: 16,
    marginBottom: 8,
    backgroundColor: '#0a7ea415',
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: '#0a7ea430',
  },
  compareBannerText: {
    color: '#0a7ea4',
    fontSize: 13,
    fontWeight: '500',
    textAlign: 'center',
  },
  grid: {
    paddingHorizontal: 16,
    paddingBottom: 100,
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
  scanItemSelected: {
    borderWidth: 2,
    borderColor: '#0a7ea4',
  },
  scanImage: {
    width: ITEM_SIZE,
    height: ITEM_SIZE * 1.1,
  },
  selectionBadge: {
    position: 'absolute',
    top: 8,
    right: 8,
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: '#0a7ea4',
    justifyContent: 'center',
    alignItems: 'center',
  },
  selectionBadgeText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 13,
  },
  alignedDot: {
    position: 'absolute',
    top: 8,
    left: 8,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#4ade80',
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
  statusBadge: {
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  statusBadgeText: {
    fontSize: 10,
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
  compareBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 16,
    paddingBottom: 32,
    paddingTop: 12,
    backgroundColor: '#0a0a0a',
    borderTopWidth: 1,
    borderTopColor: '#1a1a1a',
  },
  compareButton: {
    backgroundColor: '#0a7ea4',
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
  },
  compareButtonDisabled: {
    backgroundColor: '#1a1a1a',
  },
  compareButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
});
