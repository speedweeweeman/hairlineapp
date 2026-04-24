import AsyncStorage from '@react-native-async-storage/async-storage';
import { useFocusEffect, useRouter } from 'expo-router';
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
import { supabase } from '@/lib/supabase';
import { PYTHON_SERVICE_URL } from '@/constants/config';

const profileKey = (userId: string) => `@hairy/plan_profile_${userId}`;
export const planResultKey = (userId: string) => `@hairy/plan_result_${userId}`;

type RiskTolerance = 'low' | 'medium' | 'high';

type Profile = {
  ageKey: string;
  age: number;
  familyHistory: boolean;
  riskTolerance: RiskTolerance;
};

type PlanLevel = {
  level: number;
  title: string;
  subtitle: string;
  active: boolean;
  steps: string[];
};

type PlanResult = {
  recommended_level: number;
  urgency: string;
  levels: PlanLevel[];
  insight: string;
};

type ScreenState = 'loading' | 'no_scan' | 'intake' | 'generating' | 'result' | 'error';

const AGE_OPTIONS = [
  { key: 'u25', label: 'Under 25', value: 22 },
  { key: '25-34', label: '25–34', value: 30 },
  { key: '35-44', label: '35–44', value: 40 },
  { key: '45p', label: '45+', value: 50 },
];

const URGENCY_COLORS: Record<string, string> = {
  low: '#4ade80',
  moderate: '#facc15',
  high: '#f87171',
};

export default function PlanScreen() {
  const { user } = useAuth();
  const router = useRouter();

  const [screenState, setScreenState] = useState<ScreenState>('loading');
  const [profile, setProfile] = useState<Profile | null>(null);
  const [plan, setPlan] = useState<PlanResult | null>(null);
  const [latestStatus, setLatestStatus] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState('');

  // Intake form fields
  const [selectedAge, setSelectedAge] = useState('25-34');
  const [familyHistory, setFamilyHistory] = useState(false);
  const [riskTolerance, setRiskTolerance] = useState<RiskTolerance>('medium');

  useFocusEffect(
    useCallback(() => {
      init();
    }, [user])
  );

  const init = async () => {
    setScreenState('loading');

    let status: string | null = null;
    if (user) {
      const { data } = await supabase
        .from('scans')
        .select('hairline_status')
        .eq('user_id', user.id)
        .not('hairline_status', 'is', null)
        .order('created_at', { ascending: false })
        .limit(1)
        .single();
      status = data?.hairline_status ?? null;
      setLatestStatus(status);
    }

    if (!status) {
      setScreenState('no_scan');
      return;
    }

    const saved = await AsyncStorage.getItem(profileKey(user!.id));
    if (saved) {
      const p = JSON.parse(saved) as Profile;
      setProfile(p);
      setSelectedAge(p.ageKey);
      setFamilyHistory(p.familyHistory);
      setRiskTolerance(p.riskTolerance);
      await generatePlan(p, status);
    } else {
      setScreenState('intake');
    }
  };

  const generatePlan = async (p: Profile, status: string | null) => {
    setScreenState('generating');
    setErrorMsg('');
    try {
      const res = await fetch(`${PYTHON_SERVICE_URL}/generate-plan`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          age: p.age,
          family_history: p.familyHistory,
          risk_tolerance: p.riskTolerance,
          hairline_status: status,
        }),
      });
      if (!res.ok) throw new Error('Plan generation failed');
      const json = await res.json();
      setPlan(json);
      await AsyncStorage.setItem(planResultKey(user!.id), JSON.stringify(json));
      setScreenState('result');
    } catch (e: any) {
      setErrorMsg(e.message || 'Failed to generate plan. Is the Python service running?');
      setScreenState('error');
    }
  };

  const handleSubmitIntake = async () => {
    const ageOption = AGE_OPTIONS.find((a) => a.key === selectedAge) ?? AGE_OPTIONS[1];
    const p: Profile = {
      ageKey: selectedAge,
      age: ageOption.value,
      familyHistory,
      riskTolerance,
    };
    await AsyncStorage.setItem(profileKey(user!.id), JSON.stringify(p));
    setProfile(p);
    await generatePlan(p, latestStatus);
  };

  const handleEdit = () => {
    if (profile) {
      setSelectedAge(profile.ageKey);
      setFamilyHistory(profile.familyHistory);
      setRiskTolerance(profile.riskTolerance);
    }
    setScreenState('intake');
  };

  if (screenState === 'loading' || screenState === 'generating') {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.centeredFull}>
          <ActivityIndicator color="#0a7ea4" size="large" />
          <Text style={styles.loadingText}>
            {screenState === 'generating' ? 'Building your plan…' : 'Loading…'}
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  if (screenState === 'error') {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.centeredFull}>
          <Text style={styles.errorText}>{errorMsg}</Text>
          <TouchableOpacity
            style={styles.retryButton}
            onPress={() => profile && generatePlan(profile, latestStatus)}
          >
            <Text style={styles.retryText}>Retry</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.editLink} onPress={handleEdit}>
            <Text style={styles.editLinkText}>Edit Profile</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  if (screenState === 'no_scan') {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.centeredFull}>
          <Text style={styles.noScanTitle}>Scan First</Text>
          <Text style={styles.noScanBody}>
            Your plan is built from your hairline scan. Take a photo and get it analyzed before generating your protocol.
          </Text>
          <TouchableOpacity
            style={styles.scanButton}
            onPress={() => router.push('/(tabs)/camera')}
          >
            <Text style={styles.scanButtonText}>Take a Scan</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  if (screenState === 'intake') {
    return (
      <SafeAreaView style={styles.container}>
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <Text style={styles.pageTitle}>Your Plan</Text>
          <Text style={styles.pageSub}>
            Answer 3 quick questions to get your personalized protocol.
          </Text>

          {latestStatus && (
            <View style={styles.scanInfoBox}>
              <Text style={styles.scanInfoText}>Using your latest hairline scan result</Text>
            </View>
          )}

          <View style={styles.section}>
            <Text style={styles.sectionLabel}>Your Age</Text>
            <View style={styles.optionRow}>
              {AGE_OPTIONS.map((opt) => (
                <TouchableOpacity
                  key={opt.key}
                  style={[styles.optionPill, selectedAge === opt.key && styles.optionPillActive]}
                  onPress={() => setSelectedAge(opt.key)}
                >
                  <Text
                    style={[
                      styles.optionPillText,
                      selectedAge === opt.key && styles.optionPillTextActive,
                    ]}
                  >
                    {opt.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionLabel}>Family History of Hair Loss?</Text>
            <Text style={styles.sectionHint}>Father, paternal grandfather, etc.</Text>
            <View style={styles.binaryRow}>
              <TouchableOpacity
                style={[styles.binaryPill, !familyHistory && styles.binaryPillActive]}
                onPress={() => setFamilyHistory(false)}
              >
                <Text style={[styles.binaryPillText, !familyHistory && styles.binaryPillTextActive]}>
                  No
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.binaryPill, familyHistory && styles.binaryPillActive]}
                onPress={() => setFamilyHistory(true)}
              >
                <Text style={[styles.binaryPillText, familyHistory && styles.binaryPillTextActive]}>
                  Yes
                </Text>
              </TouchableOpacity>
            </View>
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionLabel}>How proactive do you want to be?</Text>
            <View style={styles.riskRow}>
              {(
                [
                  { key: 'low', label: 'Conservative', sub: 'Lifestyle changes only' },
                  { key: 'medium', label: 'Moderate', sub: 'OTC treatments' },
                  { key: 'high', label: 'Aggressive', sub: 'All options available' },
                ] as const
              ).map((opt) => (
                <TouchableOpacity
                  key={opt.key}
                  style={[styles.riskCard, riskTolerance === opt.key && styles.riskCardActive]}
                  onPress={() => setRiskTolerance(opt.key)}
                >
                  <Text
                    style={[styles.riskLabel, riskTolerance === opt.key && styles.riskLabelActive]}
                  >
                    {opt.label}
                  </Text>
                  <Text style={styles.riskSub}>{opt.sub}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          <TouchableOpacity style={styles.generateButton} onPress={handleSubmitIntake}>
            <Text style={styles.generateButtonText}>Generate My Plan</Text>
          </TouchableOpacity>

          <View style={{ height: 40 }} />
        </ScrollView>
      </SafeAreaView>
    );
  }

  // result state
  if (!plan) return null;
  const urgencyColor = URGENCY_COLORS[plan.urgency] ?? '#fff';

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Text style={styles.pageTitle}>Your Plan</Text>

        <View style={[styles.insightCard, { borderColor: urgencyColor + '40' }]}>
          <View style={[styles.insightDot, { backgroundColor: urgencyColor }]} />
          <Text style={styles.insightText}>{plan.insight}</Text>
        </View>

        {plan.levels.map((level) => (
          <LevelCard key={level.level} level={level} recommendedLevel={plan.recommended_level} />
        ))}

        <TouchableOpacity style={styles.editButton} onPress={handleEdit}>
          <Text style={styles.editButtonText}>Update Profile</Text>
        </TouchableOpacity>

        <View style={{ height: 40 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

function LevelCard({
  level,
  recommendedLevel,
}: {
  level: PlanLevel;
  recommendedLevel: number;
}) {
  const isRecommended = level.level === recommendedLevel;

  return (
    <View style={[styles.levelCard, !level.active && styles.levelCardDimmed]}>
      <View style={styles.levelHeader}>
        <View style={styles.levelBadgeRow}>
          <View style={[styles.levelNumBadge, !level.active && styles.levelNumBadgeDimmed]}>
            <Text style={[styles.levelNum, !level.active && styles.levelNumDimmed]}>
              Level {level.level}
            </Text>
          </View>
          {isRecommended && (
            <View style={styles.recommendedBadge}>
              <Text style={styles.recommendedBadgeText}>Recommended</Text>
            </View>
          )}
        </View>
        <Text style={[styles.levelTitle, !level.active && styles.levelTitleDimmed]}>
          {level.title}
        </Text>
        <Text style={styles.levelSubtitle}>{level.subtitle}</Text>
      </View>

      <View style={styles.stepsContainer}>
        {level.steps.map((step, i) => (
          <View
            key={i}
            style={[styles.stepRow, i === level.steps.length - 1 && styles.stepRowLast]}
          >
            <View style={[styles.stepDot, !level.active && styles.stepDotDimmed]} />
            <Text style={[styles.stepText, !level.active && styles.stepTextDimmed]}>{step}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0a0a0a' },
  centeredFull: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
    gap: 16,
  },
  loadingText: { color: '#888', fontSize: 15, marginTop: 12 },
  content: { padding: 20, gap: 16 },
  pageTitle: { fontSize: 28, fontWeight: '700', color: '#fff', marginBottom: 4 },
  pageSub: { fontSize: 15, color: '#555', lineHeight: 22, marginBottom: 4 },
  scanInfoBox: {
    backgroundColor: '#0a7ea415',
    borderRadius: 10,
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: '#0a7ea430',
  },
  scanInfoText: { color: '#0a7ea4', fontSize: 13 },
  section: { gap: 10 },
  sectionLabel: { fontSize: 16, fontWeight: '600', color: '#fff' },
  sectionHint: { fontSize: 13, color: '#555', marginTop: -4 },
  optionRow: { flexDirection: 'row', gap: 8 },
  optionPill: {
    flex: 1,
    paddingVertical: 11,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#2a2a2a',
    alignItems: 'center',
    backgroundColor: '#111',
  },
  optionPillActive: { backgroundColor: '#0a7ea420', borderColor: '#0a7ea4' },
  optionPillText: { color: '#555', fontSize: 12, fontWeight: '600' },
  optionPillTextActive: { color: '#0a7ea4' },
  binaryRow: { flexDirection: 'row', gap: 12 },
  binaryPill: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#2a2a2a',
    alignItems: 'center',
    backgroundColor: '#111',
  },
  binaryPillActive: { backgroundColor: '#0a7ea420', borderColor: '#0a7ea4' },
  binaryPillText: { color: '#555', fontSize: 16, fontWeight: '600' },
  binaryPillTextActive: { color: '#0a7ea4' },
  riskRow: { gap: 10 },
  riskCard: {
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#2a2a2a',
    backgroundColor: '#111',
  },
  riskCardActive: { backgroundColor: '#0a7ea415', borderColor: '#0a7ea4' },
  riskLabel: { fontSize: 15, fontWeight: '600', color: '#555' },
  riskLabelActive: { color: '#0a7ea4' },
  riskSub: { fontSize: 13, color: '#444', marginTop: 2 },
  generateButton: {
    backgroundColor: '#0a7ea4',
    borderRadius: 14,
    paddingVertical: 18,
    alignItems: 'center',
    marginTop: 8,
  },
  generateButtonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  insightCard: {
    backgroundColor: '#111',
    borderRadius: 14,
    padding: 18,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    borderWidth: 1,
  },
  insightDot: { width: 8, height: 8, borderRadius: 4, marginTop: 6 },
  insightText: { flex: 1, fontSize: 15, color: '#bbb', lineHeight: 22 },
  levelCard: {
    backgroundColor: '#111',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#2a2a2a',
    overflow: 'hidden',
  },
  levelCardDimmed: { opacity: 0.35 },
  levelHeader: {
    padding: 18,
    gap: 4,
    borderBottomWidth: 1,
    borderBottomColor: '#1a1a1a',
  },
  levelBadgeRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 },
  levelNumBadge: {
    backgroundColor: '#0a7ea430',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  levelNumBadgeDimmed: { backgroundColor: '#1a1a1a' },
  levelNum: { fontSize: 11, fontWeight: '700', color: '#0a7ea4', letterSpacing: 0.5 },
  levelNumDimmed: { color: '#444' },
  recommendedBadge: {
    backgroundColor: '#4ade8020',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  recommendedBadgeText: { fontSize: 11, fontWeight: '700', color: '#4ade80', letterSpacing: 0.5 },
  levelTitle: { fontSize: 19, fontWeight: '700', color: '#fff' },
  levelTitleDimmed: { color: '#555' },
  levelSubtitle: { fontSize: 13, color: '#555' },
  stepsContainer: { paddingHorizontal: 18, paddingVertical: 14 },
  stepRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#1a1a1a',
  },
  stepRowLast: { borderBottomWidth: 0, paddingBottom: 0 },
  stepDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#0a7ea4',
    marginTop: 7,
  },
  stepDotDimmed: { backgroundColor: '#2a2a2a' },
  stepText: { flex: 1, fontSize: 14, color: '#bbb', lineHeight: 20 },
  stepTextDimmed: { color: '#333' },
  editButton: { paddingVertical: 14, alignItems: 'center' },
  editButtonText: { color: '#444', fontSize: 14 },
  errorText: { color: '#f87171', fontSize: 15, textAlign: 'center', lineHeight: 22 },
  retryButton: {
    backgroundColor: '#0a7ea4',
    borderRadius: 12,
    paddingHorizontal: 32,
    paddingVertical: 14,
  },
  retryText: { color: '#fff', fontWeight: '600' },
  editLink: { paddingVertical: 8 },
  editLinkText: { color: '#555', fontSize: 14 },
  noScanTitle: { fontSize: 26, fontWeight: '700', color: '#fff', marginBottom: 12, textAlign: 'center' },
  noScanBody: { fontSize: 15, color: '#555', lineHeight: 22, textAlign: 'center', marginBottom: 32, paddingHorizontal: 8 },
  scanButton: {
    backgroundColor: '#0a7ea4',
    borderRadius: 14,
    paddingVertical: 18,
    paddingHorizontal: 48,
    alignItems: 'center',
  },
  scanButtonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
});
