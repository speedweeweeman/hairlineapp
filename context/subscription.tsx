import Purchases, {
  CustomerInfo,
  PACKAGE_TYPE,
  PURCHASES_ERROR_CODE,
  PurchasesPackage,
} from 'react-native-purchases';
import { createContext, useContext, useEffect, useState, PropsWithChildren } from 'react';
import { REVENUECAT_API_KEY } from '@/constants/config';
import { useAuth } from './auth';

type PurchaseResult = 'success' | 'cancelled' | 'error';

type SubscriptionContextType = {
  isSubscribed: boolean;
  loading: boolean;
  packages: PurchasesPackage[];
  purchase: (pkg: PurchasesPackage) => Promise<PurchaseResult>;
  restore: () => Promise<boolean>;
};

const SubscriptionContext = createContext<SubscriptionContextType | null>(null);

export function SubscriptionProvider({ children }: PropsWithChildren) {
  const { user } = useAuth();
  const [isSubscribed, setIsSubscribed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [packages, setPackages] = useState<PurchasesPackage[]>([]);

  useEffect(() => {
    init();
  }, []);

  useEffect(() => {
    if (!user) return;
    try {
      Purchases.logIn(user.id).catch(() => {});
    } catch {}
  }, [user?.id]);

  const init = async () => {
    if (!REVENUECAT_API_KEY) {
      setLoading(false);
      return;
    }
    try {
      Purchases.configure({ apiKey: REVENUECAT_API_KEY });
      const [info, offerings] = await Promise.all([
        Purchases.getCustomerInfo(),
        Purchases.getOfferings(),
      ]);
      setIsSubscribed(Object.keys(info.entitlements.active).length > 0);
      if (offerings.current?.availablePackages) {
        setPackages(offerings.current.availablePackages);
      }
    } catch {
      // RevenueCat native module unavailable (Expo Go) or not yet configured
    } finally {
      setLoading(false);
    }
  };

  const purchase = async (pkg: PurchasesPackage): Promise<PurchaseResult> => {
    try {
      const { customerInfo } = await Purchases.purchasePackage(pkg);
      const ok = Object.keys(customerInfo.entitlements.active).length > 0;
      setIsSubscribed(ok);
      return ok ? 'success' : 'error';
    } catch (e: any) {
      if (e?.code === PURCHASES_ERROR_CODE.PURCHASE_CANCELLED_ERROR) return 'cancelled';
      return 'error';
    }
  };

  const restore = async (): Promise<boolean> => {
    try {
      const info = await Purchases.restorePurchases();
      const ok = Object.keys(info.entitlements.active).length > 0;
      setIsSubscribed(ok);
      return ok;
    } catch {
      return false;
    }
  };

  return (
    <SubscriptionContext.Provider value={{ isSubscribed, loading, packages, purchase, restore }}>
      {children}
    </SubscriptionContext.Provider>
  );
}

export function useSubscription() {
  const ctx = useContext(SubscriptionContext);
  if (!ctx) throw new Error('useSubscription must be used within SubscriptionProvider');
  return ctx;
}
