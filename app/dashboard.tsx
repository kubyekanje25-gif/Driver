import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Dimensions,
  Platform,
  Animated,
} from 'react-native';
import { GestureDetector, Gesture } from 'react-native-gesture-handler';
import { BlurView } from 'expo-blur';
import { database, auth, firestore } from '@/config/firebase';
import { doc, onSnapshot, collection, query, where, updateDoc } from 'firebase/firestore';

// Helper functions to handle location across platforms
const getLocation = async () => {
  if (Platform.OS !== 'web') {
    const Location = await import('expo-location');
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status === 'granted') {
      const location = await Location.getCurrentPositionAsync({});
      return location.coords;
    }
    return null;
  } else {
    return new Promise<{ latitude: number; longitude: number; heading?: number } | null>((resolve) => {
      if (!navigator.geolocation) {
        resolve(null);
        return;
      }
      navigator.geolocation.getCurrentPosition(
        (pos) => resolve({ latitude: pos.coords.latitude, longitude: pos.coords.longitude, heading: pos.coords.heading || 0 }),
        () => resolve(null)
      );
    });
  }
};

const watchLocation = async (callback: (coords: { latitude: number; longitude: number; heading: number; speed: number }) => void) => {
  if (Platform.OS !== 'web') {
    const Location = await import('expo-location');
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') {
      console.log('[v0] Location permission denied');
      return null;
    }

    return await Location.watchPositionAsync(
      {
        accuracy: Location.Accuracy.High,
        timeInterval: 3000, // Update every 3 seconds
        distanceInterval: 15, // Or every 15 meters
      },
      (loc) => {
        callback({
          latitude: loc.coords.latitude,
          longitude: loc.coords.longitude,
          heading: loc.coords.heading || 0,
          speed: loc.coords.speed || 0,
        });
      }
    );
  } else {
    if (!navigator.geolocation) return null;
    const watchId = navigator.geolocation.watchPosition(
      (pos) => callback({
        latitude: pos.coords.latitude,
        longitude: pos.coords.longitude,
        heading: pos.coords.heading || 0,
        speed: pos.coords.speed || 0,
      }),
      (error) => {
        console.log('[v0] Location error:', error.message);
      },
      { enableHighAccuracy: true }
    );
    return { remove: () => navigator.geolocation.clearWatch(watchId) };
  }
};
import { ref, update, onValue, off, remove, set } from 'firebase/database';
import { Home, Mail, Clock, Settings, MapPin, Shield } from 'lucide-react-native';
import RideRequestPopup from '@/components/RideRequestPopup';
import RideManagementPanel from '@/components/RideManagementPanel';
import ChatPanel from '@/components/ChatPanel';
import ToastNotification from '@/components/ToastNotification';
import { createGeoFireObject } from '@/utils/geofire';
import { getUnreadCount, listenForClientMessages, autoDeleteReadMessages, watchRideStatusForCleanup } from '@/utils/chat';

const { width, height } = Dimensions.get('window');

export default function Dashboard() {
  const [isOnline, setIsOnline] = useState(false);
  const [userStatus, setUserStatus] = useState<'pending' | 'approved' | 'accepted' | 'rejected'>('pending');
  const [registrationCompleted, setRegistrationCompleted] = useState(false);
  const [locationSubscription, setLocationSubscription] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('home');

  const [showRidePopup, setShowRidePopup] = useState(false);
  const [pendingRide, setPendingRide] = useState<any>(null);
  const [activeRide, setActiveRide] = useState<any>(null);
  const [rideStatus, setRideStatus] = useState<'accepted' | 'arrived' | 'in_progress' | null>(null);
  const [driverData, setDriverData] = useState<any>(null);
  const [isBusy, setIsBusy] = useState(false);
  const [currentLocation, setCurrentLocation] = useState<{ latitude: number; longitude: number } | null>(null);

  const [showChatPanel, setShowChatPanel] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [showToast, setShowToast] = useState(false);
  const [toastData, setToastData] = useState({ clientName: '', message: '' });

  const sliderX = useRef(new Animated.Value(0)).current;
  // Toggle dimensions - track is full width minus padding, thumb is 48px
  const TRACK_WIDTH = width - 64; // 16px padding on each side + 16px margin
  const THUMB_SIZE = 48;
  const SLIDE_RANGE = TRACK_WIDTH - THUMB_SIZE - 8; // Max translation (account for 4px padding on each side)
  const SLIDE_THRESHOLD = SLIDE_RANGE * 0.5;

  // Panel animation for draggable bottom sheet (panel slides behind nav bar)
  // Collapsed: panel slides down so only scheduled card is visible above nav (85px)
  // Expanded: shows all content including toggle
  const PANEL_TOTAL_HEIGHT = 380; // Total panel height
  const NAV_HEIGHT = 85;
  // When collapsed, panel should hide behind nav, only showing scheduled card (~100px visible)
  const PANEL_COLLAPSED_OFFSET = PANEL_TOTAL_HEIGHT - NAV_HEIGHT - 100; // How much to push down when collapsed
  const PANEL_EXPANDED_OFFSET = 0; // When expanded, no offset
  const panelY = useRef(new Animated.Value(PANEL_COLLAPSED_OFFSET)).current; // Start collapsed
  const savedPanelY = useRef(PANEL_COLLAPSED_OFFSET);

  // Dashboard entry animations
  const panelSlideAnim = useRef(new Animated.Value(300)).current; // Panel slides up from bottom
  const cardsFadeAnim = useRef(new Animated.Value(0)).current; // Cards fade in
  const cardsScaleAnim = useRef(new Animated.Value(0.95)).current; // Cards scale up

  useEffect(() => {
    const uid = auth.currentUser?.uid;
    if (!uid) {
      setIsLoading(false);
      return;
    }

    // LISTEN TO FIRESTORE drivers/{uid} for verification status (NOT Realtime DB users/{uid})
    const driverDocRef = doc(firestore, 'drivers', uid);
    const unsubscribeFirestore = onSnapshot(driverDocRef, (docSnap) => {
      if (docSnap.exists()) {
        const data = docSnap.data();
        // Set verification status from Firestore
        const verificationStatus = data.verificationStatus || 'pending';
        const regCompleted = data.registrationCompleted === true;

        setUserStatus(verificationStatus as 'pending' | 'approved' | 'accepted' | 'rejected');
        setRegistrationCompleted(regCompleted);

        // Store driver profile data for ride acceptance - include ALL fields
        setDriverData({
          profile: {
            firstName: data.firstName || '',
            lastName: data.lastName || '',
            profilePicture: data.profilePicture || '',
          },
          vehicle: {
            brand: data.vehicleBrand || '',
            model: data.vehicleModel || '',
            color: data.vehicleColor || '',
            plateNumber: data.plateNumber || '',
            // Truck-specific fields
            tonnage: data.tonnage || '',
            refrigerationType: data.refrigerationType || '',
          },
          rating: data.rating || 5.0,
        });
      }
      setIsLoading(false);
    });

    // Listen to drivers_online/{uid} for online status
    const driversOnlineRef = ref(database, `drivers_online/${uid}`);
    const onlineListener = onValue(driversOnlineRef, (snapshot) => {
      const data = snapshot.val();
      if (data) {
        setIsOnline(data.isOnline === true);
        setIsBusy(data.isBusy === true);
        sliderX.setValue(data.isOnline ? SLIDE_RANGE : 0);
      } else {
        setIsOnline(false);
        setIsBusy(false);
        sliderX.setValue(0);
      }
    });

    // Listen to Firestore orders collection for active orders assigned to this driver
    const ordersRef = collection(firestore, 'orders');
    const ordersQuery = query(
      ordersRef,
      where('driverId', '==', uid),
      where('status', '!=', 'completed')
    );

    const unsubscribeOrders = onSnapshot(ordersQuery, (snapshot) => {
      if (snapshot.empty) {
        setActiveRide(null);
        setRideStatus(null);
        setPendingRide(null);
        setShowRidePopup(false);
        return;
      }

      // Get the first active order
      const orderDoc = snapshot.docs[0];
      const orderData = orderDoc.data();
      const order = {
        id: orderDoc.id,
        workflowType: orderData.workflowType || 'direct_trip',
        status: orderData.status,
        driverStatus: orderData.driverStatus,
        pickup: orderData.pickup || orderData.pickupAddress,
        pickupAddress: orderData.pickupAddress || orderData.pickup,
        destination: orderData.destination || orderData.destinationAddress,
        destinationAddress: orderData.destinationAddress || orderData.destination,
        fare: orderData.fare || orderData.price,
        price: orderData.price || orderData.fare,
        userName: orderData.userName || orderData.clientName,
        clientName: orderData.clientName || orderData.userName,
        userId: orderData.userId || orderData.clientId,
        clientId: orderData.clientId || orderData.userId,
        ...orderData,
      };

      setActiveRide(order);
      setRideStatus(order.status);

      // Show popup for pending direct_trip or driver_assigned store_delivery
      const needsAction = 
        (order.workflowType === 'direct_trip' && order.status === 'pending') ||
        (order.workflowType === 'store_delivery' && order.status === 'driver_assigned');
      
      if (needsAction && !showRidePopup) {
        setPendingRide(order);
        setShowRidePopup(true);
      }
    }, (error) => {
      console.error('[v0] Error listening to orders:', error);
    });

    return () => {
      unsubscribeFirestore();
      off(driversOnlineRef, 'value', onlineListener);
      unsubscribeOrders();
    };
  }, []);

  useEffect(() => {
    const uid = auth.currentUser?.uid;
    if (!uid || !activeRide?.id) {
      setUnreadCount(0);
      return;
    }

    const rideId = activeRide.id;
    const clientId = activeRide.userId || activeRide.clientId || '';

    const unsubscribeUnread = getUnreadCount(database, rideId, uid, (count) => {
      setUnreadCount(count);
    });

    const unsubscribeMessages = listenForClientMessages(
      database,
      rideId,
      uid,
      (message, messageId) => {
        if (message.senderId !== uid && !showChatPanel) {
          const clientName = activeRide.clientName || activeRide.userName || 'Client';
          setToastData({
            clientName,
            message: message.text,
          });
          setShowToast(true);
        }
      }
    );

    const unsubscribeAutoDelete = autoDeleteReadMessages(database, rideId, clientId, uid);
    const unsubscribeCleanup = watchRideStatusForCleanup(database, rideId);

    return () => {
      unsubscribeUnread();
      unsubscribeMessages();
      unsubscribeAutoDelete();
      unsubscribeCleanup();
    };
  }, [activeRide, showChatPanel]);

  const handleInboxPress = () => {
    const uid = auth.currentUser?.uid;
    if (!uid || !activeRide?.id) {
      return;
    }

    const rideStatus = activeRide?.status;
    if (rideStatus !== 'accepted' && rideStatus !== 'arrived' && rideStatus !== 'started') {
      return;
    }

    setShowChatPanel(true);
  };

  const startTracking = async () => {
    const uid = auth.currentUser?.uid;
    if (!uid) return;

    console.log('[v0] Starting location tracking for driver:', uid);

    const subscription = await watchLocation(async (coords) => {
      const { latitude, longitude } = coords;

      setCurrentLocation({ latitude, longitude });

      // CRITICAL: Update driver_locations/{uid} with GeoFire format
      // This is ONLY path client app uses to find nearby drivers
      const geoObject = createGeoFireObject(latitude, longitude);
      await set(ref(database, `driver_locations/${uid}`), {
        l: geoObject.l,
        g: geoObject.g,
      });

      console.log('[v0] Driver location updated to driver_locations:', { lat: latitude, lng: longitude, g: geoObject.g });

      // Update order location in Firestore if driver has an active order
      if (activeRide && (rideStatus === 'accepted' || rideStatus === 'arrived' || rideStatus === 'started' || rideStatus === 'at_store' || rideStatus === 'picked_up')) {
        try {
          const orderRef = doc(firestore, 'orders', activeRide.id);
          await updateDoc(orderRef, {
            driverLocation: {
              latitude,
              longitude,
              updatedAt: Date.now(),
            },
          });
        } catch (error) {
          // Silently fail location updates to avoid spamming console
        }
      }
    });
    setLocationSubscription(subscription);
  };

  const stopTracking = async () => {
    const uid = auth.currentUser?.uid;
    if (!uid) return;

    console.log('[v0] Stopping location tracking for driver:', uid);

    if (locationSubscription) {
      try {
        await locationSubscription.remove();
      } catch (error) {
        console.log('[v0] Error removing location subscription:', error);
      }
      setLocationSubscription(null);
    }

    // Remove driver_locations/{uid} when driver goes OFFLINE
    await remove(ref(database, `driver_locations/${uid}`));
    console.log('[v0] Driver location removed from driver_locations');
  };

  const goOnline = async () => {
    const uid = auth.currentUser?.uid;
    if (!uid || !driverData) return;

    const firstName = driverData.profile?.firstName || '';
    const lastName = driverData.profile?.lastName || '';
    const driverName = `${firstName} ${lastName}`.trim();

    const carBrand = driverData.vehicle?.brand || '';
    const carModelName = driverData.vehicle?.model || '';
    const carColor = driverData.vehicle?.color || '';
    const carModel = carColor && carBrand
      ? `${carColor} • ${carBrand} ${carModelName}`.trim()
      : `${carBrand} ${carModelName}`.trim();

    const plateNumber = driverData.vehicle?.plateNumber || '';
    const photo = driverData.profile?.profilePicture || '';
    const rating = driverData.rating || 5.0;

    const coords = await getLocation();
    if (coords) {
      const { latitude, longitude } = coords;

      // Update driver_locations/{uid} with GeoFire format
      const geoObject = createGeoFireObject(latitude, longitude);
      await set(ref(database, `driver_locations/${uid}`), {
        l: geoObject.l,
        g: geoObject.g,
      });

      console.log('[v0] Driver went online, location set to driver_locations:', { lat: latitude, lng: longitude, g: geoObject.g });
    }

    // SET drivers_online/{uid} - NEW REALTIME STATE SYSTEM
    await set(ref(database, `drivers_online/${uid}`), {
      isOnline: true,
      isBusy: false,
      lastUpdated: Date.now(),
    });

    setIsOnline(true);
    await startTracking();

    Animated.spring(sliderX, {
      toValue: SLIDE_RANGE,
      useNativeDriver: true,
      tension: 100,
      friction: 10,
    }).start();
  };

  const goOffline = async () => {
    const uid = auth.currentUser?.uid;
    if (!uid) return;

    setIsOnline(false);
    await stopTracking();

    // REMOVE drivers_online/{uid} - Driver goes offline
    await remove(ref(database, `drivers_online/${uid}`));

    Animated.spring(sliderX, {
      toValue: 0,
      useNativeDriver: true,
      tension: 100,
      friction: 10,
    }).start();
  };

  // Orders are now handled via Firestore listener in the main useEffect above
  // No RTDB incoming listener needed anymore

  const handleAcceptRide = async () => {
    const uid = auth.currentUser?.uid;
    if (!uid || !pendingRide || !driverData) {
      return;
    }

    try {
      const firstName = driverData.profile?.firstName || '';
      const lastName = driverData.profile?.lastName || '';
      const driverName = `${firstName} ${lastName}`.trim() || 'Driver';

      const carBrand = driverData.vehicle?.brand || '';
      const carModelName = driverData.vehicle?.model || '';
      const carColor = driverData.vehicle?.color || '';
      const carModel = carColor && carBrand
        ? `${carColor} • ${carBrand} ${carModelName}`.trim()
        : `${carBrand} ${carModelName}`.trim();

      const plateNumber = driverData.vehicle?.plateNumber || '';
      const photo = driverData.profile?.profilePicture || '';
      const rating = driverData.rating || 5.0;
      const tonnage = driverData.vehicle?.tonnage || '';
      const refrigerationType = driverData.vehicle?.refrigerationType || '';

      const driverLat = currentLocation?.latitude || 0;
      const driverLng = currentLocation?.longitude || 0;

      // Update Firestore order with driver info and status
      const orderRef = doc(firestore, 'orders', pendingRide.id);
      await updateDoc(orderRef, {
        status: 'accepted',
        driverStatus: 'accepted',
        acceptedAt: Date.now(),
        driverName,
        plateNumber,
        carModel,
        carColor,
        vehicleBrand: carBrand,
        driverImage: photo,
        rating,
        ...(tonnage && { tonnage }),
        ...(refrigerationType && { refrigerationType }),
        driverLocation: {
          latitude: driverLat,
          longitude: driverLng,
        },
      });

      // Update drivers_online/{uid} isBusy = true
      await update(ref(database, `drivers_online/${uid}`), {
        isBusy: true,
        currentOrderId: pendingRide.id,
        lastUpdated: Date.now(),
      });

      setShowRidePopup(false);
      setPendingRide(null);
    } catch (error) {
      console.error('[v0] Error accepting ride:', error);
    }
  };

  const handleRejectRide = () => {
    setShowRidePopup(false);
    setPendingRide(null);
  };

  const handleCancelRide = () => {
    setShowRidePopup(false);
    setPendingRide(null);
  };

  // STORE DELIVERY HANDLERS - All updates go to Firestore
  const handleAtStore = async () => {
    if (!activeRide) return;
    try {
      const orderRef = doc(firestore, 'orders', activeRide.id);
      await updateDoc(orderRef, {
        status: 'at_store',
        atStoreAt: Date.now(),
      });
    } catch (error) {
      console.error('[v0] Error updating to at_store:', error);
    }
  };

  const handlePickedUp = async () => {
    if (!activeRide) return;
    try {
      const orderRef = doc(firestore, 'orders', activeRide.id);
      await updateDoc(orderRef, {
        status: 'picked_up',
        pickedUpAt: Date.now(),
      });
    } catch (error) {
      console.error('[v0] Error updating to picked_up:', error);
    }
  };

  const handleDelivered = async () => {
    if (!activeRide) return;
    try {
      const orderRef = doc(firestore, 'orders', activeRide.id);
      await updateDoc(orderRef, {
        status: 'delivered',
        deliveredAt: Date.now(),
      });
    } catch (error) {
      console.error('[v0] Error updating to delivered:', error);
    }
  };

  // DIRECT TRIP HANDLERS - All updates go to Firestore
  const handleAcceptTrip = async () => {
    if (!activeRide) return;
    try {
      const orderRef = doc(firestore, 'orders', activeRide.id);
      await updateDoc(orderRef, {
        status: 'accepted',
        driverStatus: 'accepted',
        acceptedAt: Date.now(),
      });
    } catch (error) {
      console.error('[v0] Error accepting trip:', error);
    }
  };

  const handleArrived = async () => {
    if (!activeRide) return;
    try {
      const orderRef = doc(firestore, 'orders', activeRide.id);
      await updateDoc(orderRef, {
        status: 'arrived',
        arrivedAt: Date.now(),
      });
    } catch (error) {
      console.error('[v0] Error updating to arrived:', error);
    }
  };

  const handleStartTrip = async () => {
    if (!activeRide) return;
    try {
      const orderRef = doc(firestore, 'orders', activeRide.id);
      await updateDoc(orderRef, {
        status: 'started',
        startedAt: Date.now(),
      });
    } catch (error) {
      console.error('[v0] Error starting trip:', error);
    }
  };

  const handleCompleteTrip = async () => {
    const uid = auth.currentUser?.uid;
    if (!uid || !activeRide) {
      return;
    }

    try {
      // Update Firestore order to completed
      const orderRef = doc(firestore, 'orders', activeRide.id);
      await updateDoc(orderRef, {
        status: 'completed',
        driverStatus: 'completed',
        completedAt: Date.now(),
      });

      // Update drivers_online/{uid} isBusy = false
      await update(ref(database, `drivers_online/${uid}`), {
        isBusy: false,
        currentOrderId: null,
        lastUpdated: Date.now(),
      });

      setActiveRide(null);
      setRideStatus(null);
    } catch (error) {
      console.error('[v0] Error completing trip:', error);
    }
  };

  const startX = useRef(0);
  const savedTranslateX = useRef(0);

  const gesture = Gesture.Pan()
    .enabled(userStatus === 'approved' && registrationCompleted)
    .onStart(() => {
      savedTranslateX.current = isOnline ? SLIDE_RANGE : 0;
    })
    .onUpdate((event) => {
      const newValue = Math.max(0, Math.min(savedTranslateX.current + event.translationX, SLIDE_RANGE));
      sliderX.setValue(newValue);
    })
    .onEnd((event) => {
      const finalPosition = savedTranslateX.current + event.translationX;
      if (finalPosition > SLIDE_THRESHOLD) {
        goOnline();
      } else {
        goOffline();
      }
    });

  // Panel drag gesture for bottom sheet
  const panelGesture = Gesture.Pan()
    .onStart(() => {
      savedPanelY.current = (panelY as any)._value || PANEL_COLLAPSED_OFFSET;
    })
    .onUpdate((event) => {
      // Allow dragging from collapsed (positive offset) to expanded (0)
      const newValue = Math.max(PANEL_EXPANDED_OFFSET, Math.min(PANEL_COLLAPSED_OFFSET, savedPanelY.current + event.translationY));
      panelY.setValue(newValue);
    })
    .onEnd((event) => {
      const snapThreshold = PANEL_COLLAPSED_OFFSET / 2;
      const currentValue = savedPanelY.current + event.translationY;

      if (currentValue < snapThreshold) {
        // Snap to expanded (fully visible)
        Animated.spring(panelY, {
          toValue: PANEL_EXPANDED_OFFSET,
          useNativeDriver: true,
          tension: 80,
          friction: 12,
        }).start(() => {
          savedPanelY.current = PANEL_EXPANDED_OFFSET;
        });
      } else {
        // Snap to collapsed (behind nav, only scheduled card visible)
        Animated.spring(panelY, {
          toValue: PANEL_COLLAPSED_OFFSET,
          useNativeDriver: true,
          tension: 80,
          friction: 12,
        }).start(() => {
          savedPanelY.current = PANEL_COLLAPSED_OFFSET;
        });
      }
    });

  useEffect(() => {
    return () => {
      if (locationSubscription) {
        (async () => {
          try {
            await locationSubscription.remove();
          } catch (error) {
            console.log('Error removing location subscription on cleanup:', error);
          }
        })();
      }
    };
  }, [locationSubscription]);

  // Dashboard entry animations - panel slides up to reveal toggle
  useEffect(() => {
    if (!isLoading) {
      // Animate panel sliding up from bottom
      Animated.spring(panelSlideAnim, {
        toValue: 0,
        useNativeDriver: true,
        tension: 50,
        friction: 10,
      }).start();

      // Animate cards fading in and scaling
      Animated.parallel([
        Animated.timing(cardsFadeAnim, {
          toValue: 1,
          duration: 400,
          delay: 200,
          useNativeDriver: true,
        }),
        Animated.spring(cardsScaleAnim, {
          toValue: 1,
          useNativeDriver: true,
          tension: 60,
          friction: 8,
        }),
      ]).start();

      // After initial animation, smoothly expand panel to show toggle
      setTimeout(() => {
        Animated.spring(panelY, {
          toValue: PANEL_EXPANDED_OFFSET,
          useNativeDriver: true,
          tension: 60,
          friction: 12,
        }).start(() => {
          savedPanelY.current = PANEL_EXPANDED_OFFSET;
        });
      }, 600);
    }
  }, [isLoading]);

  if (isLoading) {
    return (
      <View style={[styles.container, styles.loadingContainer]}>
        <ActivityIndicator size="large" color="#006400" />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* RIDE REQUEST POPUP */}
      <RideRequestPopup
        visible={showRidePopup}
        ride={pendingRide}
        onAccept={handleAcceptRide}
        onReject={handleRejectRide}
        onCancel={handleCancelRide}
      />

      {/* RIDE MANAGEMENT PANEL - supports workflowType: store_delivery or direct_trip */}
      <RideManagementPanel
        rideStatus={rideStatus}
        rideInfo={activeRide}
        workflowType={activeRide?.workflowType}
        onAtStore={handleAtStore}
        onPickedUp={handlePickedUp}
        onDelivered={handleDelivered}
        onAcceptTrip={handleAcceptTrip}
        onArrived={handleArrived}
        onStartTrip={handleStartTrip}
        onCompleteTrip={handleCompleteTrip}
      />

      {/* CHAT PANEL */}
      <ChatPanel
        visible={showChatPanel}
        onClose={() => setShowChatPanel(false)}
        rideId={activeRide?.id || null}
        clientName={activeRide?.clientName || activeRide?.userName || 'Client'}
        clientId={activeRide?.userId || activeRide?.clientId || ''}
        driverName={driverData ? `${driverData.profile?.firstName || ''} ${driverData.profile?.lastName || ''}`.trim() || 'Driver' : 'Driver'}
        pickupAddress={activeRide?.pickupAddress || 'Pickup'}
        destinationAddress={activeRide?.destinationAddress || 'Destination'}
        rideStatus={activeRide?.status || null}
      />

      {/* TOAST NOTIFICATION */}
      <ToastNotification
        visible={showToast}
        clientName={toastData.clientName}
        message={toastData.message}
        onHide={() => setShowToast(false)}
      />

      {/* FULL SCREEN MAP BACKGROUND */}
      <View style={styles.mapFullScreen}>
        <View style={styles.mapBackground}>
          <View style={styles.mapGrid}>
            {Array.from({ length: 20 }).map((_, i) => (
              <View key={i} style={styles.mapLine} />
            ))}
          </View>
          <View style={[styles.mapGrid, styles.mapGridVertical]}>
            {Array.from({ length: 20 }).map((_, i) => (
              <View key={i} style={styles.mapLine} />
            ))}
          </View>
          <View style={styles.serviceRadius} />
        </View>

        {/* Top action buttons */}
        <View style={styles.topButtons}>
          <TouchableOpacity style={styles.topButton}>
            <View style={styles.iconCircle}>
              <MapPin color="#333" size={22} />
            </View>
          </TouchableOpacity>
          <TouchableOpacity style={styles.topButton}>
            <View style={styles.iconCircle}>
              <Shield color="#333" size={22} />
            </View>
          </TouchableOpacity>
        </View>
      </View>

      {/* DRAGGABLE SLIDING PANEL - Contains toggle inside */}
      <Animated.View
        style={[
          styles.slidingPanel,
          {
            transform: [
              { translateY: Animated.add(panelY, panelSlideAnim) },
            ],
          },
        ]}
      >
        {/* Panel Handle - Draggable area */}
        <GestureDetector gesture={panelGesture}>
          <View style={styles.panelHandleArea}>
            <View style={styles.panelHandle} />
          </View>
        </GestureDetector>

        {/* Panel Content */}
        <View style={styles.panelContent}>
          {/* Scheduled Requests Card - Always visible when collapsed */}
          <Animated.View style={[styles.scheduledCard, { opacity: cardsFadeAnim, transform: [{ scale: cardsScaleAnim }] }]}>
            <View style={styles.scheduledIconCircle}>
              <Clock color="#666" size={24} />
            </View>
            <View style={styles.scheduledTextContainer}>
              <Text style={styles.scheduledTitle}>New scheduled requests</Text>
              <Text style={styles.scheduledSubtitle}>Choose a request that suits you</Text>
            </View>
          </Animated.View>

          {/* Stats Row */}
          <Animated.View style={[styles.statsRow, { opacity: cardsFadeAnim, transform: [{ scale: cardsScaleAnim }] }]}>
            <View style={styles.statCard}>
              <View style={styles.statHeader}>
                <Text style={styles.statLabel}>Today&apos;s{'\n'}earnings</Text>
              </View>
              <Text style={styles.statValue}>£0.00</Text>
            </View>

            <View style={styles.statCard}>
              <View style={styles.statHeader}>
                <Text style={styles.statLabel}>Activity{'\n'}score</Text>
              </View>
              <Text style={styles.statValue}>50%</Text>
            </View>

            <View style={styles.statCard}>
              <View style={styles.statHeader}>
                <Text style={styles.statLabel}>Current{'\n'}rating</Text>
              </View>
              <Text style={styles.statValue}>{(driverData?.rating || 5.0).toFixed(2)}</Text>
            </View>
          </Animated.View>

          {/* TOGGLE - FULL WIDTH inside panel, below stats */}
          <Animated.View
            style={[
              styles.toggleContainer,
              { opacity: cardsFadeAnim, transform: [{ scale: cardsScaleAnim }] },
              (userStatus !== 'approved' || !registrationCompleted) && styles.disabledSlider,
            ]}
            pointerEvents={(userStatus === 'approved' && registrationCompleted) ? 'auto' : 'none'}
          >
            <View style={[styles.slideTrack, isOnline && styles.slideTrackOnline]}>
              <Text style={[styles.slideInstructionText, isOnline && styles.slideInstructionTextOnline]}>
                {isOnline ? 'Slide to go offline' : 'Slide to go online'}
              </Text>
              <GestureDetector gesture={gesture}>
                <Animated.View
                  style={[
                    styles.slideThumb,
                    {
                      transform: [{ translateX: sliderX }],
                    },
                  ]}
                >
                  <Text style={[styles.chevronText, isOnline && styles.chevronTextOnline]}>{isOnline ? '<<' : '>>'}</Text>
                </Animated.View>
              </GestureDetector>
            </View>
          </Animated.View>
        </View>
      </Animated.View>

      {/* NAV BAR */}
      <View style={styles.bottomNav}>
        <TouchableOpacity style={styles.navItem} onPress={() => setActiveTab('home')}>
          <Home color={activeTab === 'home' ? '#4285F4' : '#999'} size={26} />
          <Text style={[styles.navLabel, activeTab === 'home' && styles.navLabelActive]}>Home</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.navItem} onPress={handleInboxPress}>
          <View style={styles.iconWrapper}>
            <Mail color={activeTab === 'inbox' ? '#4285F4' : '#999'} size={26} />
            {unreadCount > 0 && (
              <View style={styles.badge}>
                <Text style={styles.badgeText}>{unreadCount > 9 ? '9+' : unreadCount}</Text>
              </View>
            )}
          </View>
          <Text style={[styles.navLabel, activeTab === 'inbox' && styles.navLabelActive]}>Inbox</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.navItem} onPress={() => setActiveTab('trips')}>
          <Clock color={activeTab === 'trips' ? '#4285F4' : '#999'} size={26} />
          <Text style={[styles.navLabel, activeTab === 'trips' && styles.navLabelActive]}>Trips</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.navItem} onPress={() => setActiveTab('settings')}>
          <Settings color={activeTab === 'settings' ? '#4285F4' : '#999'} size={26} />
          <Text style={[styles.navLabel, activeTab === 'settings' && styles.navLabelActive]}>Settings</Text>
        </TouchableOpacity>
      </View>

      {/* BLUR OVERLAY - Show when not approved OR registration not completed */}
      {(userStatus !== 'approved' || !registrationCompleted) && (
        <BlurView intensity={90} style={styles.blurOverlay}>
          <View style={styles.overlayCard}>
            <Text style={styles.overlayTitle}>
              {userStatus === 'rejected'
                ? 'Your application was not approved'
                : userStatus === 'pending'
                  ? 'Your account is under review'
                  : !registrationCompleted
                    ? 'Please complete your registration'
                    : 'Account Status Pending'}
            </Text>
            <Text style={styles.overlayMessage}>
              {userStatus === 'rejected'
                ? 'Please contact support for more information'
                : userStatus === 'pending'
                  ? 'Please wait up to 24 hours'
                  : !registrationCompleted
                    ? 'Complete all required steps to start driving'
                    : 'Please wait while we verify your account'}
            </Text>
          </View>
        </BlurView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#E8E8E8' },
  loadingContainer: { justifyContent: 'center', alignItems: 'center' },

  // Full screen map background
  mapFullScreen: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: '#E8E8E8',
  },
  mapBackground: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  mapGrid: {
    position: 'absolute',
    width: '100%',
    height: '100%',
    flexDirection: 'column',
    justifyContent: 'space-between',
  },
  mapGridVertical: { flexDirection: 'row' },
  mapLine: { flex: 1, borderWidth: 0.5, borderColor: '#D0D0D0', opacity: 0.3 },
  serviceRadius: {
    position: 'absolute',
    width: 200,
    height: 200,
    borderRadius: 100,
    borderWidth: 2,
    borderColor: '#00C853',
    backgroundColor: 'rgba(0, 200, 83, 0.08)',
  },
  topButtons: {
    position: 'absolute',
    top: Platform.OS === 'ios' ? 50 : 40,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
  },
  topButton: { width: 44, height: 44 },
  iconCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#fff',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 4,
    elevation: 4,
  },

  // Toggle inside panel - FULL WIDTH
  toggleContainer: {
    marginTop: 16,
  },
  slideTrack: {
    height: 56,
    backgroundColor: '#00C853',
    borderRadius: 30,
    justifyContent: 'center',
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 10,
  },
  slideTrackOnline: {
    backgroundColor: '#E53935',
  },
  slideInstructionText: {
    position: 'absolute',
    left: 0,
    right: 0,
    textAlign: 'center',
    color: '#fff',
    fontSize: 17,
    fontWeight: '600',
  },
  slideInstructionTextOnline: {
    // Text stays centered when online
  },
  slideThumb: {
    position: 'absolute',
    left: 4,
    top: 4,
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#fff',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 8,
  },
  chevronText: {
    color: '#00C853',
    fontSize: 20,
    fontWeight: '700',
  },
  chevronTextOnline: {
    color: '#E53935',
  },
  disabledSlider: {
    opacity: 0.5,
  },

  // Sliding panel - slides behind nav bar when collapsed
  // When collapsed: only scheduled requests card visible above nav
  // When expanded: shows all content including toggle
  slidingPanel: {
    position: 'absolute',
    bottom: 85, // Position above nav bar
    left: 0,
    right: 0,
    height: 300, // Total height of panel content
    backgroundColor: '#F5F5F5',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    zIndex: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 10,
  },
  panelHandleArea: {
    width: '100%',
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  panelHandle: {
    width: 40,
    height: 4,
    backgroundColor: '#D0D0D0',
    borderRadius: 2,
  },
  panelContent: {
    flex: 1,
    paddingHorizontal: 16,
    paddingBottom: 100, // Extra space for content behind bottom nav
  },

  // Scheduled requests card
  scheduledCard: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 16,
    paddingHorizontal: 16,
    backgroundColor: '#fff',
    borderRadius: 12,
    marginBottom: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  scheduledIconCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#F0F0F0',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  scheduledTextContainer: { flex: 1 },
  scheduledTitle: { fontSize: 15, fontWeight: '600', color: '#1A1A1A', marginBottom: 2 },
  scheduledSubtitle: { fontSize: 13, color: '#888' },

  // Stats row
  statsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 10,
  },
  statCard: {
    flex: 1,
    backgroundColor: '#fff',
    paddingVertical: 12,
    paddingHorizontal: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#EBEBEB',
  },
  statHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4,
  },
  statLabel: { fontSize: 12, color: '#666', lineHeight: 16 },
  statValue: { fontSize: 18, fontWeight: '700', color: '#000' },
  bottomNav: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 85,
    backgroundColor: '#fff',
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'center',
    borderTopWidth: 1,
    borderTopColor: '#E8E8E8',
    paddingBottom: Platform.OS === 'ios' ? 20 : 10,
    paddingTop: 8,
    zIndex: 15, // Always on top - panel slides behind it
    elevation: 25,
  },
  navItem: { alignItems: 'center', justifyContent: 'center' },
  iconWrapper: { position: 'relative' },
  badge: {
    position: 'absolute',
    top: -4,
    right: -8,
    backgroundColor: '#FF3B30',
    borderRadius: 10,
    minWidth: 18,
    height: 18,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 4,
    borderWidth: 2,
    borderColor: '#fff',
  },
  badgeText: {
    color: '#fff',
    fontSize: 10,
    fontWeight: '700',
  },
  navLabel: { fontSize: 11, color: '#999', marginTop: 6 },
  navLabelActive: { color: '#4285F4', fontWeight: '600' },
  blurOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 999,
  },
  overlayCard: {
    backgroundColor: 'rgba(255,255,255,0.98)',
    paddingVertical: 36,
    paddingHorizontal: 28,
    borderRadius: 20,
    alignItems: 'center',
  },
  overlayTitle: { fontSize: 20, fontWeight: '700', marginBottom: 12 },
  overlayMessage: { fontSize: 15, color: '#666', textAlign: 'center' },
});



