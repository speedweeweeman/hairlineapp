import { useRouter } from 'expo-router';
import { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { PACKAGE_TYPE, PurchasesPackage } from 'react-native-purchases';
import { useSubscription } from '@/context/subscription';

const FEATURES = [
  'Unlimited hairline scans',
  'AI future projections (3, 6 & 12 months)',
  'Personalized treatment plan',
  'Progress intelligence & trends',
  'Priority access to new features',
];

export default function PaywallScreen() {
  const router = useRouter();
  const { packages, purchase, restore, loading } = useSubscription();

  const annualPkg = packages.find((p) => p.packageType === PACKAGE_TYPE.ANNUAL) ?? null;
  const monthlyPkg = packages.find((p) => p.packageType === PACKAGE_TYPE.MONTHLY) ?? null;

  const [selectedPkg, setSelectedPkg] = useState<PurchasesPackage | null>(
    annualPkg ?? monthlyPkg ?? null
  );
  const [purchasing, setPurchasing] = useState(false);
  const [restoring, setRestoring] = useState(false);

  const annualMonthlyCost = annualPkg
    ? (annualPkg.product.price / 12).toFixed(2)
    : null;

  const handlePurchase = async () => {
    const pkg = selectedPkg ?? annualPkg ?? monthlyPkg;
    if (!pkg) {
      Alert.alert(
        'Not available',
        'Subscription products could not be loaded. Make sure you have set your RevenueCat API key and are running an EAS dev build.'
      );
      return;
    }
    setPurchasing(true);
    const result = await purchase(pkg);
    setPurchasing(false);
    if (result === 'success') {
      router.back();
    } else if (result === 'error') {
      Alert.alert('Purchase failed', 'Something went wrong. Please try again.');
    }
    // 'cancelled' — do nothing, user dismissed the sheet
  };

  const handleRestore = async () => {
    setRestoring(true);
    const ok = await restore();
    setRestoring(false);
    if (ok) {
      router.back();
    } else {
      Alert.alert('No purchases found', 'We could not find any previous purchases for this account.');
    }
  };

  const displayPkg = selectedPkg ?? annualPkg ?? monthlyPkg;

  return (
    <SafeAreaView style={styles.container}>
      <TouchableOpacity style={styles.closeButton} onPress={() => router.back()}>
        <Text style={styles.closeText}>✕</Text>
      </TouchableOpacity>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Text style={styles.badge}>HAIRLINE OS PRO</Text>
        <Text style={styles.headline}>Know your hair.{'\n'}Own your future.</Text>
        <Text style={styles.sub}>
          Unlock the full toolkit — unlimited scans, AI projections, and a plan built around you.
        </Text>

        <View style={styles.featureList}>
          {FEATURES.map((f) => (
            <View key={f} style={styles.featureRow}>
              <Text style={styles.featureCheck}>✓</Text>
              <Text style={styles.featureText}>{f}</Text>
            </View>
          ))}
        </View>

        {packages.length > 0 ? (
          <View style={styles.packageSection}>
            {annualPkg && (
              <TouchableOpacity
                style={[
                  styles.packageCard,
                  selectedPkg?.packageType === PACKAGE_TYPE.ANNUAL && styles.packageCardActive,
                ]}
                onPress={() => setSelectedPkg(annualPkg)}
              >
                <View style={styles.bestValueBadge}>
                  <Text style={styles.bestValueText}>BEST VALUE</Text>
                </View>
                <View style={styles.packageRow}>
                  <View>
                    <Text style={styles.packageTitle}>Annual</Text>
                    {annualMonthlyCost && (
                      <Text style={styles.packageSub}>${annualMonthlyCost}/month</Text>
                    )}
                  </View>
                  <Text style={styles.packagePrice}>{annualPkg.product.priceString}/yr</Text>
                </View>
              </TouchableOpacity>
            )}

            {monthlyPkg && (
              <TouchableOpacity
                style={[
                  styles.packageCard,
                  selectedPkg?.packageType === PACKAGE_TYPE.MONTHLY && styles.packageCardActive,
                ]}
                onPress={() => setSelectedPkg(monthlyPkg)}
              >
                <View style={styles.packageRow}>
                  <Text style={styles.packageTitle}>Monthly</Text>
                  <Text style={styles.packagePrice}>{monthlyPkg.product.priceString}/mo</Text>
                </View>
              </TouchableOpacity>
            )}
          </View>
        ) : (
          <View style={styles.packageSection}>
            <View style={styles.packageCard}>
              <Text style={styles.packageTitle}>Hairline OS Pro</Text>
              <Text style={styles.packageSub}>
                {loading ? 'Loading pricing…' : 'Configure RevenueCat to display pricing'}
              </Text>
            </View>
          </View>
        )}

        <View style={{ height: 140 }} />
      </ScrollView>

      <View style={styles.footer}>
        <TouchableOpacity
          style={[styles.ctaButton, (purchasing || loading) && styles.ctaButtonDisabled]}
          onPress={handlePurchase}
          disabled={purchasing || loading}
        >
          {purchasing ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.ctaText}>
              {displayPkg
                ? `Subscribe — ${displayPkg.product.priceString}`
                : 'Subscribe'}
            </Text>
          )}
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.restoreButton}
          onPress={handleRestore}
          disabled={restoring}
        >
          <Text style={styles.restoreText}>
            {restoring ? 'Restoring…' : 'Restore Purchases'}
          </Text>
        </TouchableOpacity>

        <Text style={styles.legalText}>
          Subscription renews automatically. Cancel anytime in iOS Settings.
        </Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0a0a0a' },
  closeButton: {
    position: 'absolute',
    top: 56,
    right: 20,
    zIndex: 10,
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#1a1a1a',
    borderRadius: 16,
  },
  closeText: { color: '#666', fontSize: 14, fontWeight: '600' },
  content: { paddingHorizontal: 24, paddingTop: 72, gap: 24 },
  badge: {
    color: '#0a7ea4',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 2,
    textAlign: 'center',
  },
  headline: {
    fontSize: 34,
    fontWeight: '800',
    color: '#fff',
    textAlign: 'center',
    lineHeight: 42,
  },
  sub: {
    fontSize: 15,
    color: '#666',
    textAlign: 'center',
    lineHeight: 22,
  },
  featureList: {
    backgroundColor: '#111',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#2a2a2a',
    padding: 20,
    gap: 14,
  },
  featureRow: { flexDirection: 'row', gap: 12, alignItems: 'flex-start' },
  featureCheck: { color: '#0a7ea4', fontSize: 16, fontWeight: '700', width: 20 },
  featureText: { flex: 1, fontSize: 15, color: '#bbb', lineHeight: 20 },
  packageSection: { gap: 10 },
  packageCard: {
    backgroundColor: '#111',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#2a2a2a',
    padding: 18,
    gap: 8,
  },
  packageCardActive: { borderColor: '#0a7ea4', backgroundColor: '#0a7ea410' },
  bestValueBadge: {
    backgroundColor: '#0a7ea420',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
    alignSelf: 'flex-start',
  },
  bestValueText: { color: '#0a7ea4', fontSize: 10, fontWeight: '700', letterSpacing: 1 },
  packageRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  packageTitle: { fontSize: 17, fontWeight: '700', color: '#fff' },
  packagePrice: { fontSize: 15, color: '#bbb', fontWeight: '600' },
  packageSub: { fontSize: 13, color: '#555', marginTop: 2 },
  footer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 24,
    paddingBottom: 40,
    paddingTop: 16,
    backgroundColor: '#0a0a0a',
    borderTopWidth: 1,
    borderTopColor: '#1a1a1a',
    gap: 10,
    alignItems: 'center',
  },
  ctaButton: {
    backgroundColor: '#0a7ea4',
    borderRadius: 16,
    paddingVertical: 18,
    alignItems: 'center',
    width: '100%',
  },
  ctaButtonDisabled: { opacity: 0.6 },
  ctaText: { color: '#fff', fontSize: 17, fontWeight: '700' },
  restoreButton: { paddingVertical: 4 },
  restoreText: { color: '#555', fontSize: 14 },
  legalText: { fontSize: 11, color: '#2a2a2a', textAlign: 'center', lineHeight: 16 },
});
