import { useState, useEffect } from 'react';
import {
  StyleSheet, Text, View, TextInput,
  TouchableOpacity, Alert, ActivityIndicator
} from 'react-native';
import { supabase } from './supabase';

export default function HouseholdScreen({ user, onHouseholdJoined }) {
  const [mode, setMode] = useState(null); // 'create' or 'join'
  const [householdName, setHouseholdName] = useState('');
  const [joinCode, setJoinCode] = useState('');
  const [loading, setLoading] = useState(false);

  const generateCode = () => {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    return Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  };

  const createHousehold = async () => {
    if (!householdName.trim()) {
      Alert.alert('Please enter a household name.');
      return;
    }
    setLoading(true);
    try {
      const code = generateCode();
      const { data, error } = await supabase
        .from('households')
        .insert([{ name: householdName, code, created_by: user.id }])
        .select()
        .single();
      if (error) throw error;

      const { error: memberError } = await supabase
        .from('household_members')
        .insert([{ household_id: data.id, user_id: user.id }]);
      if (memberError) throw memberError;

      Alert.alert('Household created!', `Your join code is: ${code}\nShare this with your household members.`);
      onHouseholdJoined(data.id);
    } catch (e) {
      Alert.alert('Error', e.message);
    } finally {
      setLoading(false);
    }
  };

  const joinHousehold = async () => {
    if (!joinCode.trim()) {
      Alert.alert('Please enter a join code.');
      return;
    }
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('households')
        .select()
        .eq('code', joinCode.toUpperCase())
        .single();
      if (error || !data) {
        Alert.alert('Invalid code', 'No household found with that code.');
        return;
      }

      const { error: memberError } = await supabase
        .from('household_members')
        .insert([{ household_id: data.id, user_id: user.id }]);
      if (memberError) throw memberError;

      onHouseholdJoined(data.id);
    } catch (e) {
      Alert.alert('Error', e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>🏠 Set Up Your Household</Text>
      <Text style={styles.subtitle}>Create a new household or join an existing one</Text>

      {!mode && (
        <View style={styles.btnRow}>
          <TouchableOpacity style={styles.optionBtn} onPress={() => setMode('create')}>
            <Text style={styles.optionIcon}>＋</Text>
            <Text style={styles.optionText}>Create Household</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.optionBtn, styles.optionBtnSecondary]} onPress={() => setMode('join')}>
            <Text style={styles.optionIcon}>→</Text>
            <Text style={styles.optionText}>Join Household</Text>
          </TouchableOpacity>
        </View>
      )}

      {mode === 'create' && (
        <View>
          <Text style={styles.label}>Household Name</Text>
          <TextInput
            style={styles.input}
            placeholder="e.g. The Murphy House"
            value={householdName}
            onChangeText={setHouseholdName}
          />
          <TouchableOpacity style={styles.btn} onPress={createHousehold} disabled={loading}>
            <Text style={styles.btnText}>{loading ? 'Creating...' : 'Create Household'}</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => setMode(null)}>
            <Text style={styles.backText}>← Back</Text>
          </TouchableOpacity>
        </View>
      )}

      {mode === 'join' && (
        <View>
          <Text style={styles.label}>Enter Join Code</Text>
          <TextInput
            style={styles.input}
            placeholder="e.g. MURPHY54"
            value={joinCode}
            onChangeText={setJoinCode}
            autoCapitalize="characters"
          />
          <TouchableOpacity style={styles.btn} onPress={joinHousehold} disabled={loading}>
            <Text style={styles.btnText}>{loading ? 'Joining...' : 'Join Household'}</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => setMode(null)}>
            <Text style={styles.backText}>← Back</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f4f4f4', justifyContent: 'center', paddingHorizontal: 30 },
  title: { fontSize: 28, fontWeight: 'bold', color: '#2c3e50', textAlign: 'center', marginBottom: 8 },
  subtitle: { fontSize: 15, color: '#777', textAlign: 'center', marginBottom: 40 },
  btnRow: { gap: 16 },
  optionBtn: { backgroundColor: '#27ae60', padding: 20, borderRadius: 12, alignItems: 'center' },
  optionBtnSecondary: { backgroundColor: '#2c3e50' },
  optionIcon: { fontSize: 28, color: 'white', marginBottom: 8 },
  optionText: { color: 'white', fontSize: 16, fontWeight: 'bold' },
  label: { fontSize: 14, fontWeight: 'bold', color: '#2c3e50', marginBottom: 8 },
  input: { backgroundColor: 'white', padding: 14, borderRadius: 10, fontSize: 15, marginBottom: 14 },
  btn: { backgroundColor: '#27ae60', padding: 16, borderRadius: 10, alignItems: 'center', marginBottom: 16 },
  btnText: { color: 'white', fontSize: 16, fontWeight: 'bold' },
  backText: { color: '#27ae60', textAlign: 'center', fontSize: 14 },
});