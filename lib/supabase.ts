import { createClient } from '@supabase/supabase-js';
import AsyncStorage from '@react-native-async-storage/async-storage';

const supabaseUrl = 'https://ogzwekwzpadussvthssw.supabase.co';
const supabaseAnonKey = 'sb_publishable_pJRqMr57af1eufD34V9KPw_HeLiU2XB';

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});
