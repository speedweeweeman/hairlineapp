import { useEffect, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
  ScrollView,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useAuth } from '@/context/auth';
import { supabase } from '@/lib/supabase';

type ScanCount = { count: number; lastDate: string | null };

export default function HomeScreen() {
  const { user, signOut } = useAuth();
  const router = useRouter();
  const [scanData, setScanData] = useState<ScanCount>({ count: 0, lastDate: null });

  useEffect(() => {
    loadScanData();
  }, []);

  const loadScanData = async () => {
    if (!user) return;
    const { data, error } = await supabase
      .from('scans')
      .select('created_at')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false });

    if (!error && data) {
      setScanData({
        count: data.length,
        lastDate: data[0]?.created_at ?? null,
      });
    }
  };

  const formatDate = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  };

  const handleSignOut = async () => {
    await signOut();
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <Text style={styles.appName}>Hairline OS</Text>
          <TouchableOpacity onPress={handleSignOut}>
            <Text style={styles.signOut}>Sign out</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.greeting}>
          <Text style={styles.greetingText}>Hey,</Text>
          <Text style={styles.email}>{user?.email}</Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardLabel}>Total Scans</Text>
          <Text style={styles.cardValue}>{scanData.count}</Text>
          {scanData.lastDate ? (
            <Text style={styles.cardSub}>Last scan: {formatDate(scanData.lastDate)}</Text>
          ) : (
            <Text style={styles.cardSub}>No scans yet</Text>
          )}
        </View>

        <TouchableOpacity
          style={styles.primaryButton}
          onPress={() => router.push('/(tabs)/camera')}>
          <Text style={styles.primaryButtonText}>
            {scanData.count === 0 ? 'Take Your First Scan' : 'Take New Scan'}
          </Text>
        </TouchableOpacity>

        {scanData.count > 0 && (
          <TouchableOpacity
            style={styles.secondaryButton}
            onPress={() => router.push('/(tabs)/gallery')}>
            <Text style={styles.secondaryButtonText}>View Gallery</Text>
          </TouchableOpacity>
        )}

        <View style={styles.infoBox}>
          <Text style={styles.infoTitle}>For best results</Text>
          <Text style={styles.infoItem}>• Same time of day each week</Text>
          <Text style={styles.infoItem}>• Consistent, natural lighting</Text>
          <Text style={styles.infoItem}>• Camera at eye level, front-facing</Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0a0a0a',
  },
  content: {
    padding: 24,
    gap: 16,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  appName: {
    fontSize: 18,
    fontWeight: '700',
    color: '#fff',
    letterSpacing: -0.5,
  },
  signOut: {
    fontSize: 14,
    color: '#666',
  },
  greeting: {
    marginBottom: 8,
  },
  greetingText: {
    fontSize: 28,
    fontWeight: '700',
    color: '#fff',
  },
  email: {
    fontSize: 14,
    color: '#666',
    marginTop: 2,
  },
  card: {
    backgroundColor: '#1a1a1a',
    borderRadius: 16,
    padding: 20,
    borderWidth: 1,
    borderColor: '#2a2a2a',
  },
  cardLabel: {
    fontSize: 12,
    color: '#666',
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 8,
  },
  cardValue: {
    fontSize: 48,
    fontWeight: '700',
    color: '#fff',
    lineHeight: 52,
  },
  cardSub: {
    fontSize: 13,
    color: '#666',
    marginTop: 4,
  },
  primaryButton: {
    backgroundColor: '#0a7ea4',
    borderRadius: 14,
    paddingVertical: 18,
    alignItems: 'center',
  },
  primaryButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  secondaryButton: {
    backgroundColor: '#1a1a1a',
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#2a2a2a',
  },
  secondaryButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '500',
  },
  infoBox: {
    backgroundColor: '#111',
    borderRadius: 14,
    padding: 16,
    gap: 6,
    marginTop: 8,
  },
  infoTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: '#888',
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 4,
  },
  infoItem: {
    fontSize: 14,
    color: '#555',
  },
});
