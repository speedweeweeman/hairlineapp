import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  View,
  Text,
  Image,
  StyleSheet,
  SafeAreaView,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Dimensions,
} from 'react-native';
import { supabase } from '@/lib/supabase';
import { PYTHON_SERVICE_URL } from '@/constants/config';

async function pyFetch(path: string, body: object): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    return await fetch(`${PYTHON_SERVICE_URL}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

type Metrics = {
  temple_depth: number;
  symmetry: number;
  forehead_ratio: number;
};

type ScanData = {
  id: string;
  image_url: string;
  normalized_image_url: string | null;
  created_at: string;
  type: string;
  hairline_status: string | null;
  metrics_json: Metrics | null;
};

type Stage = 'loading' | 'idle' | 'normalizing' | 'analyzing' | 'done' | 'error';

const STATUS_INFO: Record<string, { label: string; color: string; sub: string }> = {
  stable: {
    label: 'Stable',
    color: '#4ade80',
    sub: 'Your hairline shows no significant recession.',
  },
  slight_recession: {
    label: 'Slight Recession',
    color: '#facc15',
    sub: 'Mild temple recession detected. Worth monitoring.',
  },
  moderate: {
    label: 'Moderate Recession',
    color: '#f87171',
    sub: 'Noticeable recession at the temples.',
  },
};

export default function ScanDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [scan, setScan] = useState<ScanData | null>(null);
  const [stage, setStage] = useState<Stage>('loading');
  const [stageText, setStageText] = useState('');

  useEffect(() => {
    loadScan();
  }, [id]);

  const loadScan = async () => {
    const { data, error } = await supabase
      .from('scans')
      .select('id, image_url, normalized_image_url, created_at, type, hairline_status, metrics_json')
      .eq('id', id)
      .single();

    if (error || !data) {
      setStage('error');
      setStageText('Could not load scan.');
      return;
    }

    setScan(data);
    setStage(data.hairline_status ? 'done' : 'idle');
  };

  const analyze = async () => {
    if (!scan) return;

    let current = scan;

    // Normalize first if needed
    if (!current.normalized_image_url) {
      setStage('normalizing');
      setStageText('Aligning image…');
      try {
        const res = await pyFetch('/normalize-image', {
          scan_id: current.id,
          image_url: current.image_url,
        });
        if (res.ok) {
          const json = await res.json();
          const { error: dbErr } = await supabase
            .from('scans')
            .update({
              normalized_image_url: json.normalized_image_url,
              landmarks_json: json.landmarks_json,
            })
            .eq('id', current.id);
          if (!dbErr) {
            current = { ...current, normalized_image_url: json.normalized_image_url };
            setScan(current);
          }
        }
        // If normalize fails, continue with original image
      } catch {
        // service offline — continue with original
      }
    }

    setStage('analyzing');
    setStageText('Detecting hairline…');

    const imageUrl = current.normalized_image_url ?? current.image_url;

    try {
      const res = await pyFetch('/analyze-hairline', {
        scan_id: current.id,
        image_url: imageUrl,
      });

      if (!res.ok) throw new Error('analysis failed');

      const json = await res.json();
      setScan((s) =>
        s ? { ...s, hairline_status: json.status, metrics_json: json.metrics } : s
      );
      setStage('done');
    } catch {
      setStage('error');
      setStageText('Analysis failed. Is the Python service running?');
    }
  };

  const formatDate = (iso: string) =>
    new Date(iso).toLocaleDateString('en-US', {
      month: 'long',
      day: 'numeric',
      year: 'numeric',
    });

  const statusInfo = scan?.hairline_status ? STATUS_INFO[scan.hairline_status] : null;
  const imageUrl = scan?.normalized_image_url ?? scan?.image_url ?? '';

  if (stage === 'loading') {
    return (
      <View style={styles.centered}>
        <ActivityIndicator color="#0a7ea4" size="large" />
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
          <Text style={styles.backText}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Scan</Text>
        <View style={{ width: 70 }} />
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        {scan && (
          <>
            <Image source={{ uri: imageUrl }} style={styles.image} resizeMode="cover" />

            <View style={styles.meta}>
              <Text style={styles.dateText}>{formatDate(scan.created_at)}</Text>
              {scan.normalized_image_url && (
                <View style={styles.alignedBadge}>
                  <Text style={styles.alignedBadgeText}>Face-aligned</Text>
                </View>
              )}
            </View>

            {stage === 'idle' && (
              <TouchableOpacity style={styles.analyzeButton} onPress={analyze}>
                <Text style={styles.analyzeButtonText}>Analyze Hairline</Text>
              </TouchableOpacity>
            )}

            {(stage === 'normalizing' || stage === 'analyzing') && (
              <View style={styles.progressCard}>
                <ActivityIndicator color="#0a7ea4" />
                <Text style={styles.progressText}>{stageText}</Text>
              </View>
            )}

            {stage === 'error' && (
              <View style={styles.errorCard}>
                <Text style={styles.errorCardText}>{stageText}</Text>
                <TouchableOpacity onPress={analyze} style={styles.retryButton}>
                  <Text style={styles.retryText}>Retry</Text>
                </TouchableOpacity>
              </View>
            )}

            {stage === 'done' && statusInfo && scan.metrics_json && (
              <>
                <View style={[styles.statusCard, { borderColor: statusInfo.color + '40' }]}>
                  <View style={[styles.statusDot, { backgroundColor: statusInfo.color }]} />
                  <View style={styles.statusBody}>
                    <Text style={[styles.statusLabel, { color: statusInfo.color }]}>
                      {statusInfo.label}
                    </Text>
                    <Text style={styles.statusSub}>{statusInfo.sub}</Text>
                  </View>
                </View>

                <View style={styles.metricsCard}>
                  <Text style={styles.metricsTitle}>Hairline Metrics</Text>
                  <MetricRow label="Temple Recession" value={scan.metrics_json.temple_depth} />
                  <MetricRow
                    label="Symmetry Score"
                    value={scan.metrics_json.symmetry}
                    isPercent
                  />
                  <MetricRow
                    label="Forehead Ratio"
                    value={scan.metrics_json.forehead_ratio}
                    last
                  />
                </View>

                <TouchableOpacity
                  style={styles.projectionButton}
                  onPress={() =>
                    router.push({
                      pathname: '/projection',
                      params: {
                        scanId: scan.id,
                        scanImageUrl: scan.normalized_image_url ?? scan.image_url,
                      },
                    })
                  }
                >
                  <Text style={styles.projectionButtonText}>See Future Projection</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.planButton}
                  onPress={() => router.push('/(tabs)/plan')}
                >
                  <Text style={styles.planButtonText}>Get Your Plan</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.reanalyzeButton}
                  onPress={analyze}>
                  <Text style={styles.reanalyzeText}>Re-analyze</Text>
                </TouchableOpacity>
              </>
            )}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function MetricRow({
  label,
  value,
  isPercent = false,
  last = false,
}: {
  label: string;
  value: number;
  isPercent?: boolean;
  last?: boolean;
}) {
  const display = isPercent ? `${Math.round(value * 100)}%` : value.toFixed(3);
  return (
    <View style={[metricStyles.row, last && metricStyles.rowLast]}>
      <Text style={metricStyles.label}>{label}</Text>
      <Text style={metricStyles.value}>{display}</Text>
    </View>
  );
}

const { width } = Dimensions.get('window');

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0a0a0a' },
  centered: {
    flex: 1,
    backgroundColor: '#0a0a0a',
    justifyContent: 'center',
    alignItems: 'center',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  backButton: { width: 70 },
  backText: { color: '#0a7ea4', fontSize: 16 },
  title: { color: '#fff', fontSize: 17, fontWeight: '600' },
  content: { paddingBottom: 48 },
  image: { width, height: Math.round(width * 0.75) },
  meta: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 4,
  },
  dateText: { color: '#888', fontSize: 14 },
  alignedBadge: {
    backgroundColor: '#4ade8020',
    borderRadius: 20,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  alignedBadgeText: { color: '#4ade80', fontSize: 11, fontWeight: '600' },
  analyzeButton: {
    marginHorizontal: 20,
    marginTop: 20,
    backgroundColor: '#0a7ea4',
    borderRadius: 14,
    paddingVertical: 18,
    alignItems: 'center',
  },
  analyzeButtonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  progressCard: {
    marginHorizontal: 20,
    marginTop: 20,
    backgroundColor: '#111',
    borderRadius: 14,
    padding: 20,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    borderWidth: 1,
    borderColor: '#2a2a2a',
  },
  progressText: { color: '#888', fontSize: 15 },
  errorCard: {
    marginHorizontal: 20,
    marginTop: 20,
    backgroundColor: '#1a0a0a',
    borderRadius: 14,
    padding: 20,
    gap: 12,
    borderWidth: 1,
    borderColor: '#f8717130',
  },
  errorCardText: { color: '#f87171', fontSize: 14, lineHeight: 20 },
  retryButton: {
    backgroundColor: '#1a1a1a',
    borderRadius: 8,
    paddingVertical: 10,
    paddingHorizontal: 20,
    alignSelf: 'flex-start',
  },
  retryText: { color: '#fff', fontWeight: '600' },
  statusCard: {
    marginHorizontal: 20,
    marginTop: 20,
    backgroundColor: '#111',
    borderRadius: 14,
    padding: 18,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 14,
    borderWidth: 1,
  },
  statusDot: { width: 10, height: 10, borderRadius: 5, marginTop: 5 },
  statusBody: { flex: 1, gap: 6 },
  statusLabel: { fontSize: 20, fontWeight: '700' },
  statusSub: { fontSize: 14, color: '#666', lineHeight: 20 },
  metricsCard: {
    marginHorizontal: 20,
    marginTop: 16,
    backgroundColor: '#111',
    borderRadius: 14,
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 4,
    borderWidth: 1,
    borderColor: '#2a2a2a',
  },
  metricsTitle: {
    fontSize: 11,
    color: '#555',
    textTransform: 'uppercase',
    letterSpacing: 1,
    fontWeight: '600',
    marginBottom: 8,
  },
  projectionButton: {
    marginHorizontal: 20,
    marginTop: 16,
    backgroundColor: '#1a1a2e',
    borderRadius: 14,
    paddingVertical: 18,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#0a7ea440',
  },
  projectionButtonText: { color: '#0a7ea4', fontSize: 16, fontWeight: '600' },
  planButton: {
    marginHorizontal: 20,
    marginTop: 12,
    backgroundColor: '#111',
    borderRadius: 14,
    paddingVertical: 18,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#2a2a2a',
  },
  planButtonText: { color: '#fff', fontSize: 16, fontWeight: '500' },
  reanalyzeButton: {
    marginHorizontal: 20,
    marginTop: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  reanalyzeText: { color: '#444', fontSize: 14 },
});

const metricStyles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#1a1a1a',
  },
  rowLast: { borderBottomWidth: 0 },
  label: { fontSize: 15, color: '#aaa' },
  value: { fontSize: 15, color: '#fff', fontWeight: '600' },
});
