import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useAuth } from '@/context/auth';
import { PYTHON_SERVICE_URL } from '@/constants/config';

type Trend = 'improving' | 'neutral' | 'worsening';

type RecentScan = {
  date: string;
  status: string;
};

type ProgressResult = {
  summary: string;
  summary_label: string;
  confidence_score: number;
  habit_consistency: number;
  scan_count: number;
  metric_delta: number;
  trend: Trend;
  insight: string;
  recent_scans: RecentScan[];
};

const TREND_COLORS: Record<Trend, string> = {
  improving: '#4ade80',
  neutral: '#facc15',
  worsening: '#f87171',
};

const STATUS_LABELS: Record<string, string> = {
  stable: 'Stable',
  slight_recession: 'Slight Recession',
  moderate: 'Moderate',
};

const STATUS_COLORS: Record<string, string> = {
  stable: '#4ade80',
  slight_recession: '#facc15',
  moderate: '#f87171',
};

export default function ProgressScreen() {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [result, setResult] = useState<ProgressResult | null>(null);
  const [error, setError] = useState('');

  useFocusEffect(
    useCallback(() => {
      load();
    }, [user])
  );

  const load = async () => {
    if (!user) return;
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`${PYTHON_SERVICE_URL}/progress-analysis`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: user.id }),
      });
      if (!res.ok) throw new Error('Failed to load progress');
      const json = await res.json();
      setResult(json);
    } catch (e: any) {
      setError(e.message || 'Could not load progress. Is the Python service running?');
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.centered}>
          <ActivityIndicator color="#0a7ea4" size="large" />
          <Text style={styles.loadingText}>Analyzing your progress…</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (error) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.centered}>
          <Text style={styles.errorText}>{error}</Text>
          <TouchableOpacity style={styles.retryButton} onPress={load}>
            <Text style={styles.retryText}>Retry</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  if (!result) return null;

  const trendColor = TREND_COLORS[result.trend] ?? '#facc15';
  const consistencyPct = Math.round(result.habit_consistency * 100);

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Text style={styles.pageTitle}>Progress</Text>

        {/* Summary + Confidence row */}
        <View style={styles.row}>
          <View style={[styles.summaryCard, { borderColor: trendColor + '40', flex: 1 }]}>
            <View style={[styles.dot, { backgroundColor: trendColor }]} />
            <Text style={styles.summaryLabel}>Trend</Text>
            <Text style={[styles.summaryValue, { color: trendColor }]}>
              {result.summary_label}
            </Text>
          </View>

          <View style={[styles.confidenceCard, { flex: 1 }]}>
            <Text style={styles.summaryLabel}>Confidence</Text>
            <Text style={styles.confidenceNumber}>{result.confidence_score}</Text>
            <View style={styles.confidenceBar}>
              <View
                style={[
                  styles.confidenceFill,
                  { width: `${result.confidence_score}%` as any, backgroundColor: trendColor },
                ]}
              />
            </View>
          </View>
        </View>

        {/* Insight */}
        <View style={styles.insightCard}>
          <Text style={styles.insightText}>{result.insight}</Text>
        </View>

        {/* Stats row */}
        <View style={styles.row}>
          <View style={[styles.statCard, { flex: 1 }]}>
            <Text style={styles.statValue}>{result.scan_count}</Text>
            <Text style={styles.statLabel}>Total Scans</Text>
          </View>
          <View style={[styles.statCard, { flex: 1 }]}>
            <Text style={styles.statValue}>{consistencyPct}%</Text>
            <Text style={styles.statLabel}>Habit Rate (30d)</Text>
          </View>
        </View>

        {/* Scan Timeline */}
        {result.recent_scans.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Scan Timeline</Text>
            {result.recent_scans
              .slice()
              .reverse()
              .map((scan, i) => {
                const color = STATUS_COLORS[scan.status] ?? '#888';
                const label = STATUS_LABELS[scan.status] ?? scan.status;
                const date = new Date(scan.date).toLocaleDateString('en-US', {
                  month: 'short',
                  day: 'numeric',
                  year: 'numeric',
                });
                return (
                  <View
                    key={i}
                    style={[
                      styles.timelineRow,
                      i === result.recent_scans.length - 1 && styles.timelineRowLast,
                    ]}
                  >
                    <View style={[styles.timelineDot, { backgroundColor: color }]} />
                    <Text style={styles.timelineDate}>{date}</Text>
                    <Text style={[styles.timelineStatus, { color }]}>{label}</Text>
                  </View>
                );
              })}
          </View>
        )}

        <View style={{ height: 40 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0a0a0a' },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 32, gap: 16 },
  loadingText: { color: '#888', fontSize: 15, marginTop: 12 },
  errorText: { color: '#f87171', fontSize: 15, textAlign: 'center', lineHeight: 22 },
  retryButton: {
    backgroundColor: '#0a7ea4',
    borderRadius: 12,
    paddingHorizontal: 32,
    paddingVertical: 14,
  },
  retryText: { color: '#fff', fontWeight: '600' },
  content: { padding: 20, gap: 14 },
  pageTitle: { fontSize: 28, fontWeight: '700', color: '#fff', marginBottom: 4 },
  row: { flexDirection: 'row', gap: 12 },
  summaryCard: {
    backgroundColor: '#111',
    borderRadius: 14,
    borderWidth: 1,
    padding: 18,
    gap: 6,
  },
  dot: { width: 8, height: 8, borderRadius: 4 },
  summaryLabel: { fontSize: 11, color: '#555', textTransform: 'uppercase', letterSpacing: 1, fontWeight: '600' },
  summaryValue: { fontSize: 18, fontWeight: '700' },
  confidenceCard: {
    backgroundColor: '#111',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#2a2a2a',
    padding: 18,
    gap: 6,
  },
  confidenceNumber: { fontSize: 36, fontWeight: '800', color: '#fff', lineHeight: 42 },
  confidenceBar: {
    height: 4,
    backgroundColor: '#2a2a2a',
    borderRadius: 2,
    overflow: 'hidden',
    marginTop: 4,
  },
  confidenceFill: { height: '100%', borderRadius: 2 },
  insightCard: {
    backgroundColor: '#111',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#2a2a2a',
    padding: 18,
  },
  insightText: { fontSize: 14, color: '#bbb', lineHeight: 21 },
  statCard: {
    backgroundColor: '#111',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#2a2a2a',
    padding: 18,
    alignItems: 'center',
    gap: 4,
  },
  statValue: { fontSize: 32, fontWeight: '800', color: '#fff', lineHeight: 36 },
  statLabel: { fontSize: 11, color: '#555', textTransform: 'uppercase', letterSpacing: 1, fontWeight: '600', textAlign: 'center' },
  section: {
    backgroundColor: '#111',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#2a2a2a',
    padding: 18,
    gap: 0,
  },
  sectionTitle: { fontSize: 15, fontWeight: '600', color: '#fff', marginBottom: 12 },
  timelineRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#1a1a1a',
  },
  timelineRowLast: { borderBottomWidth: 0, paddingBottom: 0 },
  timelineDot: { width: 8, height: 8, borderRadius: 4 },
  timelineDate: { flex: 1, fontSize: 14, color: '#888' },
  timelineStatus: { fontSize: 14, fontWeight: '600' },
});
