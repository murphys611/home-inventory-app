import { createClient } from '@supabase/supabase-js';
import AsyncStorage from '@react-native-async-storage/async-storage';

const SUPABASE_URL = 'https://khzchplvymixembvydpb.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_9aw9hIt1YiATc4tBR3QHag_hSMqlD9a';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});