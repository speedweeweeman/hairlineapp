import * as Clipboard from 'expo-clipboard';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Dimensions,
  Image,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/context/auth';
import { useSubscription } from '@/context/subscription';
import { PYTHON_SERVICE_URL } from '@/constants/config';

const { width } = Dimensions.get('window');
const IMAGE_HEIGHT = Math.round((width - 32) * 0.62);

type ProjectionRecord = { timeframe: number; image_url: string };
type ScenarioKey = 'no_action' | 'moderate_care' | 'aggressive_care';
type ScenarioData = { projections: ProjectionRecord[]; loaded: boolean };

const SCENARIOS: { key: ScenarioKey; label: string; description: string }[] = [
  { key: 'no_action', label: 'No Action', description: 'Natural progression without treatment' },
  { key: 'moderate_care', label: 'Moderate Care', description: 'Minoxidil or similar treatment' },
  { key: 'aggressive_care', label: 'Aggressive', description: 'Full treatment protocol or transplant' },
];

const SCENARIO_COLORS: Record<ScenarioKey, string> = {
  no_action: '#f87171',
  moderate_care: '#facc15',
  aggressive_care: '#4ade80',
};

const EMPTY_SCENARIO: ScenarioData = { projections: [], loaded: false };

export default function ProjectionScreen() {
  const { scanId, scanImageUrl } = useLocalSearchParams<{ scanId: string; scanImageUrl: string }>();
  const router = useRouter();
  const { user } = useAuth();
  const { isSubscribed } = useSubscription();

  const [selectedScenario, setSelectedScenario] = useState<ScenarioKey>('no_action');
  const [scenarioData, setScenarioData] = useState<Record<ScenarioKey, ScenarioData>>({
    no_action: { ...EMPTY_SCENARIO },
    moderate_care: { ...EMPTY_SCENARIO },
    aggressive_care: { ...EMPTY_SCENARIO },
  });
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sharing, setSharing] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);

  useEffect(() => {
    if (scanId) loadExisting();
  }, [scanId]);

  const loadExisting = async () => {
    const { data } = await supabase
      .from('projections')
      .select('scenario, timeframe, image_url')
      .eq('base_scan_id', scanId);

    if (!data?.length) return;

    const grouped: Record<ScenarioKey, ProjectionRecord[]> = {
      no_action: [],
      moderate_care: [],
      aggressive_care: [],
    };
    for (const row of data) {
      if (row.scenario in grouped) {
        grouped[row.scenario as ScenarioKey].push({ timeframe: row.timeframe, image_url: row.image_url });
      }
    }

    setScenarioData({
      no_action: { projections: grouped.no_action, loaded: grouped.no_action.length === 3 },
      moderate_care: { projections: grouped.moderate_care, loaded: grouped.moderate_care.length === 3 },
      aggressive_care: { projections: grouped.aggressive_care, loaded: grouped.aggressive_care.length === 3 },
    });
  };

  const handleGenerate = async () => {
    if (!user?.id || !scanId) return;
    setGenerating(true);
    setError(null);

    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 360000);
      const res = await fetch(`${PYTHON_SERVICE_URL}/generate-projection`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scan_id: scanId, scenario: selectedScenario, user_id: user.id }),
        signal: controller.signal,
      });
      clearTimeout(timer);

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || 'Generation failed');
      }

      const json = await res.json();
      setScenarioData((prev) => ({
        ...prev,
        [selectedScenario]: { projections: json.projections, loaded: true },
      }));
    } catch (e: any) {
      const msg = e?.message;
      setError(msg === 'AbortError' || e?.name === 'AbortError' ? 'Request timed out. Try again.' : (msg || 'Generation failed.'));
    } finally {
      setGenerating(false);
    }
  };

  const handleShare = async () => {
    const url12m = byTimeframe[12];
    if (!url12m) return;
    setSharing(true);
    try {
      const res = await fetch(`${PYTHON_SERVICE_URL}/watermark-image`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image_url: url12m }),
      });
      if (!res.ok) throw new Error('Watermark request failed');
      const { image_base64 } = await res.json();

      const tempPath = `${FileSystem.cacheDirectory}hairline_projection_12m.jpg`;
      await FileSystem.writeAsStringAsync(tempPath, image_base64, {
        encoding: FileSystem.EncodingType.Base64,
      });

      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(tempPath, {
          mimeType: 'image/jpeg',
          UTI: 'public.jpeg',
          dialogTitle: 'Share your hairline projection',
        });
      } else {
        Alert.alert('Sharing unavailable', 'Your device does not support sharing.');
      }
    } catch {
      Alert.alert('Share failed', 'Could not prepare the image for sharing. Make sure the Python service is running.');
    } finally {
      setSharing(false);
    }
  };

  const handleCopyLink = async () => {
    const url12m = byTimeframe[12];
    if (!url12m) return;
    await Clipboard.setStringAsync(url12m);
    setLinkCopied(true);
    setTimeout(() => setLinkCopied(false), 2000);
  };

  const currentData = scenarioData[selectedScenario];
  const byTimeframe: Record<number, string> = {};
  for (const p of currentData.projections) {
    byTimeframe[p.timeframe] = p.image_url;
  }

  const isGenerated = currentData.loaded;
  const accentColor = SCENARIO_COLORS[selectedScenario];
  const has12m = !!byTimeframe[12];

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
          <Text style={styles.backText}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Future Projection</Text>
        <View style={{ width: 70 }} />
      </View>

      <View style={styles.scenarioRow}>
        {SCENARIOS.map((s) => {
          const active = selectedScenario === s.key;
          const c = SCENARIO_COLORS[s.key];
          return (
            <TouchableOpacity
              key={s.key}
              onPress={() => setSelectedScenario(s.key)}
              style={[styles.scenarioPill, active && { backgroundColor: c + '18', borderColor: c }]}
            >
              <Text style={[styles.scenarioPillText, active && { color: c }]}>{s.label}</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        <Text style={styles.scenarioDesc}>
          {SCENARIOS.find((s) => s.key === selectedScenario)?.description}
        </Text>

        <TimelineCard label="TODAY" dotColor="#555" labelColor="#555">
          <Image source={{ uri: scanImageUrl }} style={styles.image} resizeMode="cover" />
        </TimelineCard>

        {([3, 6, 12] as const).map((tf) => (
          <TimelineCard
            key={tf}
            label={`${tf} MONTHS`}
            dotColor={isGenerated ? accentColor : '#333'}
            labelColor={isGenerated ? accentColor : '#555'}
          >
            {generating && !byTimeframe[tf] ? (
              <View style={styles.placeholderCard}>
                <ActivityIndicator color="#0a7ea4" />
                <Text style={styles.placeholderText}>Generating…</Text>
              </View>
            ) : byTimeframe[tf] ? (
              <Image source={{ uri: byTimeframe[tf] }} style={styles.image} resizeMode="cover" />
            ) : (
              <View style={styles.placeholderCard}>
                <Text style={styles.placeholderText}>
                  {isSubscribed ? 'Not generated yet' : 'Pro required'}
                </Text>
              </View>
            )}
          </TimelineCard>
        ))}

        {error && (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        )}

        <View style={{ height: 140 }} />
      </ScrollView>

      <View style={styles.footer}>
        {!isSubscribed ? (
          <TouchableOpacity style={styles.generateButton} onPress={() => router.push('/paywall')}>
            <Text style={styles.generateButtonText}>Unlock Projections — Go Pro</Text>
          </TouchableOpacity>
        ) : isGenerated && !generating ? (
          <>
            {has12m && (
              <View style={styles.shareRow}>
                <TouchableOpacity
                  style={[styles.shareButton, sharing && styles.generateButtonDisabled]}
                  onPress={handleShare}
                  disabled={sharing}
                >
                  {sharing ? (
                    <ActivityIndicator color="#fff" size="small" />
                  ) : (
                    <Text style={styles.shareButtonText}>Share 12mo Projection</Text>
                  )}
                </TouchableOpacity>
                <TouchableOpacity style={styles.copyLinkButton} onPress={handleCopyLink}>
                  <Text style={styles.copyLinkText}>
                    {linkCopied ? 'Copied!' : 'Copy Link'}
                  </Text>
                </TouchableOpacity>
              </View>
            )}
            <TouchableOpacity style={styles.regenerateButton} onPress={handleGenerate}>
              <Text style={styles.regenerateText}>Regenerate</Text>
            </TouchableOpacity>
          </>
        ) : (
          <TouchableOpacity
            style={[styles.generateButton, generating && styles.generateButtonDisabled]}
            onPress={handleGenerate}
            disabled={generating}
          >
            {generating ? (
              <View style={styles.generatingRow}>
                <ActivityIndicator color="#fff" size="small" />
                <Text style={styles.generateButtonText}>Generating (~30s)…</Text>
              </View>
            ) : (
              <Text style={styles.generateButtonText}>
                Generate {SCENARIOS.find((s) => s.key === selectedScenario)?.label} Projection
              </Text>
            )}
          </TouchableOpacity>
        )}
      </View>
    </SafeAreaView>
  );
}

function TimelineCard({
  label,
  dotColor,
  labelColor,
  children,
}: {
  label: string;
  dotColor: string;
  labelColor: string;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.timelineCard}>
      <View style={styles.timelineLabelRow}>
        <View style={[styles.timelineDot, { backgroundColor: dotColor }]} />
        <Text style={[styles.timelineLabelText, { color: labelColor }]}>{label}</Text>
      </View>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0a0a0a' },
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
  scenarioRow: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingBottom: 12,
    gap: 8,
  },
  scenarioPill: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#2a2a2a',
    alignItems: 'center',
  },
  scenarioPillText: { color: '#555', fontSize: 12, fontWeight: '600' },
  scrollContent: { paddingHorizontal: 16 },
  scenarioDesc: { color: '#555', fontSize: 13, textAlign: 'center', marginBottom: 16 },
  timelineCard: { marginBottom: 20 },
  timelineLabelRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  timelineDot: { width: 8, height: 8, borderRadius: 4 },
  timelineLabelText: { fontSize: 11, fontWeight: '700', letterSpacing: 1.5 },
  image: { width: width - 32, height: IMAGE_HEIGHT, borderRadius: 12, backgroundColor: '#111' },
  placeholderCard: {
    width: width - 32,
    height: IMAGE_HEIGHT,
    borderRadius: 12,
    backgroundColor: '#0f0f0f',
    borderWidth: 1,
    borderColor: '#1a1a1a',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 12,
  },
  placeholderText: { color: '#333', fontSize: 13 },
  errorBox: {
    backgroundColor: '#1a0a0a',
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: '#f8717130',
    marginBottom: 16,
  },
  errorText: { color: '#f87171', fontSize: 13, lineHeight: 18 },
  footer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 20,
    paddingBottom: 34,
    paddingTop: 16,
    backgroundColor: '#0a0a0a',
    borderTopWidth: 1,
    borderTopColor: '#1a1a1a',
    gap: 10,
  },
  generateButton: {
    backgroundColor: '#0a7ea4',
    borderRadius: 14,
    paddingVertical: 18,
    alignItems: 'center',
  },
  generateButtonDisabled: { opacity: 0.6 },
  generateButtonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  generatingRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  shareRow: { flexDirection: 'row', gap: 10, alignItems: 'center' },
  shareButton: {
    flex: 1,
    backgroundColor: '#0a7ea4',
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  shareButtonText: { color: '#fff', fontSize: 15, fontWeight: '600' },
  copyLinkButton: {
    backgroundColor: '#1a1a1a',
    borderRadius: 14,
    paddingVertical: 16,
    paddingHorizontal: 16,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#2a2a2a',
  },
  copyLinkText: { color: '#bbb', fontSize: 14, fontWeight: '600' },
  regenerateButton: { paddingVertical: 10, alignItems: 'center' },
  regenerateText: { color: '#444', fontSize: 14 },
});
