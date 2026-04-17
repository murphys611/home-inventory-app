import { useState, useEffect, useRef } from 'react';
import {
  StyleSheet, Text, View, TouchableOpacity, FlatList,
  TextInput, Alert, Image, ActivityIndicator, ScrollView
} from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as ImagePicker from 'expo-image-picker';
import * as Notifications from 'expo-notifications';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from './supabase';
import { Ionicons } from '@expo/vector-icons';

const CATEGORIES = [
  { label: 'Food', value: 'food', color: '#e67e22' },
  { label: 'Cleaning', value: 'cleaning', color: '#2980b9' },
  { label: 'Hygiene', value: 'hygiene', color: '#8e44ad' },
  { label: 'Other', value: 'other', color: '#7f8c8d' },
];

const LOW_STOCK_THRESHOLD = 2;

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

export default function App() {
  const [permission, requestPermission] = useCameraPermissions();
  const [activeTab, setActiveTab] = useState('inventory');
  const [scanning, setScanning] = useState(false);
  const [inventory, setInventory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterCategory, setFilterCategory] = useState('all');
  const [sortBy, setSortBy] = useState('name');
  const [showSortOptions, setShowSortOptions] = useState(false);

  // Add form state
  const [productName, setProductName] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [productImage, setProductImage] = useState(null);
  const [currentBarcode, setCurrentBarcode] = useState(null);
  const [selectedCategory, setSelectedCategory] = useState('food');
  const [scanStatus, setScanStatus] = useState('');

  const scanned = useRef(false);
  const cameraReady = useRef(false);

  useEffect(() => {
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
  }, []);

  // Auto open camera when scan tab is tapped
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

  const loadInventory = async () => {
    try {
      const { data, error } = await supabase.from('inventory').select('*');
      if (error) throw error;
      if (data) setInventory(data);
    } catch (e) {
      console.log('Failed to load inventory', e);
    } finally {
      setLoading(false);
    }
  };

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

  const handleBarcode = ({ data }) => {
    if (scanned.current) return;
    if (!cameraReady.current) return;
    scanned.current = true;
    setScanning(false);
    setScanStatus('Looking up product...');
    setActiveTab('scan');
    lookupProduct(data);
  };

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
    if (tagString.includes('food') || tagString.includes('beverage') ||
      tagString.includes('dairy') || tagString.includes('snack') ||
      tagString.includes('drink') || tagString.includes('grocery')) return 'food';
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
    if (cat.includes('food') || cat.includes('grocery') || cat.includes('beverage') ||
      cat.includes('snack') || cat.includes('drink')) return 'food';
    return 'other';
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
          // Not found — go to add tab with empty form
          setProductName('');
          setProductImage(null);
          setSelectedCategory('other');
          setScanStatus('');
          setActiveTab('add');
        }
      })
      .catch(() => {
        setProductName('');
        setProductImage(null);
        setSelectedCategory('other');
        setScanStatus('');
        setActiveTab('add');
      });
  };

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
    };
    if (currentBarcode) {
      saveToLocalCache(currentBarcode, productName, selectedCategory, productImage);
    }
    try {
      const { error } = await supabase.from('inventory').insert([newItem]);
      if (error) throw error;
      setInventory(prev => [...prev, newItem]);
      setProductName('');
      setQuantity('1');
      setProductImage(null);
      setCurrentBarcode(null);
      setSelectedCategory('food');
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
    if (newQty <= LOW_STOCK_THRESHOLD) {
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

  // ─── SCAN SCREEN ───────────────────────────────────────────
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

  // ─── LOOKUP IN PROGRESS ────────────────────────────────────
  if (activeTab === 'scan' && scanStatus) {
    return (
      <View style={styles.lookupScreen}>
        <ActivityIndicator size="large" color="#27ae60" />
        <Text style={styles.lookupText}>{scanStatus}</Text>
      </View>
    );
  }

  // ─── MAIN APP ──────────────────────────────────────────────
  return (
    <View style={styles.container}>

      {/* ── INVENTORY TAB ── */}
      {activeTab === 'inventory' && (
        <View style={styles.screen}>
          <Text style={styles.title}>Home Inventory</Text>

          <TextInput
            style={styles.searchBar}
            placeholder="🔍 Search inventory..."
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
            <TouchableOpacity style={styles.sortBtn} onPress={() => setShowSortOptions(!showSortOptions)}>
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
                {searchQuery || filterCategory !== 'all'
                  ? 'No items match your search.'
                  : 'No items yet. Tap Scan to get started!'}
              </Text>
            </View>
          ) : (
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
                    <Text style={styles.itemName}>{item.name}</Text>
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

      {/* ── ADD TAB ── */}
      {activeTab === 'add' && (
        <ScrollView style={styles.screen} contentContainerStyle={styles.addContent}>
          <Text style={styles.title}>Add Item</Text>

          {/* Image */}
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

          {/* Name */}
          <Text style={styles.formLabel}>Product Name</Text>
          <TextInput
            style={styles.formInput}
            placeholder="e.g. Bounty Paper Towels"
            value={productName}
            onChangeText={setProductName}
          />

          {/* Quantity */}
          <Text style={styles.formLabel}>Quantity</Text>
          <TextInput
            style={[styles.formInput, { width: 80 }]}
            placeholder="1"
            value={quantity}
            onChangeText={setQuantity}
            keyboardType="numeric"
          />

          {/* Category */}
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

          {/* Confirm Button */}
          <TouchableOpacity style={styles.confirmBtn} onPress={addItem}>
            <Text style={styles.confirmBtnText}>Add to Inventory</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.cancelFormBtn} onPress={() => {
            setProductName('');
            setQuantity('1');
            setProductImage(null);
            setCurrentBarcode(null);
            setSelectedCategory('food');
            setActiveTab('inventory');
          }}>
            <Text style={styles.cancelFormBtnText}>Cancel</Text>
          </TouchableOpacity>
        </ScrollView>
      )}

      {/* ── SHOPPING TAB ── */}
      {activeTab === 'shopping' && (
        <View style={styles.screen}>
          <Text style={styles.title}>Shopping List</Text>
          {shoppingList.length === 0 ? (
            <View style={styles.emptyState}>
              <Text style={styles.emptyStateIcon}>🛒</Text>
              <Text style={styles.emptyStateText}>Nothing out of stock!</Text>
            </View>
          ) : (
            <FlatList
              data={shoppingList}
              keyExtractor={item => item.id}
              renderItem={({ item }) => (
                <View style={styles.shoppingItem}>
                  {item.image ? (
                    <Image source={{ uri: item.image }} style={styles.itemImage} />
                  ) : (
                    <View style={styles.itemImagePlaceholder} />
                  )}
                  <View style={styles.itemInfo}>
                    <Text style={styles.itemName}>{item.name}</Text>
                    <View style={[styles.categoryTag, { backgroundColor: getCategoryColor(item.category) }]}>
                      <Text style={styles.categoryTagText}>
                        {CATEGORIES.find(c => c.value === item.category)?.label || 'Other'}
                      </Text>
                    </View>
                  </View>
                  <TouchableOpacity style={styles.restockBtn} onPress={() => changeQuantity(item.id, 1)}>
                    <Text style={styles.restockBtnText}>+ Restock</Text>
                  </TouchableOpacity>
                </View>
              )}
            />
          )}
        </View>
      )}

      {/* ── BOTTOM TAB BAR ── */}
<View style={styles.tabBar}>
  <TouchableOpacity style={styles.tabItem} onPress={() => setActiveTab('inventory')}>
    <Ionicons name={activeTab === 'inventory' ? 'grid' : 'grid-outline'} size={24} color={activeTab === 'inventory' ? '#27ae60' : '#999'} />
    <Text style={[styles.tabLabel, activeTab === 'inventory' && styles.tabLabelActive]}>Inventory</Text>
  </TouchableOpacity>

  <TouchableOpacity style={styles.tabItem} onPress={() => setActiveTab('scan')}>
    <View style={styles.scanTabBtn}>
      <Ionicons name="barcode-outline" size={28} color="white" />
    </View>
    <Text style={[styles.tabLabel, activeTab === 'scan' && styles.tabLabelActive]}>Scan</Text>
  </TouchableOpacity>

  <TouchableOpacity style={styles.tabItem} onPress={() => {
    setProductName('');
    setQuantity('1');
    setProductImage(null);
    setCurrentBarcode(null);
    setSelectedCategory('food');
    setActiveTab('add');
  }}>
    <Ionicons name={activeTab === 'add' ? 'add-circle' : 'add-circle-outline'} size={24} color={activeTab === 'add' ? '#27ae60' : '#999'} />
    <Text style={[styles.tabLabel, activeTab === 'add' && styles.tabLabelActive]}>Add Manually</Text>
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
    </View>

    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f4f4f4' },
  screen: { flex: 1, paddingTop: 60, paddingHorizontal: 20 },

  // Title
  title: { fontSize: 26, fontWeight: 'bold', color: '#2c3e50', textAlign: 'center', marginBottom: 16 },

  // Inventory
  searchBar: { backgroundColor: 'white', padding: 10, borderRadius: 8, fontSize: 14, marginBottom: 10 },
  filterSortRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 8 },
  filterScroll: { flex: 1 },
  filterTab: { paddingHorizontal: 14, paddingVertical: 6, borderRadius: 20, backgroundColor: '#ddd', marginRight: 8 },
  filterTabActive: { backgroundColor: '#2c3e50' },
  filterTabText: { fontSize: 13, color: '#555', fontWeight: 'bold' },
  filterTabTextActive: { color: 'white' },
  sortBtn: { backgroundColor: '#2c3e50', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8, marginLeft: 8 },
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
  itemImagePlaceholder: { width: 50, height: 50, borderRadius: 6, backgroundColor: '#ddd' },
  itemInfo: { flex: 1 },
  itemName: { fontSize: 14, color: '#2c3e50', marginBottom: 4 },
  itemTagRow: { flexDirection: 'row', gap: 6, flexWrap: 'wrap' },
  categoryTag: { alignSelf: 'flex-start', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10 },
  categoryTagText: { color: 'white', fontSize: 11, fontWeight: 'bold' },
  lowStockTag: { backgroundColor: '#e74c3c', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10 },
  lowStockTagText: { color: 'white', fontSize: 11, fontWeight: 'bold' },
  qtyControls: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  qtyBtn: { backgroundColor: '#f0f0f0', width: 28, height: 28, borderRadius: 14, justifyContent: 'center', alignItems: 'center' },
  qtyBtnText: { fontSize: 16, color: '#2c3e50', fontWeight: 'bold' },
  qtyNumber: { fontSize: 15, fontWeight: 'bold', color: '#2c3e50', minWidth: 20, textAlign: 'center' },
  qtyLow: { color: '#e74c3c' },
  deleteBtn: { color: '#e74c3c', fontSize: 16, fontWeight: 'bold' },

  // Add Tab
  addContent: { paddingBottom: 40 },
  addImageRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 20, gap: 16 },
  addPreviewImage: { width: 100, height: 100, borderRadius: 12 },
  addImagePlaceholder: { width: 100, height: 100, borderRadius: 12, backgroundColor: '#ddd', justifyContent: 'center', alignItems: 'center' },
  addImagePlaceholderText: { color: '#999', fontSize: 12 },
  addImageBtns: { flex: 1, gap: 10 },
  imgBtn: { backgroundColor: '#2c3e50', padding: 10, borderRadius: 8, alignItems: 'center' },
  imgBtnText: { color: 'white', fontSize: 13 },
  formLabel: { fontSize: 14, fontWeight: 'bold', color: '#2c3e50', marginBottom: 6, marginTop: 12 },
  formInput: { backgroundColor: 'white', padding: 12, borderRadius: 8, fontSize: 15 },
  categoryRow: { flexDirection: 'row', gap: 8, marginTop: 4 },
  categoryBtn: { flex: 1, padding: 10, borderRadius: 8, alignItems: 'center' },
  categoryBtnText: { fontSize: 12, fontWeight: 'bold' },
  confirmBtn: { backgroundColor: '#27ae60', padding: 16, borderRadius: 10, alignItems: 'center', marginTop: 24 },
  confirmBtnText: { color: 'white', fontSize: 16, fontWeight: 'bold' },
  cancelFormBtn: { padding: 14, alignItems: 'center', marginTop: 8 },
  cancelFormBtnText: { color: '#999', fontSize: 15 },

  // Shopping Tab
  shoppingItem: { backgroundColor: 'white', padding: 12, borderRadius: 8, marginBottom: 10, flexDirection: 'row', alignItems: 'center', gap: 10 },
  restockBtn: { backgroundColor: '#27ae60', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8 },
  restockBtnText: { color: 'white', fontSize: 13, fontWeight: 'bold' },

  // Scan Screen
  scanOverlay: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  scanTitle: { color: 'white', fontSize: 20, fontWeight: 'bold', marginBottom: 30 },
  scanBox: { width: 260, height: 160, borderWidth: 3, borderColor: '#27ae60', borderRadius: 12, marginBottom: 20 },
  scanHint: { color: 'white', fontSize: 14, opacity: 0.8 },
  scanCancelRow: { paddingBottom: 40, alignItems: 'center' },
  scanCancelBtn: { backgroundColor: 'rgba(0,0,0,0.6)', paddingHorizontal: 30, paddingVertical: 14, borderRadius: 30 },
  scanCancelText: { color: 'white', fontSize: 16 },

  // Lookup screen
  lookupScreen: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#f4f4f4' },
  lookupText: { marginTop: 16, fontSize: 16, color: '#2c3e50' },

  // Bottom Tab Bar
  tabBar: { flexDirection: 'row', backgroundColor: 'white', borderTopWidth: 1, borderTopColor: '#e0e0e0', paddingBottom: 24, paddingTop: 10 },
  tabItem: { flex: 1, alignItems: 'center', position: 'relative' },
  tabIcon: { marginBottom: 2 },
  tabLabel: { fontSize: 11, color: '#999' },
  tabLabelActive: { color: '#27ae60', fontWeight: 'bold' },
  scanTabBtn: { width: 52, height: 52, borderRadius: 26, backgroundColor: '#27ae60', justifyContent: 'center', alignItems: 'center', marginTop: -20, shadowColor: '#27ae60', shadowOpacity: 0.4, shadowRadius: 8, elevation: 6 },
  scanTabIcon: { color: 'white' },
  badge: { position: 'absolute', top: 0, right: 10, backgroundColor: '#e74c3c', borderRadius: 10, minWidth: 18, height: 18, justifyContent: 'center', alignItems: 'center' },
  badgeText: { color: 'white', fontSize: 11, fontWeight: 'bold' },
});