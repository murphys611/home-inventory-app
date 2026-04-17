import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://khzchplvymixembvydpb.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtoemNocGx2eW1peGVtYnZ5ZHBiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYzNzEyOTEsImV4cCI6MjA5MTk0NzI5MX0.SDebMj4bBL_yxgrFw-MNK3mvglJ08BGnsaKlHU0Ul_Q';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);