import { useState } from 'react';
import {
  StyleSheet, Text, View, TextInput,
  TouchableOpacity, Alert, KeyboardAvoidingView, Platform, ScrollView
} from 'react-native';
import { supabase } from './supabase';

export default function AuthScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [isLogin, setIsLogin] = useState(true);
  const [loading, setLoading] = useState(false);

  // ── Forgot Password State ──────────────────────────────────────────────
  const [forgotPassword, setForgotPassword] = useState(false); // Shows reset screen
  const [resetEmail, setResetEmail] = useState('');            // Email input for reset
  const [resetSent, setResetSent] = useState(false);           // Shows confirmation message

  const handleAuth = async () => {
    if (!email || !password) {
      Alert.alert('Please enter your email and password.');
      return;
    }
    if (!isLogin && !fullName.trim()) {
      Alert.alert('Please enter your name.');
      return;
    }
    setLoading(true);
    try {
      if (isLogin) {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      } else {
        const { data, error } = await supabase.auth.signUp({ email, password });
        if (error) throw error;
        if (data.user) {
          await supabase.from('profiles').insert([{
            id: data.user.id,
            full_name: fullName.trim()
          }]);
        }
      }
    } catch (e) {
      Alert.alert('Error', e.message);
    } finally {
      setLoading(false);
    }
  };

  // Sends a password reset email via Supabase
  const handleForgotPassword = async () => {
    if (!resetEmail.trim()) {
      Alert.alert('Please enter your email address.');
      return;
    }
    setLoading(true);
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(resetEmail.trim());
      if (error) throw error;
      setResetSent(true);
    } catch (e) {
      Alert.alert('Error', e.message);
    } finally {
      setLoading(false);
    }
  };

  // ── Forgot Password Screen ─────────────────────────────────────────────
  if (forgotPassword) {
    return (
      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <ScrollView contentContainerStyle={styles.inner}>
          <Text style={styles.title}>🏠 Home Inventory</Text>

          {resetSent ? (
            // Confirmation state after email is sent
            <>
              <Text style={styles.subtitle}>Check your inbox!</Text>
              <Text style={styles.resetInfo}>
                We sent a password reset link to{'\n'}
                <Text style={{ fontWeight: 'bold', color: '#2c3e50' }}>{resetEmail}</Text>
              </Text>
              <TouchableOpacity
                style={styles.btn}
                onPress={() => {
                  setForgotPassword(false);
                  setResetSent(false);
                  setResetEmail('');
                }}
              >
                <Text style={styles.btnText}>Back to Log In</Text>
              </TouchableOpacity>
            </>
          ) : (
            // Input state — enter email to receive reset link
            <>
              <Text style={styles.subtitle}>Reset your password</Text>
              <Text style={styles.resetInfo}>
                Enter your account email and we'll send you a link to reset your password.
              </Text>
              <TextInput
                style={styles.input}
                placeholder="Email"
                placeholderTextColor="#999"
                value={resetEmail}
                onChangeText={setResetEmail}
                autoCapitalize="none"
                keyboardType="email-address"
                autoFocus
              />
              <TouchableOpacity style={styles.btn} onPress={handleForgotPassword} disabled={loading}>
                <Text style={styles.btnText}>
                  {loading ? 'Sending...' : 'Send Reset Email'}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => { setForgotPassword(false); setResetEmail(''); }}>
                <Text style={styles.switchText}>← Back to Log In</Text>
              </TouchableOpacity>
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    );
  }

  // ── Main Login / Sign Up Screen ────────────────────────────────────────
  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView contentContainerStyle={styles.inner}>
        <Text style={styles.title}>🏠 Home Inventory</Text>
        <Text style={styles.subtitle}>{isLogin ? 'Welcome back' : 'Create your account'}</Text>

        {!isLogin && (
          <TextInput
            style={styles.input}
            placeholder="Full Name"
            placeholderTextColor="#999"
            value={fullName}
            onChangeText={setFullName}
            autoCapitalize="words"
          />
        )}

        <TextInput
          style={styles.input}
          placeholder="Email"
          placeholderTextColor="#999"
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          keyboardType="email-address"
        />
        <TextInput
          style={styles.input}
          placeholder="Password"
          placeholderTextColor="#999"
          value={password}
          onChangeText={setPassword}
          secureTextEntry
        />

        <TouchableOpacity style={styles.btn} onPress={handleAuth} disabled={loading}>
          <Text style={styles.btnText}>
            {loading ? 'Please wait...' : isLogin ? 'Log In' : 'Sign Up'}
          </Text>
        </TouchableOpacity>

        {/* Forgot Password link — only shown on login screen */}
        {isLogin && (
          <TouchableOpacity
            style={styles.forgotBtn}
            onPress={() => { setForgotPassword(true); setResetEmail(email); }}
          >
            <Text style={styles.forgotText}>Forgot your password?</Text>
          </TouchableOpacity>
        )}

        <TouchableOpacity onPress={() => {
          setIsLogin(!isLogin);
          setEmail('');
          setPassword('');
          setFullName('');
        }}>
          <Text style={styles.switchText}>
            {isLogin ? "Don't have an account? Sign up" : 'Already have an account? Log in'}
          </Text>
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f4f4f4' },
  inner: { flexGrow: 1, justifyContent: 'center', paddingHorizontal: 30, paddingVertical: 60 },
  title: { fontSize: 32, fontWeight: 'bold', color: '#2c3e50', textAlign: 'center', marginBottom: 8 },
  subtitle: { fontSize: 16, color: '#777', textAlign: 'center', marginBottom: 32 },
  input: { backgroundColor: 'white', padding: 14, borderRadius: 10, fontSize: 15, marginBottom: 14, color: '#333' },
  btn: { backgroundColor: '#27ae60', padding: 16, borderRadius: 10, alignItems: 'center', marginBottom: 16 },
  btnText: { color: 'white', fontSize: 16, fontWeight: 'bold' },
  switchText: { color: '#27ae60', textAlign: 'center', fontSize: 14 },
  forgotBtn: { alignItems: 'center', marginBottom: 16 },
  forgotText: { color: '#999', fontSize: 14 },
  resetInfo: { fontSize: 14, color: '#777', textAlign: 'center', marginBottom: 24, lineHeight: 22 },
});