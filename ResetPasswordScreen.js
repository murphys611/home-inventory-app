import { useState } from 'react';
import {
  StyleSheet, Text, View, TextInput,
  TouchableOpacity, Alert, KeyboardAvoidingView, Platform, ScrollView
} from 'react-native';
import { supabase } from './supabase';

// ─── RESET PASSWORD SCREEN ──────────────────────────────────────────────────
// This screen appears when the user opens the app via the password reset email
// link. By the time this screen renders, supabase.auth.setSession() has already
// been called in App.js using the tokens from the deep link URL, so the user
// has a valid temporary session and can call updateUser to set a new password.

export default function ResetPasswordScreen({ onComplete }) {
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false); // Shows success state after update

  const handleReset = async () => {
    if (!newPassword || !confirmPassword) {
      Alert.alert('Please fill in both fields.');
      return;
    }
    if (newPassword.length < 6) {
      Alert.alert('Password must be at least 6 characters.');
      return;
    }
    if (newPassword !== confirmPassword) {
      Alert.alert('Passwords do not match.');
      return;
    }

    setLoading(true);
    try {
      // Update the user's password using their temporary reset session
      const { error } = await supabase.auth.updateUser({ password: newPassword });
      if (error) throw error;
      setDone(true);
    } catch (e) {
      Alert.alert('Error', e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView contentContainerStyle={styles.inner}>
        <Text style={styles.title}>🏠 Home Inventory</Text>

        {done ? (
          // ── Success State ──────────────────────────────────────────────
          <>
            <Text style={styles.subtitle}>Password updated!</Text>
            <Text style={styles.info}>
              Your password has been changed successfully. You can now log in with your new password.
            </Text>
            <TouchableOpacity style={styles.btn} onPress={onComplete}>
              <Text style={styles.btnText}>Back to Log In</Text>
            </TouchableOpacity>
          </>
        ) : (
          // ── New Password Form ──────────────────────────────────────────
          <>
            <Text style={styles.subtitle}>Set a new password</Text>
            <Text style={styles.info}>
              Choose a new password for your account.
            </Text>

            <TextInput
              style={styles.input}
              placeholder="New Password"
              placeholderTextColor="#999"
              value={newPassword}
              onChangeText={setNewPassword}
              secureTextEntry
              autoFocus
            />
            <TextInput
              style={styles.input}
              placeholder="Confirm New Password"
              placeholderTextColor="#999"
              value={confirmPassword}
              onChangeText={setConfirmPassword}
              secureTextEntry
            />

            <TouchableOpacity style={styles.btn} onPress={handleReset} disabled={loading}>
              <Text style={styles.btnText}>
                {loading ? 'Updating...' : 'Update Password'}
              </Text>
            </TouchableOpacity>
          </>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f4f4f4' },
  inner: { flexGrow: 1, justifyContent: 'center', paddingHorizontal: 30, paddingVertical: 60 },
  title: { fontSize: 32, fontWeight: 'bold', color: '#2c3e50', textAlign: 'center', marginBottom: 8 },
  subtitle: { fontSize: 16, color: '#777', textAlign: 'center', marginBottom: 16 },
  info: { fontSize: 14, color: '#999', textAlign: 'center', marginBottom: 28, lineHeight: 22 },
  input: { backgroundColor: 'white', padding: 14, borderRadius: 10, fontSize: 15, marginBottom: 14, color: '#333' },
  btn: { backgroundColor: '#27ae60', padding: 16, borderRadius: 10, alignItems: 'center', marginTop: 4 },
  btnText: { color: 'white', fontSize: 16, fontWeight: 'bold' },
});