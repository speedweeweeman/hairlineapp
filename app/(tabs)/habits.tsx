import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useAuth } from '@/context/auth';
import { supabase } from '@/lib/supabase';
import { planResultKey } from '@/app/(tabs)/plan';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

const DEFAULT_HABITS = ['Apply minoxidil', 'Scalp massage', 'Take supplement'];
const NOTIF_ENABLED_KEY = (userId: string) => `@hairy/notif_enabled_${userId}`;
const NOTIF_ID_KEY = (userId: string) => `@hairy/notif_id_${userId}`;

function todayRange() {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const end = new Date();
  end.setHours(23, 59, 59, 999);
  return { start: start.toISOString(), end: end.toISOString() };
}

function calcStreak(timestamps: string[]): number {
  if (timestamps.length === 0) return 0;

  const uniqueDates = [
    ...new Set(timestamps.map((t) => new Date(t).toDateString())),
  ];

  let streak = 0;
  const today = new Date();
  for (let i = 0; i < uniqueDates.length + 1; i++) {
    const expected = new Date(today);
    expected.setDate(today.getDate() - i);
    if (uniqueDates.includes(expected.toDateString())) {
      streak++;
    } else if (i === 0) {
      // today not completed yet — start counting from yesterday
      continue;
    } else {
      break;
    }
  }
  return streak;
}

export default function HabitsScreen() {
  const { user } = useAuth();

  const [loading, setLoading] = useState(true);
  const [habits, setHabits] = useState<string[]>(DEFAULT_HABITS);
  const [completed, setCompleted] = useState<Set<string>>(new Set());
  const [streak, setStreak] = useState(0);
  const [notifEnabled, setNotifEnabled] = useState(false);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [user])
  );

  const load = async () => {
    if (!user) return;
    setLoading(true);

    // Load habit types from saved plan result
    const savedPlan = await AsyncStorage.getItem(planResultKey(user.id));
    if (savedPlan) {
      try {
        const plan = JSON.parse(savedPlan);
        const recommended = plan.levels?.find(
          (l: any) => l.level === plan.recommended_level
        );
        if (recommended?.steps?.length) {
          setHabits(recommended.steps);
        }
      } catch {}
    }

    // Load today's completions
    const { start, end } = todayRange();
    const { data: todayData } = await supabase
      .from('habits')
      .select('type')
      .eq('user_id', user.id)
      .gte('completed_at', start)
      .lte('completed_at', end);
    setCompleted(new Set((todayData ?? []).map((r: any) => r.type)));

    // Load all completions for streak
    const { data: allData } = await supabase
      .from('habits')
      .select('completed_at')
      .eq('user_id', user.id)
      .order('completed_at', { ascending: false });
    setStreak(calcStreak((allData ?? []).map((r: any) => r.completed_at)));

    // Load notification preference
    const notifVal = await AsyncStorage.getItem(NOTIF_ENABLED_KEY(user.id));
    setNotifEnabled(notifVal === 'true');

    setLoading(false);
  };

  const toggleHabit = async (type: string) => {
    if (!user) return;
    const isDone = completed.has(type);

    if (isDone) {
      const { start } = todayRange();
      await supabase
        .from('habits')
        .delete()
        .eq('user_id', user.id)
        .eq('type', type)
        .gte('completed_at', start);
      setCompleted((prev) => {
        const next = new Set(prev);
        next.delete(type);
        return next;
      });
    } else {
      await supabase.from('habits').insert({
        user_id: user.id,
        type,
        completed_at: new Date().toISOString(),
      });
      setCompleted((prev) => new Set([...prev, type]));

      // Recalculate streak after new completion
      const { data: allData } = await supabase
        .from('habits')
        .select('completed_at')
        .eq('user_id', user.id)
        .order('completed_at', { ascending: false });
      setStreak(calcStreak((allData ?? []).map((r: any) => r.completed_at)));
    }
  };

  const toggleNotification = async (value: boolean) => {
    if (!user) return;

    if (value) {
      const { status } = await Notifications.requestPermissionsAsync();
      if (status !== 'granted') {
        return;
      }
      // Cancel any existing
      const existingId = await AsyncStorage.getItem(NOTIF_ID_KEY(user.id));
      if (existingId) {
        await Notifications.cancelScheduledNotificationAsync(existingId).catch(() => {});
      }

      const id = await Notifications.scheduleNotificationAsync({
        content: {
          title: 'Time for your weekly scan',
          body: 'Track your hairline progress in Hairline OS.',
        },
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.WEEKLY,
          weekday: 2, // Monday
          hour: 9,
          minute: 0,
        },
      });
      await AsyncStorage.setItem(NOTIF_ID_KEY(user.id), id);
      await AsyncStorage.setItem(NOTIF_ENABLED_KEY(user.id), 'true');
      setNotifEnabled(true);
    } else {
      const existingId = await AsyncStorage.getItem(NOTIF_ID_KEY(user.id));
      if (existingId) {
        await Notifications.cancelScheduledNotificationAsync(existingId).catch(() => {});
        await AsyncStorage.removeItem(NOTIF_ID_KEY(user.id));
      }
      await AsyncStorage.setItem(NOTIF_ENABLED_KEY(user.id), 'false');
      setNotifEnabled(false);
    }
  };

  const today = new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
  });

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.centeredFull}>
          <ActivityIndicator color="#0a7ea4" size="large" />
        </View>
      </SafeAreaView>
    );
  }

  const doneCount = habits.filter((h) => completed.has(h)).length;

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Text style={styles.pageTitle}>Habits</Text>

        {/* Streak card */}
        <View style={styles.streakCard}>
          <Text style={styles.streakNumber}>{streak}</Text>
          <Text style={styles.streakLabel}>day streak</Text>
          {streak === 0 && (
            <Text style={styles.streakHint}>Complete today's habits to start your streak</Text>
          )}
        </View>

        {/* Today's protocol */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Today's Protocol</Text>
            <Text style={styles.sectionDate}>{today}</Text>
          </View>
          <Text style={styles.sectionProgress}>
            {doneCount}/{habits.length} done
          </Text>

          <View style={styles.habitList}>
            {habits.map((habit, i) => {
              const done = completed.has(habit);
              return (
                <TouchableOpacity
                  key={i}
                  style={[styles.habitRow, i === habits.length - 1 && styles.habitRowLast]}
                  onPress={() => toggleHabit(habit)}
                  activeOpacity={0.7}
                >
                  <View style={[styles.checkbox, done && styles.checkboxDone]}>
                    {done && <Text style={styles.checkmark}>✓</Text>}
                  </View>
                  <Text style={[styles.habitText, done && styles.habitTextDone]}>{habit}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        {/* Reminders */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Reminders</Text>
          <View style={styles.notifRow}>
            <View style={styles.notifTextCol}>
              <Text style={styles.notifLabel}>Weekly scan reminder</Text>
              <Text style={styles.notifSub}>Every Monday at 9 AM</Text>
            </View>
            <Switch
              value={notifEnabled}
              onValueChange={toggleNotification}
              trackColor={{ false: '#2a2a2a', true: '#0a7ea440' }}
              thumbColor={notifEnabled ? '#0a7ea4' : '#555'}
            />
          </View>
        </View>

        {habits === DEFAULT_HABITS && (
          <View style={styles.noPlanNote}>
            <Text style={styles.noPlanNoteText}>
              Generate a plan in the Plan tab to get personalized habits.
            </Text>
          </View>
        )}

        <View style={{ height: 40 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0a0a0a' },
  centeredFull: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  content: { padding: 20, gap: 20 },
  pageTitle: { fontSize: 28, fontWeight: '700', color: '#fff' },
  streakCard: {
    backgroundColor: '#111',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#2a2a2a',
    alignItems: 'center',
    paddingVertical: 32,
    paddingHorizontal: 20,
    gap: 4,
  },
  streakNumber: { fontSize: 72, fontWeight: '800', color: '#fff', lineHeight: 80 },
  streakLabel: { fontSize: 18, color: '#555', fontWeight: '500' },
  streakHint: { fontSize: 13, color: '#333', marginTop: 8, textAlign: 'center' },
  section: {
    backgroundColor: '#111',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#2a2a2a',
    padding: 18,
    gap: 12,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
  },
  sectionTitle: { fontSize: 16, fontWeight: '600', color: '#fff' },
  sectionDate: { fontSize: 12, color: '#444' },
  sectionProgress: { fontSize: 13, color: '#0a7ea4', marginTop: -4 },
  habitList: { gap: 0 },
  habitRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#1a1a1a',
  },
  habitRowLast: { borderBottomWidth: 0, paddingBottom: 0 },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: '#333',
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxDone: { backgroundColor: '#0a7ea4', borderColor: '#0a7ea4' },
  checkmark: { color: '#fff', fontSize: 13, fontWeight: '700' },
  habitText: { flex: 1, fontSize: 15, color: '#bbb' },
  habitTextDone: { color: '#444', textDecorationLine: 'line-through' },
  notifRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  notifTextCol: { gap: 2 },
  notifLabel: { fontSize: 15, color: '#bbb' },
  notifSub: { fontSize: 12, color: '#444' },
  noPlanNote: {
    backgroundColor: '#111',
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: '#2a2a2a',
  },
  noPlanNoteText: { color: '#555', fontSize: 13, lineHeight: 18, textAlign: 'center' },
});
