// ─── IMPORTS ───────────────────────────────────────────────────────────────
import { useState, useEffect, useRef } from 'react';
import {
  StyleSheet, Text, View, TouchableOpacity, FlatList,
  TextInput, Alert, Image, ActivityIndicator, ScrollView, Share, Modal
} from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as ImagePicker from 'expo-image-picker';
import * as Notifications from 'expo-notifications';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from './supabase';
import AuthScreen from './AuthScreen';
import HouseholdScreen from './HouseholdScreen';
import * as Linking from 'expo-linking';
import ResetPasswordScreen from './ResetPasswordScreen';

// ─── CONSTANTS ─────────────────────────────────────────────────────────────

const CATEGORIES = [
  { label: 'Food', value: 'food', color: '#e67e22' },
  { label: 'Drinks', value: 'drinks', color: '#16a085' },
  { label: 'Cleaning', value: 'cleaning', color: '#2980b9' },
  { label: 'Hygiene', value: 'hygiene', color: '#8e44ad' },
  { label: 'Other', value: 'other', color: '#7f8c8d' },
];

const LOW_STOCK_THRESHOLD = 2;

// ─── NOTIFICATION HANDLER ──────────────────────────────────────────────────
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

// ─── MAIN APP COMPONENT ────────────────────────────────────────────────────
export default function App() {

  // ── Auth State ──────────────────────────────────────────────────────────
  const [user, setUser] = useState(null);
  const [householdId, setHouseholdId] = useState(null);
  const [checkingAuth, setCheckingAuth] = useState(true);

  // ── Password Reset State ────────────────────────────────────────────────
  const [resetPasswordMode, setResetPasswordMode] = useState(false);

  // ── Camera Permission ───────────────────────────────────────────────────
  const [permission, requestPermission] = useCameraPermissions();

  // ── Navigation ──────────────────────────────────────────────────────────
  const [activeTab, setActiveTab] = useState('inventory');
  const [scanning, setScanning] = useState(false);

  // ── Inventory State ─────────────────────────────────────────────────────
  const [inventory, setInventory] = useState([]);
  const [loading, setLoading] = useState(true);

  // ── Search, Filter & Sort ───────────────────────────────────────────────
  const [searchQuery, setSearchQuery] = useState('');
  const [filterCategory, setFilterCategory] = useState('all');
  const [sortBy, setSortBy] = useState('name');
  const [showSortOptions, setShowSortOptions] = useState(false);
  const [compactView, setCompactView] = useState(false);

  // ── Add Item Form State ─────────────────────────────────────────────────
  const [productName, setProductName] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [productImage, setProductImage] = useState(null);
  const [currentBarcode, setCurrentBarcode] = useState(null);
  const [selectedCategory, setSelectedCategory] = useState('food');
  const [scanStatus, setScanStatus] = useState('');
  const [expirationDate, setExpirationDate] = useState('');
  const [lowStockThreshold, setLowStockThreshold] = useState('2'); // Per-item alert threshold

  // ── Shopping List State ─────────────────────────────────────────────────
  const [checkedItems, setCheckedItems] = useState({});
  const [restockQuantities, setRestockQuantities] = useState({});

  // ── Profile State ───────────────────────────────────────────────────────
  const [householdCode, setHouseholdCode] = useState('');
  const [householdMembers, setHouseholdMembers] = useState([]);
  const [profileName, setProfileName] = useState('');
  const [editingName, setEditingName] = useState(false);
  const [newName, setNewName] = useState('');

  // ── Item Detail + Edit State ────────────────────────────────────────────
  // selectedItem: opens the detail/image modal by tapping anywhere on a card
  // editingItem: opens the edit form (triggered from inside the detail modal)
  const [selectedItem, setSelectedItem] = useState(null);
  const [editingItem, setEditingItem] = useState(null);
  const [editName, setEditName] = useState('');
  const [editCategory, setEditCategory] = useState('');
  const [editThreshold, setEditThreshold] = useState('');
  
  // ── Refs ────────────────────────────────────────────────────────────────
  const scanned = useRef(false);
  const cameraReady = useRef(false);

  //Avatar State
  const [profileAvatar, setProfileAvatar] = useState(null); // Current user's avatar URL
  const [uploadingAvatar, setUploadingAvatar] = useState(false);

  // ─── DEEP LINK HANDLER ─────────────────────────────────────────────────
  useEffect(() => {
    const subscription = Linking.addEventListener('url', ({ url }) => {
      handleDeepLink(url);
    });
    Linking.getInitialURL().then(url => {
      if (url) handleDeepLink(url);
    });
    return () => subscription.remove();
  }, []);

  const handleDeepLink = async (url) => {
    if (!url || !url.includes('reset-password')) return;
    const fragment = url.split('#')[1];
    if (!fragment) return;
    const params = {};
    fragment.split('&').forEach(pair => {
      const [key, value] = pair.split('=');
      if (key && value) params[key] = decodeURIComponent(value);
    });
    if (params.access_token && params.refresh_token && params.type === 'recovery') {
      try {
        const { error } = await supabase.auth.setSession({
          access_token: params.access_token,
          refresh_token: params.refresh_token,
        });
        if (error) throw error;
        setResetPasswordMode(true);
      } catch (e) {
        Alert.alert('Reset link expired', 'Please request a new password reset email.');
      }
    }
  };

  // ─── AUTH LISTENER ─────────────────────────────────────────────────────
  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        if (event === 'INITIAL_SESSION') {
          setUser(session?.user ?? null);
          setCheckingAuth(false);
        } else {
          setUser(session?.user ?? null);
        }
      }
    );
    return () => subscription.unsubscribe();
  }, []);

  // ─── LOAD HOUSEHOLD WHEN USER LOGS IN ──────────────────────────────────
  useEffect(() => {
    if (user) loadHousehold();
  }, [user]);

  // ─── LOAD INVENTORY + SUBSCRIBE TO CHANGES ─────────────────────────────
  useEffect(() => {
    if (householdId) {
      loadInventory();
      requestNotificationPermission();
      const channel = supabase
        .channel('inventory-changes')
        .on('postgres_changes',
          { event: '*', schema: 'public', table: 'inventory' },
          () => { loadInventory(); }
        )
        .subscribe();
      return () => supabase.removeChannel(channel);
    }
  }, [householdId]);

  // ─── AUTO OPEN CAMERA ──────────────────────────────────────────────────
  useEffect(() => {
    if (activeTab === 'scan') {
      if (!permission?.granted) {
        requestPermission().then(() => {
          scanned.current = false;
          setScanning(true);
        });
      } else {
        scanned.current = false;
        setScanning(true);
      }
    } else {
      setScanning(false);
      cameraReady.current = false;
    }
  }, [activeTab]);

  // ─── HOUSEHOLD FUNCTIONS ────────────────────────────────────────────────

  const loadHousehold = async () => {
    try {
      const { data } = await supabase
        .from('household_members')
        .select('household_id')
        .eq('user_id', user.id)
        .single();
      if (data) {
        setHouseholdId(data.household_id);
        const { data: household } = await supabase
          .from('households').select('code').eq('id', data.household_id).single();
        if (household) setHouseholdCode(household.code);
        const { data: myProfile } = await supabase
          .from('profiles').select('full_name, avatar_url').eq('id', user.id).single();
        if (myProfile) {
          setProfileName(myProfile.full_name || '');
          setProfileAvatar(myProfile.avatar_url || null);
        }
        const { data: members } = await supabase
          .from('household_members').select('user_id, joined_at').eq('household_id', data.household_id);
        if (members) {
          const { data: profiles } = await supabase
            .from('profiles').select('id, full_name, avatar_url').in('id', members.map(m => m.user_id));
          setHouseholdMembers(members.map(member => ({
            ...member,
            full_name: profiles?.find(p => p.id === member.user_id)?.full_name || 'Unknown',
            avatar_url: profiles?.find(p => p.id === member.user_id)?.avatar_url || null,
          })));
        }
      }
    } catch (e) {
      console.log('No household found');
    }
  };

  const saveName = async () => {
    try {
      const { data: existing } = await supabase.from('profiles').select('id').eq('id', user.id).single();
      if (existing) {
        await supabase.from('profiles').update({ full_name: newName }).eq('id', user.id);
      } else {
        await supabase.from('profiles').insert([{ id: user.id, full_name: newName }]);
      }
      setProfileName(newName);
      setEditingName(false);
      loadHousehold();
    } catch (e) {
      Alert.alert('Failed to save name.');
    }
  };

  // Saves name + category edits for an existing item
  const saveItemEdit = async () => {
    if (!editName.trim()) {
      Alert.alert('Please enter a product name.');
      return;
    }
    try {
      const { error } = await supabase.from('inventory')
        .update({ name: editName, category: editCategory, low_stock_threshold: editThreshold ? parseInt(editThreshold) : null })
        .eq('id', editingItem.id);
      if (error) throw error;
      setInventory(prev => prev.map(i =>
        i.id === editingItem.id ? { ...i, name: editName, category: editCategory, low_stock_threshold: editThreshold ? parseInt(editThreshold) : null } : i
      ));
      setEditingItem(null);
    } catch (e) {
      Alert.alert('Failed to save changes.');
    }
  };

  const shareHouseholdCode = async () => {
    try {
      await Share.share({
        message: `Join my household on Home Inventory! Use code: ${householdCode}`,
        title: 'Home Inventory — Join Code',
      });
    } catch (e) {
      Alert.alert('Could not open share sheet.');
    }
  };

  // Lets user pick a photo from camera, camera roll, or files and uploads to Supabase Storage
  const uploadAvatar = () => {
    Alert.alert('Profile Picture', 'Choose a source', [
      {
        text: 'Take Photo',
        onPress: async () => {
          const result = await ImagePicker.launchCameraAsync({
            allowsEditing: true, aspect: [1, 1], quality: 0.7,
          });
          if (!result.canceled) processAvatarUpload(result.assets[0].uri);
        }
      },
      {
        text: 'Choose from Library',
        onPress: async () => {
          const result = await ImagePicker.launchImageLibraryAsync({
            allowsEditing: true, aspect: [1, 1], quality: 0.7,
            mediaTypes: ImagePicker.MediaTypeOptions.Images,
          });
          if (!result.canceled) processAvatarUpload(result.assets[0].uri);
        }
      },
      { text: 'Cancel', style: 'cancel' }
    ]);
  };

  const processAvatarUpload = async (uri) => {
    setUploadingAvatar(true);
    try {
      // Read the file as base64
      const response = await fetch(uri);
      const blob = await response.blob();
      const reader = new FileReader();
      reader.readAsArrayBuffer(blob);
      await new Promise((resolve) => { reader.onloadend = resolve; });
      const arrayBuffer = reader.result;

      const filePath = `${user.id}.jpg`;

      // Upload to Supabase Storage avatars bucket
      const { error: uploadError } = await supabase.storage
        .from('avatars')
        .upload(filePath, arrayBuffer, {
          contentType: 'image/jpeg',
          upsert: true, // Overwrite if already exists
        });
      if (uploadError) throw uploadError;

      // Get the public URL
      const { data: { publicUrl } } = supabase.storage
        .from('avatars')
        .getPublicUrl(filePath);

      // Save URL to profiles table
      await supabase.from('profiles')
        .update({ avatar_url: publicUrl })
        .eq('id', user.id);

      setProfileAvatar(publicUrl + '?t=' + Date.now()); // Cache bust
    } catch (e) {
      Alert.alert('Upload failed', e.message);
    } finally {
      setUploadingAvatar(false);
    }
  };

  // ─── NOTIFICATION FUNCTIONS ─────────────────────────────────────────────

  const requestNotificationPermission = async () => {
    const { status } = await Notifications.requestPermissionsAsync();
    if (status !== 'granted') console.log('Notification permission denied');
  };

  const sendLowStockNotification = async (itemName, qty) => {
    await Notifications.scheduleNotificationAsync({
      content: {
        title: '⚠️ Low Stock Alert',
        body: qty === 0
          ? `${itemName} is out of stock!`
          : `${itemName} is running low — only ${qty} left.`,
        sound: true,
      },
      trigger: null,
    });
  };

  // ─── INVENTORY FUNCTIONS ────────────────────────────────────────────────

  const loadInventory = async () => {
    try {
      const { data, error } = await supabase
        .from('inventory').select('*').eq('household_id', householdId);
      if (error) throw error;
      if (data) setInventory(data);
    } catch (e) {
      console.log('Failed to load inventory', e);
    } finally {
      setLoading(false);
    }
  };

  const addItem = async () => {
    if (productName.trim() === '') {
      Alert.alert('Please enter a product name.');
      return;
    }
    const newItem = {
      id: Date.now().toString(),
      barcode: currentBarcode,
      name: productName,
      quantity: quantity,
      image: productImage,
      category: selectedCategory,
      household_id: householdId,
      expiration_date: expirationDate.trim() || null,
      low_stock_threshold: lowStockThreshold ? parseInt(lowStockThreshold) : null,
    };
    if (currentBarcode) saveToLocalCache(currentBarcode, productName, selectedCategory, productImage);
    try {
      const { error } = await supabase.from('inventory').insert([newItem]);
      if (error) throw error;
      setInventory(prev => [...prev, newItem]);
      setProductName(''); setQuantity('1'); setProductImage(null);
      setCurrentBarcode(null); setSelectedCategory('food'); setExpirationDate(''); setLowStockThreshold('2');
      setActiveTab('inventory');
    } catch (e) {
      Alert.alert('Failed to add item: ' + JSON.stringify(e));
    }
  };

  const deleteItem = async (id) => {
    try {
      const { error } = await supabase.from('inventory').delete().eq('id', id);
      if (error) throw error;
      setInventory(prev => prev.filter(item => item.id !== id));
    } catch (e) {
      Alert.alert('Failed to delete item.');
    }
  };

  const changeQuantity = async (id, delta) => {
    const item = inventory.find(i => i.id === id);
    if (!item) return;
    const newQty = Math.max(0, parseInt(item.quantity) + delta);
    const threshold = item.low_stock_threshold != null ? item.low_stock_threshold : LOW_STOCK_THRESHOLD;
    if (newQty === threshold || newQty === 0) {
      sendLowStockNotification(item.name, newQty);
    }
    try {
      const { error } = await supabase.from('inventory').update({ quantity: newQty.toString() }).eq('id', id);
      if (error) throw error;
      setInventory(prev => prev.map(i => i.id === id ? { ...i, quantity: newQty.toString() } : i));
    } catch (e) {
      Alert.alert('Failed to update quantity.');
    }
  };

  // ─── LOCAL BARCODE CACHE ────────────────────────────────────────────────

  const saveToLocalCache = async (barcode, name, category, image) => {
    try {
      const existing = await AsyncStorage.getItem('barcodeCache');
      const cache = existing ? JSON.parse(existing) : {};
      cache[barcode] = { name, category, image };
      await AsyncStorage.setItem('barcodeCache', JSON.stringify(cache));
    } catch (e) {
      console.log('Failed to save to cache');
    }
  };

  const checkLocalCache = async (barcode) => {
    try {
      const existing = await AsyncStorage.getItem('barcodeCache');
      if (!existing) return null;
      const cache = JSON.parse(existing);
      return cache[barcode] || null;
    } catch (e) {
      return null;
    }
  };

  // ─── BARCODE SCANNING ───────────────────────────────────────────────────

  const handleBarcode = ({ data }) => {
    if (scanned.current) return;
    if (!cameraReady.current) return;
    scanned.current = true;
    setScanning(false);
    setScanStatus('Looking up product...');
    setActiveTab('scan');
    lookupProduct(data);
  };

  const lookupProduct = async (barcode) => {
    setCurrentBarcode(barcode);
    const cached = await checkLocalCache(barcode);
    if (cached) {
      const existing = inventory.find(item => item.barcode === barcode);
      if (existing) {
        await changeQuantity(existing.id, 1);
        setScanStatus(`✓ Updated: ${cached.name} is now x${parseInt(existing.quantity) + 1}`);
        setTimeout(() => { setActiveTab('inventory'); setScanStatus(''); }, 2000);
      } else {
        setProductName(cached.name); setProductImage(cached.image);
        setSelectedCategory(cached.category); setScanStatus(''); setActiveTab('add');
      }
      return;
    }
    fetch(`https://world.openfoodfacts.org/api/v2/product/${barcode}?fields=product_name,image_url,categories_tags`)
      .then(res => res.json())
      .then(data => {
        if (data.status === 1 && data.product.product_name) {
          const name = data.product.product_name;
          const image = data.product.image_url || null;
          const category = detectCategory(data.product.categories_tags);
          const existing = inventory.find(item => item.barcode === barcode);
          if (existing) {
            changeQuantity(existing.id, 1);
            setScanStatus(`✓ Updated: ${name} is now x${parseInt(existing.quantity) + 1}`);
            setTimeout(() => { setActiveTab('inventory'); setScanStatus(''); }, 2000);
          } else {
            setProductName(name); setProductImage(image);
            setSelectedCategory(category); setScanStatus(''); setActiveTab('add');
          }
        } else {
          lookupProductFallback(barcode);
        }
      })
      .catch(() => lookupProductFallback(barcode));
  };

  const lookupProductFallback = (barcode) => {
    fetch(`https://api.upcitemdb.com/prod/trial/lookup?upc=${barcode}`)
      .then(res => res.json())
      .then(data => {
        if (data.items && data.items.length > 0) {
          const product = data.items[0];
          const name = product.title || 'Unknown Product';
          const image = product.images && product.images.length > 0 ? product.images[0] : null;
          const category = detectCategoryFromString(product.category);
          const existing = inventory.find(item => item.barcode === barcode);
          if (existing) {
            changeQuantity(existing.id, 1);
            setScanStatus(`✓ Updated: ${name} is now x${parseInt(existing.quantity) + 1}`);
            setTimeout(() => { setActiveTab('inventory'); setScanStatus(''); }, 2000);
          } else {
            setProductName(name); setProductImage(image);
            setSelectedCategory(category); setScanStatus(''); setActiveTab('add');
          }
        } else {
          setScanStatus('');
          Alert.alert('Product Not Found',
            'This barcode wasn\'t recognized. You can add it manually — next time you scan this barcode it will be remembered automatically.',
            [
              { text: 'Add Manually', onPress: () => { setProductName(''); setProductImage(null); setSelectedCategory('other'); setActiveTab('add'); } },
              { text: 'Cancel', style: 'cancel', onPress: () => setActiveTab('inventory') }
            ]
          );
        }
      })
      .catch(() => {
        setScanStatus('');
        Alert.alert('Lookup Failed', 'Could not connect to product database. You can add it manually.',
          [
            { text: 'Add Manually', onPress: () => { setProductName(''); setProductImage(null); setSelectedCategory('other'); setActiveTab('add'); } },
            { text: 'Cancel', style: 'cancel', onPress: () => setActiveTab('inventory') }
          ]
        );
      });
  };

  // ─── CATEGORY DETECTION ─────────────────────────────────────────────────

  const detectCategory = (tags) => {
    if (!tags) return 'other';
    const tagString = Array.isArray(tags) ? tags.join(' ').toLowerCase() : tags.toLowerCase();
    if (tagString.includes('hygiene') || tagString.includes('beauty') || tagString.includes('personal-care') ||
      tagString.includes('hair-care') || tagString.includes('oral-care') || tagString.includes('skin-care') ||
      tagString.includes('body-care') || tagString.includes('cosmetic') || tagString.includes('deodorant') ||
      tagString.includes('shampoo') || tagString.includes('conditioner') || tagString.includes('toothpaste') ||
      tagString.includes('mouthwash') || tagString.includes('chapstick') || tagString.includes('lip-balm')) return 'hygiene';
    if (tagString.includes('clean') || tagString.includes('household') || tagString.includes('detergent') ||
      tagString.includes('laundry') || tagString.includes('dishwash')) return 'cleaning';
    if (tagString.includes('beverage') || tagString.includes('drink') || tagString.includes('juice') ||
      tagString.includes('soda') || tagString.includes('water') || tagString.includes('coffee') ||
      tagString.includes('tea')) return 'drinks';
    if (tagString.includes('food') || tagString.includes('dairy') || tagString.includes('snack') ||
      tagString.includes('grocery')) return 'food';
    return 'other';
  };

  const detectCategoryFromString = (category) => {
    if (!category) return 'other';
    const cat = category.toLowerCase();
    if (cat.includes('health') || cat.includes('beauty') || cat.includes('personal') || cat.includes('hair') ||
      cat.includes('skin') || cat.includes('oral') || cat.includes('hygiene') || cat.includes('cosmetic')) return 'hygiene';
    if (cat.includes('clean') || cat.includes('household') || cat.includes('laundry') || cat.includes('paper') ||
      cat.includes('towel') || cat.includes('detergent')) return 'cleaning';
    if (cat.includes('beverage') || cat.includes('drink') || cat.includes('juice') || cat.includes('soda') ||
      cat.includes('water') || cat.includes('coffee') || cat.includes('tea')) return 'drinks';
    if (cat.includes('food') || cat.includes('grocery') || cat.includes('snack')) return 'food';
    return 'other';
  };

  // ─── IMAGE PICKER FUNCTIONS ─────────────────────────────────────────────

  const pickImage = async () => {
    let result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true, aspect: [1, 1], quality: 0.5,
    });
    if (!result.canceled) setProductImage(result.assets[0].uri);
  };

  const takePhoto = async () => {
    let result = await ImagePicker.launchCameraAsync({
      allowsEditing: true, aspect: [1, 1], quality: 0.5,
    });
    if (!result.canceled) setProductImage(result.assets[0].uri);
  };

  // ─── HELPER FUNCTIONS ───────────────────────────────────────────────────

  const getCategoryColor = (value) => {
    const cat = CATEGORIES.find(c => c.value === value);
    return cat ? cat.color : '#7f8c8d';
  };

  // Uses per-item threshold if set, otherwise falls back to the global constant
  const isLowStock = (qty, item) => {
    const threshold = item?.low_stock_threshold != null ? item.low_stock_threshold : LOW_STOCK_THRESHOLD;
    return parseInt(qty) <= threshold;
  };

  const getFilteredAndSorted = () => {
    let result = [...inventory];
    if (searchQuery.trim() !== '') {
      result = result.filter(item => item.name.toLowerCase().includes(searchQuery.toLowerCase()));
    }
    if (filterCategory !== 'all') {
      result = result.filter(item => item.category === filterCategory);
    }
    if (sortBy === 'name') result.sort((a, b) => a.name.localeCompare(b.name));
    else if (sortBy === 'category') result.sort((a, b) => (a.category || '').localeCompare(b.category || ''));
    else if (sortBy === 'lowstock') result.sort((a, b) => parseInt(a.quantity) - parseInt(b.quantity));
    return result;
  };

  const shoppingList = inventory.filter(item => parseInt(item.quantity) === 0);

  // ─── CONDITIONAL SCREENS ────────────────────────────────────────────────

  if (checkingAuth) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#f4f4f4' }}>
        <ActivityIndicator size="large" color="#27ae60" />
      </View>
    );
  }

  if (resetPasswordMode) {
    return <ResetPasswordScreen onComplete={() => {
      setResetPasswordMode(false);
      supabase.auth.signOut();
    }} />;
  }

  if (!user) return <AuthScreen />;
  if (!householdId) return <HouseholdScreen user={user} onHouseholdJoined={setHouseholdId} />;

  if (activeTab === 'scan' && scanning) {
    return (
      <View style={{ flex: 1 }}>
        <CameraView
          style={StyleSheet.absoluteFillObject}
          facing="back"
          onBarcodeScanned={handleBarcode}
          barcodeScannerSettings={{ barcodeTypes: ['ean13', 'ean8', 'upc_a', 'upc_e', 'code128'] }}
          onCameraReady={() => { setTimeout(() => { cameraReady.current = true; }, 1500); }}
        />
        <View style={styles.scanOverlay}>
          <Text style={styles.scanTitle}>Scan a Barcode</Text>
          <View style={styles.scanBox} />
          <Text style={styles.scanHint}>Point at a barcode to scan</Text>
        </View>
        <View style={styles.scanCancelRow}>
          <TouchableOpacity style={styles.scanCancelBtn} onPress={() => {
            setScanning(false); scanned.current = false;
            cameraReady.current = false; setActiveTab('inventory');
          }}>
            <Text style={styles.scanCancelText}>Cancel</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  if (activeTab === 'scan' && scanStatus) {
    return (
      <View style={styles.lookupScreen}>
        <ActivityIndicator size="large" color="#27ae60" />
        <Text style={styles.lookupText}>{scanStatus}</Text>
      </View>
    );
  }

  // ─── MAIN APP UI ────────────────────────────────────────────────────────
  return (
    <View style={styles.container}>

      {/* ── INVENTORY TAB ── */}
      {activeTab === 'inventory' && (
        <View style={styles.screen}>
          <Text style={styles.title}>Home Inventory</Text>

          <TextInput
            style={styles.searchBar}
            placeholder="🔍 Search inventory..."
            placeholderTextColor="#999"
            value={searchQuery}
            onChangeText={setSearchQuery}
          />

          <View style={styles.filterSortRow}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filterScroll}>
              <TouchableOpacity
                style={[styles.filterTab, filterCategory === 'all' && styles.filterTabActive]}
                onPress={() => setFilterCategory('all')}
              >
                <Text style={[styles.filterTabText, filterCategory === 'all' && styles.filterTabTextActive]}>All</Text>
              </TouchableOpacity>
              {CATEGORIES.map(cat => (
                <TouchableOpacity
                  key={cat.value}
                  style={[styles.filterTab, filterCategory === cat.value && { backgroundColor: cat.color }]}
                  onPress={() => setFilterCategory(cat.value)}
                >
                  <Text style={[styles.filterTabText, filterCategory === cat.value && styles.filterTabTextActive]}>
                    {cat.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
            <TouchableOpacity style={styles.sortBtn} onPress={() => setCompactView(prev => !prev)}>
              <Ionicons name={compactView ? 'grid-outline' : 'list-outline'} size={16} color="white" />
            </TouchableOpacity>
            <TouchableOpacity style={[styles.sortBtn, { marginLeft: 6 }]} onPress={() => setShowSortOptions(!showSortOptions)}>
              <Text style={styles.sortBtnText}>⇅ Sort</Text>
            </TouchableOpacity>
          </View>

          {showSortOptions && (
            <View style={styles.sortDropdown}>
              {[
                { label: 'Name (A-Z)', value: 'name' },
                { label: 'Category', value: 'category' },
                { label: 'Low Stock First', value: 'lowstock' },
              ].map(option => (
                <TouchableOpacity
                  key={option.value}
                  style={[styles.sortOption, sortBy === option.value && styles.sortOptionActive]}
                  onPress={() => { setSortBy(option.value); setShowSortOptions(false); }}
                >
                  <Text style={[styles.sortOptionText, sortBy === option.value && styles.sortOptionTextActive]}>
                    {option.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          )}

          {loading ? (
            <View style={styles.emptyState}>
              <ActivityIndicator size="large" color="#2c3e50" />
              <Text style={styles.emptyStateText}>Loading inventory...</Text>
            </View>
          ) : getFilteredAndSorted().length === 0 ? (
            <View style={styles.emptyState}>
              <Text style={styles.emptyStateIcon}>📦</Text>
              <Text style={styles.emptyStateText}>
                {searchQuery || filterCategory !== 'all' ? 'No items match your search.' : 'No items yet. Tap Scan to get started!'}
              </Text>
            </View>
          ) : compactView ? (
            /* ── COMPACT LIST VIEW ── */
            <FlatList
              data={getFilteredAndSorted()}
              keyExtractor={item => item.id}
              renderItem={({ item }) => (
                <View style={[styles.compactItem, isLowStock(item.quantity, item) && styles.itemLowStock]}>
                  <View style={[styles.compactDot, { backgroundColor: getCategoryColor(item.category) }]} />
                  <Text style={styles.compactName} numberOfLines={1}>{item.name}</Text>
                  {isLowStock(item.quantity, item) && <Text style={styles.compactLowStock}>⚠️</Text>}
                  <View style={styles.qtyControls}>
                    <TouchableOpacity style={styles.qtyBtn} onPress={() => changeQuantity(item.id, -1)}>
                      <Text style={styles.qtyBtnText}>−</Text>
                    </TouchableOpacity>
                    <Text style={[styles.qtyNumber, isLowStock(item.quantity, item) && styles.qtyLow]}>
                      {item.quantity}
                    </Text>
                    <TouchableOpacity style={styles.qtyBtn} onPress={() => changeQuantity(item.id, 1)}>
                      <Text style={styles.qtyBtnText}>+</Text>
                    </TouchableOpacity>
                  </View>
                  <TouchableOpacity onPress={() => deleteItem(item.id)}>
                    <Text style={styles.deleteBtn}>✕</Text>
                  </TouchableOpacity>
                </View>
              )}
            />
          ) : (
            /* ── CARD VIEW ──
               Tapping anywhere on the card opens the detail modal.
               Qty +/- and delete still work independently via onPress with stopPropagation via their own TouchableOpacity. */
            <FlatList
              data={getFilteredAndSorted()}
              keyExtractor={item => item.id}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={[styles.item, isLowStock(item.quantity, item) && styles.itemLowStock]}
                  onPress={() => setSelectedItem(item)}
                  activeOpacity={0.75}
                >
                  {/* Product Image */}
                  {item.image ? (
                    <Image source={{ uri: item.image }} style={styles.itemImage} />
                  ) : (
                    <View style={styles.itemImagePlaceholder}>
                      <Ionicons name="image-outline" size={20} color="#bbb" />
                    </View>
                  )}

                  {/* Product Info */}
                  <View style={styles.itemInfo}>
                    <Text style={styles.itemName} numberOfLines={2}>{item.name}</Text>
                    <View style={styles.itemTagRow}>
                      <View style={[styles.categoryTag, { backgroundColor: getCategoryColor(item.category) }]}>
                        <Text style={styles.categoryTagText}>
                          {CATEGORIES.find(c => c.value === item.category)?.label || 'Other'}
                        </Text>
                      </View>
                      {isLowStock(item.quantity, item) && (
                        <View style={styles.lowStockTag}>
                          <Text style={styles.lowStockTagText}>
                            {parseInt(item.quantity) === 0 ? '⚠️ Out' : '⚠️ Low'}
                          </Text>
                        </View>
                      )}
                      {item.expiration_date && (() => {
                        const exp = new Date(item.expiration_date);
                        const today = new Date();
                        const daysUntil = Math.ceil((exp - today) / (1000 * 60 * 60 * 24));
                        if (daysUntil < 0) return (
                          <View style={styles.expiredTag}><Text style={styles.expiredTagText}>⚠️ Expired</Text></View>
                        );
                        if (daysUntil <= 7) return (
                          <View style={styles.expiringSoonTag}><Text style={styles.expiringSoonTagText}>⏰ {daysUntil}d left</Text></View>
                        );
                        return (
                          <View style={styles.expirationTag}><Text style={styles.expirationTagText}>📅 {item.expiration_date}</Text></View>
                        );
                      })()}
                    </View>
                  </View>

                  {/* Qty Controls — stopPropagation so tapping +/- doesn't open the modal */}
                  <View style={styles.qtyControls}>
                    <TouchableOpacity style={styles.qtyBtn} onPress={(e) => { e.stopPropagation?.(); changeQuantity(item.id, -1); }}>
                      <Text style={styles.qtyBtnText}>−</Text>
                    </TouchableOpacity>
                    <Text style={[styles.qtyNumber, isLowStock(item.quantity, item) && styles.qtyLow]}>
                      {item.quantity}
                    </Text>
                    <TouchableOpacity style={styles.qtyBtn} onPress={(e) => { e.stopPropagation?.(); changeQuantity(item.id, 1); }}>
                      <Text style={styles.qtyBtnText}>+</Text>
                    </TouchableOpacity>
                  </View>

                  {/* Delete */}
                  <TouchableOpacity onPress={(e) => { e.stopPropagation?.(); deleteItem(item.id); }}>
                    <Text style={styles.deleteBtn}>✕</Text>
                  </TouchableOpacity>
                </TouchableOpacity>
              )}
            />
          )}
        </View>
      )}

      {/* ── ADD ITEM TAB ── */}
      {activeTab === 'add' && (
        <ScrollView style={styles.screen} contentContainerStyle={styles.addContent}>
          <Text style={styles.title}>Add Item</Text>
          <View style={styles.addImageRow}>
            {productImage ? (
              <Image source={{ uri: productImage }} style={styles.addPreviewImage} />
            ) : (
              <View style={styles.addImagePlaceholder}>
                <Text style={styles.addImagePlaceholderText}>No Image</Text>
              </View>
            )}
            <View style={styles.addImageBtns}>
              <TouchableOpacity style={styles.imgBtn} onPress={takePhoto}>
                <Text style={styles.imgBtnText}>Take Photo</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.imgBtn} onPress={pickImage}>
                <Text style={styles.imgBtnText}>Choose Photo</Text>
              </TouchableOpacity>
            </View>
          </View>
          <Text style={styles.formLabel}>Product Name</Text>
          <TextInput
            style={styles.formInput} placeholder="e.g. Bounty Paper Towels"
            placeholderTextColor="#999" value={productName} onChangeText={setProductName}
          />
          <Text style={styles.formLabel}>Quantity</Text>
          <TextInput
            style={[styles.formInput, { width: 80 }]} placeholder="1"
            placeholderTextColor="#999" value={quantity} onChangeText={setQuantity} keyboardType="numeric"
          />
          <Text style={styles.formLabel}>Category</Text>
          <View style={styles.categoryRow}>
            {CATEGORIES.map(cat => (
              <TouchableOpacity
                key={cat.value}
                style={[styles.categoryBtn, { backgroundColor: selectedCategory === cat.value ? cat.color : '#ddd' }]}
                onPress={() => setSelectedCategory(cat.value)}
              >
                <Text style={[styles.categoryBtnText, { color: selectedCategory === cat.value ? 'white' : '#555' }]}>
                  {cat.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
          {(selectedCategory === 'food' || selectedCategory === 'drinks') && (
            <>
              <Text style={styles.formLabel}>
                Expiration Date <Text style={{ color: '#999', fontWeight: 'normal' }}>(optional)</Text>
              </Text>
              <TextInput
                style={styles.formInput} placeholder="MM/DD/YYYY"
                placeholderTextColor="#999" value={expirationDate} onChangeText={setExpirationDate}
              />
            </>
          )}
          <Text style={styles.formLabel}>
            Low Stock Alert <Text style={{ color: '#999', fontWeight: 'normal' }}>(alert when qty reaches this)</Text>
          </Text>
          <TextInput
            style={[styles.formInput, { width: 80 }]}
            placeholder="2"
            placeholderTextColor="#999"
            value={lowStockThreshold}
            onChangeText={setLowStockThreshold}
            keyboardType="numeric"
          />
          <TouchableOpacity style={styles.confirmBtn} onPress={addItem}>
            <Text style={styles.confirmBtnText}>Add to Inventory</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.cancelFormBtn} onPress={() => {
            setProductName(''); setQuantity('1'); setProductImage(null);
            setCurrentBarcode(null); setSelectedCategory('food'); setExpirationDate('');
            setActiveTab('inventory');
          }}>
            <Text style={styles.cancelFormBtnText}>Cancel</Text>
          </TouchableOpacity>
        </ScrollView>
      )}

      {/* ── SHOPPING LIST TAB ── */}
      {activeTab === 'shopping' && (
        <View style={styles.screen}>
          <Text style={styles.title}>Shopping List</Text>
          {shoppingList.length === 0 ? (
            <View style={styles.emptyState}>
              <Text style={styles.emptyStateIcon}>🛒</Text>
              <Text style={styles.emptyStateText}>Nothing out of stock!</Text>
            </View>
          ) : (
            <>
              {Object.values(checkedItems).some(v => v) && (
                <TouchableOpacity
                  style={styles.doneShoppingBtn}
                  onPress={async () => {
                    const checkedIds = Object.keys(checkedItems).filter(id => checkedItems[id]);
                    for (const id of checkedIds) {
                      const qty = parseInt(restockQuantities[id]) || 1;
                      const item = inventory.find(i => i.id === id);
                      if (!item) continue;
                      const newQty = parseInt(item.quantity) + qty;
                      await supabase.from('inventory').update({ quantity: newQty.toString() }).eq('id', id);
                      setInventory(prev => prev.map(i => i.id === id ? { ...i, quantity: newQty.toString() } : i));
                    }
                    setCheckedItems({});
                    setRestockQuantities({});
                  }}
                >
                  <Ionicons name="checkmark-circle" size={20} color="white" />
                  <Text style={styles.doneShoppingText}>
                    Done Shopping ({Object.values(checkedItems).filter(v => v).length} items)
                  </Text>
                </TouchableOpacity>
              )}
              <FlatList
                data={CATEGORIES.filter(cat => shoppingList.some(item => item.category === cat.value))}
                keyExtractor={cat => cat.value}
                renderItem={({ item: cat }) => (
                  <View>
                    <View style={[styles.shoppingCategoryHeader, { borderLeftColor: cat.color }]}>
                      <Text style={[styles.shoppingCategoryLabel, { color: cat.color }]}>{cat.label}</Text>
                      <Text style={styles.shoppingCategoryCount}>
                        {shoppingList.filter(i => i.category === cat.value).length} items
                      </Text>
                    </View>
                    {shoppingList.filter(item => item.category === cat.value).map(item => (
                      <TouchableOpacity
                        key={item.id}
                        style={[styles.shoppingItem, checkedItems[item.id] && styles.shoppingItemChecked]}
                        onPress={() => setCheckedItems(prev => ({ ...prev, [item.id]: !prev[item.id] }))}
                      >
                        <View style={[styles.checkbox, checkedItems[item.id] && styles.checkboxChecked]}>
                          {checkedItems[item.id] && <Ionicons name="checkmark" size={14} color="white" />}
                        </View>
                        {item.image ? (
                          <Image source={{ uri: item.image }} style={styles.itemImage} />
                        ) : (
                          <View style={styles.itemImagePlaceholder} />
                        )}
                        <Text style={[styles.shoppingItemName, checkedItems[item.id] && styles.shoppingItemNameChecked]} numberOfLines={2}>
                          {item.name}
                        </Text>
                        <View style={styles.restockQtyRow}>
                          <Text style={styles.restockQtyLabel}>Qty</Text>
                          <TextInput
                            style={styles.restockQtyInput}
                            value={restockQuantities[item.id] || '1'}
                            onChangeText={(val) => setRestockQuantities(prev => ({ ...prev, [item.id]: val }))}
                            keyboardType="numeric"
                          />
                        </View>
                      </TouchableOpacity>
                    ))}
                  </View>
                )}
              />
            </>
          )}
        </View>
      )}

      {/* ── PROFILE TAB ── */}
      {activeTab === 'profile' && (
        <ScrollView style={styles.screen}>
          <Text style={styles.title}>Profile</Text>
          <View style={styles.profileCard}>
            {/* Tappable avatar — shows photo if set, icon if not */}
            <TouchableOpacity onPress={uploadAvatar} style={styles.avatarContainer}>
              {uploadingAvatar ? (
                <View style={styles.avatarPlaceholder}>
                  <ActivityIndicator color="#27ae60" />
                </View>
              ) : profileAvatar ? (
                <Image source={{ uri: profileAvatar }} style={styles.avatarImage} />
              ) : (
                <View style={styles.avatarPlaceholder}>
                  <Ionicons name="person-circle-outline" size={60} color="#2c3e50" />
                </View>
              )}
              <View style={styles.avatarEditBadge}>
                <Ionicons name="camera-outline" size={14} color="white" />
              </View>
            </TouchableOpacity>
            <Text style={styles.profileEmail}>{user.email}</Text>
            {editingName ? (
              <View style={styles.editNameRow}>
                <TextInput
                  style={styles.editNameInput} value={newName} onChangeText={setNewName}
                  placeholder="Enter your name" placeholderTextColor="#999" autoFocus
                />
                <TouchableOpacity style={styles.saveNameBtn} onPress={saveName}>
                  <Text style={styles.saveNameBtnText}>Save</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <TouchableOpacity onPress={() => { setNewName(profileName); setEditingName(true); }}>
                <Text style={styles.editNameLink}>{profileName ? profileName : '+ Add your name'}</Text>
              </TouchableOpacity>
            )}
          </View>
          <Text style={styles.sectionHeader}>Your Household</Text>
          <View style={styles.profileCard}>
            <View style={styles.codeRow}>
              <Text style={styles.codeLabel}>Join Code</Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <View style={styles.codeBadge}>
                  <Text style={styles.codeText}>{householdCode}</Text>
                </View>
                <TouchableOpacity onPress={shareHouseholdCode} style={styles.shareBtn}>
                  <Ionicons name="share-outline" size={20} color="#27ae60" />
                </TouchableOpacity>
              </View>
            </View>
            <Text style={styles.codeHint}>Share this code with household members</Text>
          </View>
          <Text style={styles.sectionHeader}>Members ({householdMembers.length})</Text>
          <View style={styles.profileCard}>
            {householdMembers.map((member, index) => (
              <View key={member.user_id} style={[styles.memberRow, index < householdMembers.length - 1 && styles.memberRowBorder]}>
                {member.avatar_url ? (
                  <Image source={{ uri: member.avatar_url }} style={styles.memberAvatar} />
                ) : (
                  <Ionicons name="person-circle-outline" size={36} color="#2c3e50" />
                )}
                <View style={styles.memberInfo}>
                  <Text style={styles.memberName}>{member.full_name || 'Unknown'}</Text>
                  <Text style={styles.memberJoined}>Joined {new Date(member.joined_at).toLocaleDateString()}</Text>
                </View>
                {member.user_id === user.id && (
                  <View style={styles.youBadge}><Text style={styles.youBadgeText}>You</Text></View>
                )}
              </View>
            ))}
          </View>
          <TouchableOpacity
            style={styles.logoutBtn}
            onPress={() => {
              Alert.alert('Log Out', 'Are you sure you want to log out?', [
                { text: 'Cancel', style: 'cancel' },
                {
                  text: 'Log Out', style: 'destructive',
                  onPress: async () => {
                    await supabase.auth.signOut();
                    setHouseholdId(null); setInventory([]);
                    setHouseholdMembers([]); setHouseholdCode(''); setActiveTab('inventory');
                  }
                }
              ]);
            }}
          >
            <Text style={styles.logoutBtnText}>Log Out</Text>
          </TouchableOpacity>
          <View style={{ height: 40 }} />
        </ScrollView>
      )}

      {/* ── ITEM DETAIL MODAL ──────────────────────────────────────────────
          Opens when user taps anywhere on a card.
          Shows enlarged image + product info + Edit and Close buttons.
          Edit button closes this modal and opens the edit form modal. */}
      <Modal visible={!!selectedItem} transparent animationType="fade" onRequestClose={() => setSelectedItem(null)}>
        <TouchableOpacity style={styles.imageModalBackdrop} activeOpacity={1} onPress={() => setSelectedItem(null)}>
          <View style={styles.imageModalCard}>
            {/* Large image or placeholder */}
            {selectedItem?.image ? (
              <Image source={{ uri: selectedItem.image }} style={styles.imageModalImage} resizeMode="contain" />
            ) : (
              <View style={styles.imageModalPlaceholder}>
                <Ionicons name="image-outline" size={60} color="#ddd" />
              </View>
            )}

            {/* Product name */}
            <Text style={styles.imageModalName}>{selectedItem?.name}</Text>

            {/* Category badge */}
            <View style={[styles.categoryTag, { backgroundColor: getCategoryColor(selectedItem?.category), alignSelf: 'center', marginBottom: 12 }]}>
              <Text style={styles.categoryTagText}>
                {CATEGORIES.find(c => c.value === selectedItem?.category)?.label || 'Other'}
              </Text>
            </View>

            {/* Info rows */}
            <View style={styles.imageModalInfoRow}>
              <Text style={styles.imageModalLabel}>Quantity</Text>
              <Text style={styles.imageModalValue}>{selectedItem?.quantity}</Text>
            </View>
            {selectedItem?.expiration_date && (
              <View style={styles.imageModalInfoRow}>
                <Text style={styles.imageModalLabel}>Expires</Text>
                <Text style={styles.imageModalValue}>{selectedItem.expiration_date}</Text>
              </View>
            )}
            {selectedItem?.barcode && (
              <View style={styles.imageModalInfoRow}>
                <Text style={styles.imageModalLabel}>Barcode</Text>
                <Text style={styles.imageModalValue}>{selectedItem.barcode}</Text>
              </View>
            )}

            {/* Close + Edit buttons */}
            <View style={{ flexDirection: 'row', gap: 10, marginTop: 16, width: '100%' }}>
              <TouchableOpacity
                style={[styles.imageModalClose, { backgroundColor: '#f0f0f0', flex: 1 }]}
                onPress={() => setSelectedItem(null)}
              >
                <Text style={[styles.imageModalCloseText, { color: '#555' }]}>Close</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.imageModalClose, { flex: 1 }]}
                onPress={() => {
                  // Close detail modal, open edit modal
                  const item = selectedItem;
                  setSelectedItem(null);
                  setEditingItem(item);
                  setEditName(item.name);
                  setEditCategory(item.category);
                  setEditThreshold(item.low_stock_threshold != null ? item.low_stock_threshold.toString() : '2');
                }}
              >
                <Text style={styles.imageModalCloseText}>Edit</Text>
              </TouchableOpacity>
            </View>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* ── EDIT ITEM MODAL ────────────────────────────────────────────────
          Opens from the Edit button inside the detail modal.
          Lets user change name and category, saves to Supabase. */}
      <Modal visible={!!editingItem} transparent animationType="fade" onRequestClose={() => setEditingItem(null)}>
        <View style={styles.editModal}>
          <View style={styles.editModalCard}>
            <Text style={styles.editModalTitle}>Edit Item</Text>
            <TextInput
              style={styles.formInput} value={editName} onChangeText={setEditName}
              placeholder="Product name" placeholderTextColor="#999" autoFocus
            />
            <Text style={[styles.formLabel, { marginTop: 12 }]}>Category</Text>
            <View style={styles.categoryRow}>
              {CATEGORIES.map(cat => (
                <TouchableOpacity
                  key={cat.value}
                  style={[styles.categoryBtn, { backgroundColor: editCategory === cat.value ? cat.color : '#ddd' }]}
                  onPress={() => setEditCategory(cat.value)}
                >
                  <Text style={[styles.categoryBtnText, { color: editCategory === cat.value ? 'white' : '#555' }]}>
                    {cat.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
            <Text style={[styles.formLabel, { marginTop: 12 }]}>Low Stock Alert</Text>
            <TextInput
              style={[styles.formInput, { width: 80 }]}
              value={editThreshold}
              onChangeText={setEditThreshold}
              placeholder="2"
              placeholderTextColor="#999"
              keyboardType="numeric"
            />
            <TouchableOpacity style={styles.confirmBtn} onPress={saveItemEdit}>
              <Text style={styles.confirmBtnText}>Save Changes</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.cancelFormBtn} onPress={() => setEditingItem(null)}>
              <Text style={styles.cancelFormBtnText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* ── BOTTOM TAB BAR ── */}
      <View style={styles.tabBar}>
        <TouchableOpacity style={styles.tabItem} onPress={() => setActiveTab('inventory')}>
          <Ionicons name={activeTab === 'inventory' ? 'grid' : 'grid-outline'} size={24} color={activeTab === 'inventory' ? '#27ae60' : '#999'} />
          <Text style={[styles.tabLabel, activeTab === 'inventory' && styles.tabLabelActive]}>Inventory</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.tabItem} onPress={() => {
          setProductName(''); setQuantity('1'); setProductImage(null);
          setCurrentBarcode(null); setSelectedCategory('food'); setExpirationDate('');
          setActiveTab('add');
        }}>
          <Ionicons name={activeTab === 'add' ? 'add-circle' : 'add-circle-outline'} size={24} color={activeTab === 'add' ? '#27ae60' : '#999'} />
          <Text style={[styles.tabLabel, activeTab === 'add' && styles.tabLabelActive]}>Add</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.tabItem} onPress={() => setActiveTab('scan')}>
          <View style={styles.scanTabBtn}>
            <Ionicons name="barcode-outline" size={28} color="white" />
          </View>
          <Text style={[styles.tabLabel, activeTab === 'scan' && styles.tabLabelActive]}>Scan</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.tabItem} onPress={() => setActiveTab('shopping')}>
          <View>
            <Ionicons name={activeTab === 'shopping' ? 'cart' : 'cart-outline'} size={24} color={activeTab === 'shopping' ? '#27ae60' : '#999'} />
            {shoppingList.length > 0 && (
              <View style={styles.badge}>
                <Text style={styles.badgeText}>{shoppingList.length}</Text>
              </View>
            )}
          </View>
          <Text style={[styles.tabLabel, activeTab === 'shopping' && styles.tabLabelActive]}>Shopping</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.tabItem} onPress={() => setActiveTab('profile')}>
          <Ionicons name={activeTab === 'profile' ? 'person' : 'person-outline'} size={24} color={activeTab === 'profile' ? '#27ae60' : '#999'} />
          <Text style={[styles.tabLabel, activeTab === 'profile' && styles.tabLabelActive]}>Profile</Text>
        </TouchableOpacity>
      </View>

    </View>
  );
}

// ─── STYLES ─────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f4f4f4' },
  screen: { flex: 1, paddingTop: 60, paddingHorizontal: 20 },
  title: { fontSize: 26, fontWeight: 'bold', color: '#2c3e50', textAlign: 'center', marginBottom: 16 },
  searchBar: { backgroundColor: 'white', padding: 10, borderRadius: 8, fontSize: 14, marginBottom: 10, color: '#333' },
  filterSortRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 8 },
  filterScroll: { flex: 1 },
  filterTab: { paddingHorizontal: 14, paddingVertical: 6, borderRadius: 20, backgroundColor: '#ddd', marginRight: 8 },
  filterTabActive: { backgroundColor: '#2c3e50' },
  filterTabText: { fontSize: 13, color: '#555', fontWeight: 'bold' },
  filterTabTextActive: { color: 'white' },
  sortBtn: { backgroundColor: '#2c3e50', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8, marginLeft: 8, flexDirection: 'row', alignItems: 'center', gap: 4 },
  sortBtnText: { color: 'white', fontSize: 13, fontWeight: 'bold' },
  sortDropdown: { backgroundColor: 'white', borderRadius: 8, marginBottom: 10, overflow: 'hidden', elevation: 3, shadowColor: '#000', shadowOpacity: 0.1, shadowRadius: 4 },
  sortOption: { padding: 12, borderBottomWidth: 1, borderBottomColor: '#f0f0f0' },
  sortOptionActive: { backgroundColor: '#2c3e50' },
  sortOptionText: { fontSize: 14, color: '#333' },
  sortOptionTextActive: { color: 'white', fontWeight: 'bold' },
  emptyState: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingTop: 60 },
  emptyStateIcon: { fontSize: 48, marginBottom: 12 },
  emptyStateText: { fontSize: 16, color: '#999', textAlign: 'center' },
  item: { backgroundColor: 'white', padding: 12, borderRadius: 8, marginBottom: 10, flexDirection: 'row', alignItems: 'center', gap: 10 },
  itemLowStock: { backgroundColor: '#fff5f5', borderWidth: 1, borderColor: '#e74c3c' },
  itemImage: { width: 50, height: 50, borderRadius: 6 },
  itemImagePlaceholder: { width: 50, height: 50, borderRadius: 6, backgroundColor: '#ddd', justifyContent: 'center', alignItems: 'center' },
  itemInfo: { flex: 1 },
  itemName: { fontSize: 13, color: '#2c3e50', marginBottom: 4 },
  itemTagRow: { flexDirection: 'row', gap: 6, flexWrap: 'wrap' },
  categoryTag: { alignSelf: 'flex-start', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10 },
  categoryTagText: { color: 'white', fontSize: 11, fontWeight: 'bold' },
  lowStockTag: { backgroundColor: '#e74c3c', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10 },
  lowStockTagText: { color: 'white', fontSize: 11, fontWeight: 'bold' },
  expirationTag: { backgroundColor: '#27ae60', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10 },
  expirationTagText: { color: 'white', fontSize: 11, fontWeight: 'bold' },
  expiringSoonTag: { backgroundColor: '#f39c12', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10 },
  expiringSoonTagText: { color: 'white', fontSize: 11, fontWeight: 'bold' },
  expiredTag: { backgroundColor: '#e74c3c', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10 },
  expiredTagText: { color: 'white', fontSize: 11, fontWeight: 'bold' },
  compactItem: { backgroundColor: 'white', paddingHorizontal: 14, paddingVertical: 10, borderRadius: 8, marginBottom: 6, flexDirection: 'row', alignItems: 'center', gap: 10 },
  compactDot: { width: 10, height: 10, borderRadius: 5 },
  compactName: { flex: 1, fontSize: 14, color: '#2c3e50', fontWeight: '500' },
  compactLowStock: { fontSize: 14 },
  qtyControls: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  qtyBtn: { backgroundColor: '#f0f0f0', width: 28, height: 28, borderRadius: 14, justifyContent: 'center', alignItems: 'center' },
  qtyBtnText: { fontSize: 16, color: '#2c3e50', fontWeight: 'bold' },
  qtyNumber: { fontSize: 15, fontWeight: 'bold', color: '#2c3e50', minWidth: 20, textAlign: 'center' },
  qtyLow: { color: '#e74c3c' },
  deleteBtn: { color: '#e74c3c', fontSize: 16, fontWeight: 'bold' },
  addContent: { paddingBottom: 40 },
  addImageRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 20, gap: 16 },
  addPreviewImage: { width: 100, height: 100, borderRadius: 12 },
  addImagePlaceholder: { width: 100, height: 100, borderRadius: 12, backgroundColor: '#ddd', justifyContent: 'center', alignItems: 'center' },
  addImagePlaceholderText: { color: '#999', fontSize: 12 },
  addImageBtns: { flex: 1, gap: 10 },
  imgBtn: { backgroundColor: '#2c3e50', padding: 10, borderRadius: 8, alignItems: 'center' },
  imgBtnText: { color: 'white', fontSize: 13 },
  formLabel: { fontSize: 14, fontWeight: 'bold', color: '#2c3e50', marginBottom: 6, marginTop: 12 },
  formInput: { backgroundColor: 'white', padding: 12, borderRadius: 8, fontSize: 15, color: '#333' },
  categoryRow: { flexDirection: 'row', gap: 8, marginTop: 4 },
  categoryBtn: { flex: 1, padding: 10, borderRadius: 8, alignItems: 'center' },
  categoryBtnText: { fontSize: 12, fontWeight: 'bold' },
  confirmBtn: { backgroundColor: '#27ae60', padding: 16, borderRadius: 10, alignItems: 'center', marginTop: 24 },
  confirmBtnText: { color: 'white', fontSize: 16, fontWeight: 'bold' },
  cancelFormBtn: { padding: 14, alignItems: 'center', marginTop: 8 },
  cancelFormBtnText: { color: '#999', fontSize: 15 },
  doneShoppingBtn: { backgroundColor: '#27ae60', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', padding: 14, borderRadius: 10, marginBottom: 16, gap: 8 },
  doneShoppingText: { color: 'white', fontSize: 15, fontWeight: 'bold' },
  shoppingCategoryHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 8, paddingLeft: 10, marginTop: 8, marginBottom: 4, borderLeftWidth: 4 },
  shoppingCategoryLabel: { fontSize: 13, fontWeight: 'bold', textTransform: 'uppercase', letterSpacing: 1 },
  shoppingCategoryCount: { fontSize: 12, color: '#999' },
  shoppingItem: { backgroundColor: 'white', padding: 12, borderRadius: 8, marginBottom: 8, flexDirection: 'row', alignItems: 'center', gap: 10 },
  shoppingItemChecked: { backgroundColor: '#f0f9f4', borderWidth: 1, borderColor: '#27ae60', opacity: 0.7 },
  shoppingItemName: { flex: 1, fontSize: 13, color: '#2c3e50' },
  shoppingItemNameChecked: { textDecorationLine: 'line-through', color: '#999' },
  checkbox: { width: 24, height: 24, borderRadius: 12, borderWidth: 2, borderColor: '#ddd', justifyContent: 'center', alignItems: 'center' },
  checkboxChecked: { backgroundColor: '#27ae60', borderColor: '#27ae60' },
  restockQtyRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  restockQtyLabel: { fontSize: 12, color: '#999' },
  restockQtyInput: { backgroundColor: '#f4f4f4', width: 40, padding: 6, borderRadius: 6, fontSize: 13, textAlign: 'center' },
  scanOverlay: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  scanTitle: { color: 'white', fontSize: 20, fontWeight: 'bold', marginBottom: 30 },
  scanBox: { width: 260, height: 160, borderWidth: 3, borderColor: '#27ae60', borderRadius: 12, marginBottom: 20 },
  scanHint: { color: 'white', fontSize: 14, opacity: 0.8 },
  scanCancelRow: { paddingBottom: 40, alignItems: 'center' },
  scanCancelBtn: { backgroundColor: 'rgba(0,0,0,0.6)', paddingHorizontal: 30, paddingVertical: 14, borderRadius: 30 },
  scanCancelText: { color: 'white', fontSize: 16 },
  lookupScreen: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#f4f4f4' },
  lookupText: { marginTop: 16, fontSize: 16, color: '#2c3e50' },
  tabBar: { flexDirection: 'row', backgroundColor: 'white', borderTopWidth: 1, borderTopColor: '#e0e0e0', paddingBottom: 24, paddingTop: 10 },
  tabItem: { flex: 1, alignItems: 'center', position: 'relative' },
  tabLabel: { fontSize: 11, color: '#999' },
  tabLabelActive: { color: '#27ae60', fontWeight: 'bold' },
  scanTabBtn: { width: 52, height: 52, borderRadius: 26, backgroundColor: '#27ae60', justifyContent: 'center', alignItems: 'center', marginTop: -20, shadowColor: '#27ae60', shadowOpacity: 0.4, shadowRadius: 8, elevation: 6 },
  badge: { position: 'absolute', top: 0, right: -6, backgroundColor: '#e74c3c', borderRadius: 10, minWidth: 18, height: 18, justifyContent: 'center', alignItems: 'center' },
  badgeText: { color: 'white', fontSize: 11, fontWeight: 'bold' },
  profileCard: { backgroundColor: 'white', borderRadius: 12, padding: 20, marginBottom: 16 },
  profileEmail: { fontSize: 16, color: '#2c3e50', fontWeight: 'bold', marginTop: 12 },
  sectionHeader: { fontSize: 13, fontWeight: 'bold', color: '#999', marginBottom: 8, marginLeft: 4, textTransform: 'uppercase', letterSpacing: 1 },
  codeRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  codeLabel: { fontSize: 15, color: '#2c3e50', fontWeight: 'bold' },
  codeBadge: { backgroundColor: '#2c3e50', paddingHorizontal: 16, paddingVertical: 8, borderRadius: 8 },
  codeText: { color: 'white', fontSize: 18, fontWeight: 'bold', letterSpacing: 3 },
  codeHint: { fontSize: 12, color: '#999', marginTop: 8 },
  shareBtn: { padding: 6 },
  memberRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, gap: 12 },
  memberRowBorder: { borderBottomWidth: 1, borderBottomColor: '#f0f0f0' },
  memberInfo: { flex: 1 },
  memberName: { fontSize: 15, color: '#2c3e50', fontWeight: 'bold' },
  memberJoined: { fontSize: 12, color: '#999', marginTop: 2 },
  youBadge: { backgroundColor: '#27ae60', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 10 },
  youBadgeText: { color: 'white', fontSize: 11, fontWeight: 'bold' },
  logoutBtn: { backgroundColor: '#e74c3c', padding: 16, borderRadius: 10, alignItems: 'center', marginBottom: 16 },
  logoutBtnText: { color: 'white', fontSize: 16, fontWeight: 'bold' },
  editNameRow: { flexDirection: 'row', alignItems: 'center', marginTop: 12, gap: 8 },
  editNameInput: { flex: 1, backgroundColor: '#f4f4f4', padding: 10, borderRadius: 8, fontSize: 15, color: '#333' },
  saveNameBtn: { backgroundColor: '#27ae60', padding: 10, borderRadius: 8 },
  saveNameBtnText: { color: 'white', fontWeight: 'bold' },
  editNameLink: { color: '#27ae60', fontSize: 15, marginTop: 8, fontWeight: 'bold' },
  // Item Detail Modal
  imageModalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'center', alignItems: 'center' },
  imageModalCard: { backgroundColor: 'white', borderRadius: 20, padding: 24, width: '88%', alignItems: 'center' },
  imageModalImage: { width: 220, height: 220, borderRadius: 12, marginBottom: 16 },
  imageModalPlaceholder: { width: 220, height: 220, borderRadius: 12, backgroundColor: '#f4f4f4', justifyContent: 'center', alignItems: 'center', marginBottom: 16 },
  imageModalName: { fontSize: 18, fontWeight: 'bold', color: '#2c3e50', textAlign: 'center', marginBottom: 10 },
  imageModalInfoRow: { flexDirection: 'row', justifyContent: 'space-between', width: '100%', paddingVertical: 8, borderTopWidth: 1, borderTopColor: '#f0f0f0' },
  imageModalLabel: { fontSize: 14, color: '#999' },
  imageModalValue: { fontSize: 14, fontWeight: 'bold', color: '#2c3e50' },
  imageModalClose: { backgroundColor: '#2c3e50', paddingHorizontal: 32, paddingVertical: 12, borderRadius: 10, alignItems: 'center' },
  imageModalCloseText: { color: 'white', fontWeight: 'bold', fontSize: 15 },
  // Edit Item Modal
  editModal: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center' },
  editModalCard: { backgroundColor: 'white', borderRadius: 16, padding: 24, width: '90%' },
  editModalTitle: { fontSize: 18, fontWeight: 'bold', color: '#2c3e50', marginBottom: 12 },
  avatarContainer: { position: 'relative', alignSelf: 'center', marginBottom: 4 },
  avatarImage: { width: 80, height: 80, borderRadius: 40 },
  avatarPlaceholder: { width: 80, height: 80, borderRadius: 40, backgroundColor: '#f0f0f0', justifyContent: 'center', alignItems: 'center' },
  avatarEditBadge: { position: 'absolute', bottom: 0, right: 0, backgroundColor: '#27ae60', borderRadius: 12, width: 24, height: 24, justifyContent: 'center', alignItems: 'center' },
  memberAvatar: { width: 36, height: 36, borderRadius: 18 },
});