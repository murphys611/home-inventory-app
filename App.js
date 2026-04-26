// ─── IMPORTS ───────────────────────────────────────────────────────────────
import { useState, useEffect, useRef } from 'react';
import {
  StyleSheet, Text, View, TouchableOpacity, FlatList,
  TextInput, Alert, Image, ActivityIndicator, ScrollView, Share
} from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as ImagePicker from 'expo-image-picker';
import * as Notifications from 'expo-notifications';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from './supabase';
import AuthScreen from './AuthScreen';
import HouseholdScreen from './HouseholdScreen';

// ─── CONSTANTS ─────────────────────────────────────────────────────────────

// Category definitions — label shown in UI, value stored in DB, color for tags
const CATEGORIES = [
  { label: 'Food', value: 'food', color: '#e67e22' },
  { label: 'Drinks', value: 'drinks', color: '#16a085' },
  { label: 'Cleaning', value: 'cleaning', color: '#2980b9' },
  { label: 'Hygiene', value: 'hygiene', color: '#8e44ad' },
  { label: 'Other', value: 'other', color: '#7f8c8d' },
];

// Items at or below this quantity trigger a low stock alert
const LOW_STOCK_THRESHOLD = 2;

// ─── NOTIFICATION HANDLER ──────────────────────────────────────────────────
// Configures how notifications appear when the app is in the foreground
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
  const [user, setUser] = useState(null);               // Logged in user object
  const [householdId, setHouseholdId] = useState(null); // Current household ID
  const [checkingAuth, setCheckingAuth] = useState(true); // True while checking session on startup

  // ── Camera Permission ───────────────────────────────────────────────────
  const [permission, requestPermission] = useCameraPermissions();

  // ── Navigation ──────────────────────────────────────────────────────────
  const [activeTab, setActiveTab] = useState('inventory'); // Currently visible tab
  const [scanning, setScanning] = useState(false);         // Whether barcode camera is open

  // ── Inventory State ─────────────────────────────────────────────────────
  const [inventory, setInventory] = useState([]);     // All inventory items from Supabase
  const [loading, setLoading] = useState(true);       // Loading spinner for inventory list

  // ── Search, Filter & Sort ───────────────────────────────────────────────
  const [searchQuery, setSearchQuery] = useState('');          // Search bar text
  const [filterCategory, setFilterCategory] = useState('all'); // Active category filter
  const [sortBy, setSortBy] = useState('name');                // Active sort option
  const [showSortOptions, setShowSortOptions] = useState(false); // Sort dropdown visibility
  const [compactView, setCompactView] = useState(false);       // Toggle: card view vs compact list

  // ── Add Item Form State ─────────────────────────────────────────────────
  const [productName, setProductName] = useState('');          // Product name input
  const [quantity, setQuantity] = useState('1');               // Quantity input
  const [productImage, setProductImage] = useState(null);      // Product image URI
  const [currentBarcode, setCurrentBarcode] = useState(null);  // Barcode from last scan
  const [selectedCategory, setSelectedCategory] = useState('food'); // Selected category
  const [scanStatus, setScanStatus] = useState('');            // Status message after scan
  const [expirationDate, setExpirationDate] = useState('');    // Optional expiration date (MM/DD/YYYY)

  // ── Shopping List State ─────────────────────────────────────────────────
  const [checkedItems, setCheckedItems] = useState({});        // Tracks checked items by ID
  const [restockQuantities, setRestockQuantities] = useState({}); // Restock qty per item

  // ── Profile State ───────────────────────────────────────────────────────
  const [householdCode, setHouseholdCode] = useState('');      // Household join code
  const [householdMembers, setHouseholdMembers] = useState([]); // All household members
  const [profileName, setProfileName] = useState('');          // Current user's display name
  const [editingName, setEditingName] = useState(false);       // Whether name edit is active
  const [newName, setNewName] = useState('');                  // Name input while editing

  // ── Refs ────────────────────────────────────────────────────────────────
  const scanned = useRef(false);     // Prevents duplicate barcode scans
  const cameraReady = useRef(false); // Delays scan detection until camera is ready

  // ─── AUTH LISTENER ─────────────────────────────────────────────────────
  // Listens for auth state changes including session restore on startup
  // INITIAL_SESSION fires when a saved session is restored from AsyncStorage
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

  // ─── LOAD INVENTORY + SUBSCRIBE TO CHANGES WHEN HOUSEHOLD IS SET ───────
  useEffect(() => {
    if (householdId) {
      loadInventory();
      requestNotificationPermission();

      // Subscribe to real-time changes on the inventory table
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

  // ─── AUTO OPEN CAMERA WHEN SCAN TAB IS TAPPED ──────────────────────────
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

  // Loads user's household, join code, profile name, and all member names
  const loadHousehold = async () => {
    try {
      const { data } = await supabase
        .from('household_members')
        .select('household_id')
        .eq('user_id', user.id)
        .single();
      if (data) {
        setHouseholdId(data.household_id);

        // Get the household join code
        const { data: household } = await supabase
          .from('households')
          .select('code')
          .eq('id', data.household_id)
          .single();
        if (household) setHouseholdCode(household.code);

        // Get current user's display name
        const { data: myProfile } = await supabase
          .from('profiles')
          .select('full_name')
          .eq('id', user.id)
          .single();
        if (myProfile) setProfileName(myProfile.full_name || '');

        // Get all household members and their names
        const { data: members } = await supabase
          .from('household_members')
          .select('user_id, joined_at')
          .eq('household_id', data.household_id);
        if (members) {
          const { data: profiles } = await supabase
            .from('profiles')
            .select('id, full_name')
            .in('id', members.map(m => m.user_id));
          const membersWithNames = members.map(member => ({
            ...member,
            full_name: profiles?.find(p => p.id === member.user_id)?.full_name || 'Unknown'
          }));
          setHouseholdMembers(membersWithNames);
        }
      }
    } catch (e) {
      console.log('No household found');
    }
  };

  // Saves or updates the user's display name in the profiles table
  const saveName = async () => {
    try {
      const { data: existing } = await supabase
        .from('profiles')
        .select('id')
        .eq('id', user.id)
        .single();
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

  // Shares the household join code using the native OS share sheet
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

  // ─── NOTIFICATION FUNCTIONS ─────────────────────────────────────────────

  // Requests permission to send push notifications
  const requestNotificationPermission = async () => {
    const { status } = await Notifications.requestPermissionsAsync();
    if (status !== 'granted') console.log('Notification permission denied');
  };

  // Fires an immediate push notification when an item is low or out of stock
  const sendLowStockNotification = async (itemName, qty) => {
    await Notifications.scheduleNotificationAsync({
      content: {
        title: '⚠️ Low Stock Alert',
        body: qty === 0
          ? `${itemName} is out of stock!`
          : `${itemName} is running low — only ${qty} left.`,
        sound: true,
      },
      trigger: null, // null = send immediately
    });
  };

  // ─── INVENTORY FUNCTIONS ────────────────────────────────────────────────

  // Loads all inventory items for the current household from Supabase
  const loadInventory = async () => {
    try {
      const { data, error } = await supabase
        .from('inventory')
        .select('*')
        .eq('household_id', householdId);
      if (error) throw error;
      if (data) setInventory(data);
    } catch (e) {
      console.log('Failed to load inventory', e);
    } finally {
      setLoading(false);
    }
  };

  // Inserts a new item into Supabase and updates local state
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
    };
    if (currentBarcode) {
      saveToLocalCache(currentBarcode, productName, selectedCategory, productImage);
    }
    try {
      const { error } = await supabase.from('inventory').insert([newItem]);
      if (error) throw error;
      setInventory(prev => [...prev, newItem]);
      // Reset all form fields after adding
      setProductName('');
      setQuantity('1');
      setProductImage(null);
      setCurrentBarcode(null);
      setSelectedCategory('food');
      setExpirationDate('');
      setActiveTab('inventory');
    } catch (e) {
      Alert.alert('Failed to add item: ' + JSON.stringify(e));
    }
  };

  // Deletes an item from Supabase and removes it from local state
  const deleteItem = async (id) => {
    try {
      const { error } = await supabase.from('inventory').delete().eq('id', id);
      if (error) throw error;
      setInventory(prev => prev.filter(item => item.id !== id));
    } catch (e) {
      Alert.alert('Failed to delete item.');
    }
  };

  // Updates an item's quantity by delta (+1 or -1).
  // Notifications only fire when quantity lands EXACTLY on the threshold or hits 0.
  // This prevents spamming alerts on every tap below the threshold.
  const changeQuantity = async (id, delta) => {
    const item = inventory.find(i => i.id === id);
    if (!item) return;
    const newQty = Math.max(0, parseInt(item.quantity) + delta);
    if (newQty === LOW_STOCK_THRESHOLD || newQty === 0) {
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
        setProductName(cached.name);
        setProductImage(cached.image);
        setSelectedCategory(cached.category);
        setScanStatus('');
        setActiveTab('add');
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
            setProductName(name);
            setProductImage(image);
            setSelectedCategory(category);
            setScanStatus('');
            setActiveTab('add');
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
            setProductName(name);
            setProductImage(image);
            setSelectedCategory(category);
            setScanStatus('');
            setActiveTab('add');
          }
        } else {
          setScanStatus('');
          Alert.alert(
            'Product Not Found',
            'This barcode wasn\'t recognized. You can add it manually — next time you scan this barcode it will be remembered automatically.',
            [
              {
                text: 'Add Manually',
                onPress: () => {
                  setProductName('');
                  setProductImage(null);
                  setSelectedCategory('other');
                  setActiveTab('add');
                }
              },
              { text: 'Cancel', style: 'cancel', onPress: () => setActiveTab('inventory') }
            ]
          );
        }
      })
      .catch(() => {
        setScanStatus('');
        Alert.alert(
          'Lookup Failed',
          'Could not connect to product database. You can add it manually.',
          [
            {
              text: 'Add Manually',
              onPress: () => {
                setProductName('');
                setProductImage(null);
                setSelectedCategory('other');
                setActiveTab('add');
              }
            },
            { text: 'Cancel', style: 'cancel', onPress: () => setActiveTab('inventory') }
          ]
        );
      });
  };

  // ─── CATEGORY DETECTION ─────────────────────────────────────────────────

  const detectCategory = (tags) => {
    if (!tags) return 'other';
    const tagString = Array.isArray(tags) ? tags.join(' ').toLowerCase() : tags.toLowerCase();
    if (tagString.includes('hygiene') || tagString.includes('beauty') ||
      tagString.includes('personal-care') || tagString.includes('hair-care') ||
      tagString.includes('oral-care') || tagString.includes('skin-care') ||
      tagString.includes('body-care') || tagString.includes('cosmetic') ||
      tagString.includes('deodorant') || tagString.includes('shampoo') ||
      tagString.includes('conditioner') || tagString.includes('toothpaste') ||
      tagString.includes('mouthwash') || tagString.includes('chapstick') ||
      tagString.includes('lip-balm')) return 'hygiene';
    if (tagString.includes('clean') || tagString.includes('household') ||
      tagString.includes('detergent') || tagString.includes('laundry') ||
      tagString.includes('dishwash')) return 'cleaning';
    if (tagString.includes('beverage') || tagString.includes('drink') ||
      tagString.includes('juice') || tagString.includes('soda') ||
      tagString.includes('water') || tagString.includes('coffee') ||
      tagString.includes('tea')) return 'drinks';
    if (tagString.includes('food') || tagString.includes('dairy') ||
      tagString.includes('snack') || tagString.includes('grocery')) return 'food';
    return 'other';
  };

  const detectCategoryFromString = (category) => {
    if (!category) return 'other';
    const cat = category.toLowerCase();
    if (cat.includes('health') || cat.includes('beauty') || cat.includes('personal') ||
      cat.includes('hair') || cat.includes('skin') || cat.includes('oral') ||
      cat.includes('hygiene') || cat.includes('cosmetic')) return 'hygiene';
    if (cat.includes('clean') || cat.includes('household') || cat.includes('laundry') ||
      cat.includes('paper') || cat.includes('towel') || cat.includes('detergent')) return 'cleaning';
    if (cat.includes('beverage') || cat.includes('drink') || cat.includes('juice') ||
      cat.includes('soda') || cat.includes('water') || cat.includes('coffee') ||
      cat.includes('tea')) return 'drinks';
    if (cat.includes('food') || cat.includes('grocery') || cat.includes('snack')) return 'food';
    return 'other';
  };

  // ─── IMAGE PICKER FUNCTIONS ─────────────────────────────────────────────

  const pickImage = async () => {
    let result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.5,
    });
    if (!result.canceled) setProductImage(result.assets[0].uri);
  };

  const takePhoto = async () => {
    let result = await ImagePicker.launchCameraAsync({
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.5,
    });
    if (!result.canceled) setProductImage(result.assets[0].uri);
  };

  // ─── HELPER FUNCTIONS ───────────────────────────────────────────────────

  const getCategoryColor = (value) => {
    const cat = CATEGORIES.find(c => c.value === value);
    return cat ? cat.color : '#7f8c8d';
  };

  const isLowStock = (qty) => parseInt(qty) <= LOW_STOCK_THRESHOLD;

  const getFilteredAndSorted = () => {
    let result = [...inventory];
    if (searchQuery.trim() !== '') {
      result = result.filter(item =>
        item.name.toLowerCase().includes(searchQuery.toLowerCase())
      );
    }
    if (filterCategory !== 'all') {
      result = result.filter(item => item.category === filterCategory);
    }
    if (sortBy === 'name') {
      result.sort((a, b) => a.name.localeCompare(b.name));
    } else if (sortBy === 'category') {
      result.sort((a, b) => (a.category || '').localeCompare(b.category || ''));
    } else if (sortBy === 'lowstock') {
      result.sort((a, b) => parseInt(a.quantity) - parseInt(b.quantity));
    }
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
          onCameraReady={() => {
            setTimeout(() => { cameraReady.current = true; }, 1500);
          }}
        />
        <View style={styles.scanOverlay}>
          <Text style={styles.scanTitle}>Scan a Barcode</Text>
          <View style={styles.scanBox} />
          <Text style={styles.scanHint}>Point at a barcode to scan</Text>
        </View>
        <View style={styles.scanCancelRow}>
          <TouchableOpacity style={styles.scanCancelBtn} onPress={() => {
            setScanning(false);
            scanned.current = false;
            cameraReady.current = false;
            setActiveTab('inventory');
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

          {/* Search Bar */}
          <TextInput
            style={styles.searchBar}
            placeholder="🔍 Search inventory..."
            placeholderTextColor="#999"
            value={searchQuery}
            onChangeText={setSearchQuery}
          />

          {/* Category Filter Tabs + Sort + View Toggle */}
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

            {/* View Toggle Button — switches between card and compact list */}
            <TouchableOpacity style={styles.sortBtn} onPress={() => setCompactView(prev => !prev)}>
              <Ionicons
                name={compactView ? 'grid-outline' : 'list-outline'}
                size={16}
                color="white"
              />
            </TouchableOpacity>

            <TouchableOpacity style={[styles.sortBtn, { marginLeft: 6 }]} onPress={() => setShowSortOptions(!showSortOptions)}>
              <Text style={styles.sortBtnText}>⇅ Sort</Text>
            </TouchableOpacity>
          </View>

          {/* Sort Dropdown */}
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

          {/* Inventory List */}
          {loading ? (
            <View style={styles.emptyState}>
              <ActivityIndicator size="large" color="#2c3e50" />
              <Text style={styles.emptyStateText}>Loading inventory...</Text>
            </View>
          ) : getFilteredAndSorted().length === 0 ? (
            <View style={styles.emptyState}>
              <Text style={styles.emptyStateIcon}>📦</Text>
              <Text style={styles.emptyStateText}>
                {searchQuery || filterCategory !== 'all'
                  ? 'No items match your search.'
                  : 'No items yet. Tap Scan to get started!'}
              </Text>
            </View>
          ) : compactView ? (
            /* ── COMPACT LIST VIEW ── names, qty controls, low stock indicator only */
            <FlatList
              data={getFilteredAndSorted()}
              keyExtractor={item => item.id}
              renderItem={({ item }) => (
                <View style={[styles.compactItem, isLowStock(item.quantity) && styles.itemLowStock]}>
                  {/* Category color dot */}
                  <View style={[styles.compactDot, { backgroundColor: getCategoryColor(item.category) }]} />
                  {/* Product Name */}
                  <Text style={styles.compactName} numberOfLines={1}>{item.name}</Text>
                  {/* Low stock indicator */}
                  {isLowStock(item.quantity) && (
                    <Text style={styles.compactLowStock}>
                      {parseInt(item.quantity) === 0 ? '⚠️' : '⚠️'}
                    </Text>
                  )}
                  {/* Quantity Controls */}
                  <View style={styles.qtyControls}>
                    <TouchableOpacity style={styles.qtyBtn} onPress={() => changeQuantity(item.id, -1)}>
                      <Text style={styles.qtyBtnText}>−</Text>
                    </TouchableOpacity>
                    <Text style={[styles.qtyNumber, isLowStock(item.quantity) && styles.qtyLow]}>
                      {item.quantity}
                    </Text>
                    <TouchableOpacity style={styles.qtyBtn} onPress={() => changeQuantity(item.id, 1)}>
                      <Text style={styles.qtyBtnText}>+</Text>
                    </TouchableOpacity>
                  </View>
                  {/* Delete */}
                  <TouchableOpacity onPress={() => deleteItem(item.id)}>
                    <Text style={styles.deleteBtn}>✕</Text>
                  </TouchableOpacity>
                </View>
              )}
            />
          ) : (
            /* ── CARD VIEW (default) ── full cards with images and tags */
            <FlatList
              data={getFilteredAndSorted()}
              keyExtractor={item => item.id}
              renderItem={({ item }) => (
                <View style={[styles.item, isLowStock(item.quantity) && styles.itemLowStock]}>
                  {item.image ? (
                    <Image source={{ uri: item.image }} style={styles.itemImage} />
                  ) : (
                    <View style={styles.itemImagePlaceholder} />
                  )}
                  <View style={styles.itemInfo}>
                    <Text style={styles.itemName} numberOfLines={2}>{item.name}</Text>
                    <View style={styles.itemTagRow}>
                      <View style={[styles.categoryTag, { backgroundColor: getCategoryColor(item.category) }]}>
                        <Text style={styles.categoryTagText}>
                          {CATEGORIES.find(c => c.value === item.category)?.label || 'Other'}
                        </Text>
                      </View>
                      {isLowStock(item.quantity) && (
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
                          <View style={styles.expiredTag}>
                            <Text style={styles.expiredTagText}>⚠️ Expired</Text>
                          </View>
                        );
                        if (daysUntil <= 7) return (
                          <View style={styles.expiringSoonTag}>
                            <Text style={styles.expiringSoonTagText}>⏰ {daysUntil}d left</Text>
                          </View>
                        );
                        return (
                          <View style={styles.expirationTag}>
                            <Text style={styles.expirationTagText}>📅 {item.expiration_date}</Text>
                          </View>
                        );
                      })()}
                    </View>
                  </View>
                  <View style={styles.qtyControls}>
                    <TouchableOpacity style={styles.qtyBtn} onPress={() => changeQuantity(item.id, -1)}>
                      <Text style={styles.qtyBtnText}>−</Text>
                    </TouchableOpacity>
                    <Text style={[styles.qtyNumber, isLowStock(item.quantity) && styles.qtyLow]}>
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
            style={styles.formInput}
            placeholder="e.g. Bounty Paper Towels"
            placeholderTextColor="#999"
            value={productName}
            onChangeText={setProductName}
          />

          <Text style={styles.formLabel}>Quantity</Text>
          <TextInput
            style={[styles.formInput, { width: 80 }]}
            placeholder="1"
            placeholderTextColor="#999"
            value={quantity}
            onChangeText={setQuantity}
            keyboardType="numeric"
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
                style={styles.formInput}
                placeholder="MM/DD/YYYY"
                placeholderTextColor="#999"
                value={expirationDate}
                onChangeText={setExpirationDate}
              />
            </>
          )}

          <TouchableOpacity style={styles.confirmBtn} onPress={addItem}>
            <Text style={styles.confirmBtnText}>Add to Inventory</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.cancelFormBtn} onPress={() => {
            setProductName('');
            setQuantity('1');
            setProductImage(null);
            setCurrentBarcode(null);
            setSelectedCategory('food');
            setExpirationDate('');
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
                data={CATEGORIES.filter(cat =>
                  shoppingList.some(item => item.category === cat.value)
                )}
                keyExtractor={cat => cat.value}
                renderItem={({ item: cat }) => (
                  <View>
                    <View style={[styles.shoppingCategoryHeader, { borderLeftColor: cat.color }]}>
                      <Text style={[styles.shoppingCategoryLabel, { color: cat.color }]}>
                        {cat.label}
                      </Text>
                      <Text style={styles.shoppingCategoryCount}>
                        {shoppingList.filter(i => i.category === cat.value).length} items
                      </Text>
                    </View>
                    {shoppingList
                      .filter(item => item.category === cat.value)
                      .map(item => (
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
            <Ionicons name="person-circle-outline" size={60} color="#2c3e50" />
            <Text style={styles.profileEmail}>{user.email}</Text>
            {editingName ? (
              <View style={styles.editNameRow}>
                <TextInput
                  style={styles.editNameInput}
                  value={newName}
                  onChangeText={setNewName}
                  placeholder="Enter your name"
                  placeholderTextColor="#999"
                  autoFocus
                />
                <TouchableOpacity style={styles.saveNameBtn} onPress={saveName}>
                  <Text style={styles.saveNameBtnText}>Save</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <TouchableOpacity onPress={() => { setNewName(profileName); setEditingName(true); }}>
                <Text style={styles.editNameLink}>
                  {profileName ? profileName : '+ Add your name'}
                </Text>
              </TouchableOpacity>
            )}
          </View>

          {/* Household Join Code + Share Button */}
          <Text style={styles.sectionHeader}>Your Household</Text>
          <View style={styles.profileCard}>
            <View style={styles.codeRow}>
              <Text style={styles.codeLabel}>Join Code</Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <View style={styles.codeBadge}>
                  <Text style={styles.codeText}>{householdCode}</Text>
                </View>
                {/* Share button — opens native OS share sheet */}
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
                <Ionicons name="person-circle-outline" size={36} color="#2c3e50" />
                <View style={styles.memberInfo}>
                  <Text style={styles.memberName}>{member.full_name || 'Unknown'}</Text>
                  <Text style={styles.memberJoined}>
                    Joined {new Date(member.joined_at).toLocaleDateString()}
                  </Text>
                </View>
                {member.user_id === user.id && (
                  <View style={styles.youBadge}>
                    <Text style={styles.youBadgeText}>You</Text>
                  </View>
                )}
              </View>
            ))}
          </View>

          <TouchableOpacity
            style={styles.logoutBtn}
            onPress={() => {
              Alert.alert(
                'Log Out',
                'Are you sure you want to log out?',
                [
                  { text: 'Cancel', style: 'cancel' },
                  {
                    text: 'Log Out',
                    style: 'destructive',
                    onPress: async () => {
                      await supabase.auth.signOut();
                      setHouseholdId(null);
                      setInventory([]);
                      setHouseholdMembers([]);
                      setHouseholdCode('');
                      setActiveTab('inventory');
                    }
                  }
                ]
              );
            }}
          >
            <Text style={styles.logoutBtnText}>Log Out</Text>
          </TouchableOpacity>
          <View style={{ height: 40 }} />
        </ScrollView>
      )}

      {/* ── BOTTOM TAB BAR ── */}
      <View style={styles.tabBar}>

        <TouchableOpacity style={styles.tabItem} onPress={() => setActiveTab('inventory')}>
          <Ionicons name={activeTab === 'inventory' ? 'grid' : 'grid-outline'} size={24} color={activeTab === 'inventory' ? '#27ae60' : '#999'} />
          <Text style={[styles.tabLabel, activeTab === 'inventory' && styles.tabLabelActive]}>Inventory</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.tabItem} onPress={() => {
          setProductName('');
          setQuantity('1');
          setProductImage(null);
          setCurrentBarcode(null);
          setSelectedCategory('food');
          setExpirationDate('');
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
  // Layout
  container: { flex: 1, backgroundColor: '#f4f4f4' },
  screen: { flex: 1, paddingTop: 60, paddingHorizontal: 20 },
  title: { fontSize: 26, fontWeight: 'bold', color: '#2c3e50', textAlign: 'center', marginBottom: 16 },

  // Inventory Screen
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

  // Empty State
  emptyState: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingTop: 60 },
  emptyStateIcon: { fontSize: 48, marginBottom: 12 },
  emptyStateText: { fontSize: 16, color: '#999', textAlign: 'center' },

  // Inventory Item Card (full view)
  item: { backgroundColor: 'white', padding: 12, borderRadius: 8, marginBottom: 10, flexDirection: 'row', alignItems: 'center', gap: 10 },
  itemLowStock: { backgroundColor: '#fff5f5', borderWidth: 1, borderColor: '#e74c3c' },
  itemImage: { width: 50, height: 50, borderRadius: 6 },
  itemImagePlaceholder: { width: 50, height: 50, borderRadius: 6, backgroundColor: '#ddd' },
  itemInfo: { flex: 1 },
  itemName: { fontSize: 13, color: '#2c3e50', marginBottom: 4 },
  itemTagRow: { flexDirection: 'row', gap: 6, flexWrap: 'wrap' },
  categoryTag: { alignSelf: 'flex-start', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10 },
  categoryTagText: { color: 'white', fontSize: 11, fontWeight: 'bold' },
  lowStockTag: { backgroundColor: '#e74c3c', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10 },
  lowStockTagText: { color: 'white', fontSize: 11, fontWeight: 'bold' },

  // Expiration date tags
  expirationTag: { backgroundColor: '#27ae60', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10 },
  expirationTagText: { color: 'white', fontSize: 11, fontWeight: 'bold' },
  expiringSoonTag: { backgroundColor: '#f39c12', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10 },
  expiringSoonTagText: { color: 'white', fontSize: 11, fontWeight: 'bold' },
  expiredTag: { backgroundColor: '#e74c3c', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10 },
  expiredTagText: { color: 'white', fontSize: 11, fontWeight: 'bold' },

  // Compact List View
  compactItem: { backgroundColor: 'white', paddingHorizontal: 14, paddingVertical: 10, borderRadius: 8, marginBottom: 6, flexDirection: 'row', alignItems: 'center', gap: 10 },
  compactDot: { width: 10, height: 10, borderRadius: 5 },
  compactName: { flex: 1, fontSize: 14, color: '#2c3e50', fontWeight: '500' },
  compactLowStock: { fontSize: 14 },

  // Quantity Controls
  qtyControls: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  qtyBtn: { backgroundColor: '#f0f0f0', width: 28, height: 28, borderRadius: 14, justifyContent: 'center', alignItems: 'center' },
  qtyBtnText: { fontSize: 16, color: '#2c3e50', fontWeight: 'bold' },
  qtyNumber: { fontSize: 15, fontWeight: 'bold', color: '#2c3e50', minWidth: 20, textAlign: 'center' },
  qtyLow: { color: '#e74c3c' },
  deleteBtn: { color: '#e74c3c', fontSize: 16, fontWeight: 'bold' },

  // Add Item Screen
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

  // Shopping List Screen
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

  // Camera / Scan Screen
  scanOverlay: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  scanTitle: { color: 'white', fontSize: 20, fontWeight: 'bold', marginBottom: 30 },
  scanBox: { width: 260, height: 160, borderWidth: 3, borderColor: '#27ae60', borderRadius: 12, marginBottom: 20 },
  scanHint: { color: 'white', fontSize: 14, opacity: 0.8 },
  scanCancelRow: { paddingBottom: 40, alignItems: 'center' },
  scanCancelBtn: { backgroundColor: 'rgba(0,0,0,0.6)', paddingHorizontal: 30, paddingVertical: 14, borderRadius: 30 },
  scanCancelText: { color: 'white', fontSize: 16 },

  // Product Lookup Loading Screen
  lookupScreen: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#f4f4f4' },
  lookupText: { marginTop: 16, fontSize: 16, color: '#2c3e50' },

  // Bottom Tab Bar
  tabBar: { flexDirection: 'row', backgroundColor: 'white', borderTopWidth: 1, borderTopColor: '#e0e0e0', paddingBottom: 24, paddingTop: 10 },
  tabItem: { flex: 1, alignItems: 'center', position: 'relative' },
  tabLabel: { fontSize: 11, color: '#999' },
  tabLabelActive: { color: '#27ae60', fontWeight: 'bold' },
  scanTabBtn: { width: 52, height: 52, borderRadius: 26, backgroundColor: '#27ae60', justifyContent: 'center', alignItems: 'center', marginTop: -20, shadowColor: '#27ae60', shadowOpacity: 0.4, shadowRadius: 8, elevation: 6 },
  badge: { position: 'absolute', top: 0, right: -6, backgroundColor: '#e74c3c', borderRadius: 10, minWidth: 18, height: 18, justifyContent: 'center', alignItems: 'center' },
  badgeText: { color: 'white', fontSize: 11, fontWeight: 'bold' },

  // Profile Screen
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
});