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
import { doc, onSnapshot } from 'firebase/firestore';

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

const watchLocation = async (callback: (coords: { latitude: number; longitude: number; heading?: number }) => void) => {
  if (Platform.OS !== 'web') {
    const Location = await import('expo-location');
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') return null;
    
    return await Location.watchPositionAsync(
      {
        accuracy: Location.Accuracy.High,
        timeInterval: 5000,
        distanceInterval: 10,
      },
      (loc) => {
        callback({ latitude: loc.coords.latitude, longitude: loc.coords.longitude, heading: loc.coords.heading || 0 });
      }
    );
  } else {
    if (!navigator.geolocation) return null;
    const watchId = navigator.geolocation.watchPosition(
      (pos) => callback({ latitude: pos.coords.latitude, longitude: pos.coords.longitude, heading: pos.coords.heading || 0 }),
      () => {},
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
  const SLIDE_WIDTH = width - 40;
  const SLIDE_THRESHOLD = SLIDE_WIDTH * 0.5;

  // Panel animation for draggable bottom sheet (panel slides behind nav bar)
  const PANEL_MIN_HEIGHT = 280; // Collapsed height (includes space behind 85px nav)
  const PANEL_MAX_HEIGHT = height * 0.6; // Expanded height
  const panelY = useRef(new Animated.Value(0)).current; // 0 = collapsed, negative = expanded
  const savedPanelY = useRef(0);

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
        
        // Store driver profile data for ride acceptance
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
        sliderX.setValue(data.isOnline ? SLIDE_WIDTH : 0);
      } else {
        setIsOnline(false);
        setIsBusy(false);
        sliderX.setValue(0);
      }
    });

    // Listen to Realtime DB drivers/{uid} for current ride info
    const driverRealtimeRef = ref(database, `drivers/${uid}`);
    let currentRideUnsubscribe: (() => void) | null = null;

    const driverListener = onValue(driverRealtimeRef, (snapshot) => {
      const data = snapshot.val();
      if (data) {
        if (data.currentRide) {
          if (currentRideUnsubscribe) {
            currentRideUnsubscribe();
          }

          const currentRideRef = ref(database, `rides/${data.currentRide}`);
          const rideListener = onValue(currentRideRef, (rideSnapshot) => {
            const rideData = rideSnapshot.val();
            if (rideData) {
              setActiveRide({ id: data.currentRide, ...rideData });
              setRideStatus(rideData.status);
            }
          });

          currentRideUnsubscribe = () => off(currentRideRef, 'value', rideListener);
        } else {
          if (currentRideUnsubscribe) {
            currentRideUnsubscribe();
            currentRideUnsubscribe = null;
          }
          setActiveRide(null);
          setRideStatus(null);
        }
      }
    });

    return () => {
      unsubscribeFirestore();
      off(driversOnlineRef, 'value', onlineListener);
      off(driverRealtimeRef, 'value', driverListener);
      if (currentRideUnsubscribe) {
        currentRideUnsubscribe();
      }
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

    const subscription = await watchLocation(async (coords) => {
      const { latitude, longitude, heading } = coords;

      setCurrentLocation({ latitude, longitude });

      // Update driver_locations/{uid} with geohash format for GeoFire compatibility
      const geoObject = createGeoFireObject(latitude, longitude);
      await set(ref(database, `driver_locations/${uid}`), geoObject);

      // Also update drivers/{uid}/location for backwards compatibility
      await update(ref(database, `drivers/${uid}/location`), {
        latitude,
        longitude,
        heading: heading || 0,
        updatedAt: Date.now(),
      });

      await update(ref(database, `drivers/${uid}`), {
        lat: latitude,
        lng: longitude,
        lastActive: Date.now(),
      });

      // Update ride location if driver is busy with an active ride
      if (isBusy && activeRide) {
        await update(ref(database, `rides/${activeRide.id}/location`), {
          latitude,
          longitude,
        });
      }

      console.log('[v0] Driver location updated with geohash:', latitude, longitude);
    });
    setLocationSubscription(subscription);
  };

  const stopTracking = async () => {
    const uid = auth.currentUser?.uid;
    if (!uid) return;

    if (locationSubscription) {
      try {
        await locationSubscription.remove();
      } catch (error) {
        console.log('[v0] Error removing location subscription:', error);
      }
      setLocationSubscription(null);
    }

    // Remove driver_locations/{uid} when going offline
    await remove(ref(database, `driver_locations/${uid}`));

    await update(ref(database, `drivers/${uid}`), {
      status: 'offline',
    });

    console.log('[v0] Driver location tracking stopped, driver_locations removed');
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
      const { latitude, longitude, heading } = coords;

      // Update drivers/{uid} with full info
      await update(ref(database, `drivers/${uid}`), {
        name: driverName,
        plateNumber,
        carModel,
        rating,
        photo,
        status: 'online',
        busy: false,
        lastActive: Date.now(),
        location: {
          latitude,
          longitude,
          heading: heading || 0,
        },
      });

      // Update driver_locations/{uid} with geohash
      const geoObject = createGeoFireObject(latitude, longitude);
      await set(ref(database, `driver_locations/${uid}`), geoObject);
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
      toValue: SLIDE_WIDTH,
      useNativeDriver: true,
      tension: 100,
      friction: 10,
    }).start();

    console.log('[v0] Driver is now online - drivers_online set');
  };

  const goOffline = async () => {
    const uid = auth.currentUser?.uid;
    if (!uid) return;

    setIsOnline(false);
    await stopTracking();
    
    // Update drivers/{uid} status
    await update(ref(database, `drivers/${uid}`), {
      status: 'offline',
    });

    // REMOVE drivers_online/{uid} - Driver goes offline
    await remove(ref(database, `drivers_online/${uid}`));

    Animated.spring(sliderX, {
      toValue: 0,
      useNativeDriver: true,
      tension: 100,
      friction: 10,
    }).start();

    console.log('[v0] Driver is now offline - drivers_online removed');
  };

  useEffect(() => {
    const uid = auth.currentUser?.uid;
    if (!uid || isBusy || !isOnline) return;

    const incomingRef = ref(database, `drivers/${uid}/incoming`);
    const incomingListener = onValue(incomingRef, (snapshot) => {
      if (isBusy) return;

      snapshot.forEach((child) => {
        const rideId = child.key;
        if (!rideId) return;

        const rideRef = ref(database, `rides/${rideId}`);
        onValue(rideRef, (rideSnapshot) => {
          const ride = rideSnapshot.val();
          if (ride && ride.status === 'waiting') {
            setPendingRide({ id: rideId, ...ride });
            setShowRidePopup(true);
          }
        });
      });
    });

    return () => off(incomingRef, 'value', incomingListener);
  }, [isBusy, isOnline]);

  const handleAcceptRide = async () => {
    const uid = auth.currentUser?.uid;
    if (!uid || !pendingRide || !driverData) {
      console.error('❌ Cannot accept ride: missing uid, pendingRide, or driverData');
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

      const driverLat = currentLocation?.latitude || 0;
      const driverLng = currentLocation?.longitude || 0;

      console.log('📝 Updating rideRequests status to accepted...');
      await update(ref(database, `rideRequests/${pendingRide.id}`), {
        status: 'accepted',
        driverId: uid,
        acceptedAt: Date.now(),
      });

      console.log('📝 Updating rides with driver info...');
      await update(ref(database, `rides/${pendingRide.id}`), {
        status: 'accepted',
        acceptedAt: Date.now(),
        driverId: uid,
        driverName,
        plateNumber,
        carModel,
        rating,
        photo,
        location: {
          latitude: driverLat,
          longitude: driverLng,
        },
      });

      console.log('🗑️ Removing from drivers/incoming...');
      await remove(ref(database, `drivers/${uid}/incoming/${pendingRide.id}`));

      console.log('[v0] Updating driver status to busy...');
      await update(ref(database, `drivers/${uid}`), {
        busy: true,
        currentRide: pendingRide.id,
      });

      // Update drivers_online/{uid} isBusy = true
      await update(ref(database, `drivers_online/${uid}`), {
        isBusy: true,
        lastUpdated: Date.now(),
      });

      console.log('[v0] Ride accepted successfully - driver is now busy');

      setShowRidePopup(false);
      setPendingRide(null);
    } catch (error) {
      console.error('❌ Error accepting ride:', error);
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

  const handleArrived = async () => {
    if (!activeRide) {
      console.error('❌ Cannot mark arrived: no active ride');
      return;
    }

    try {
      console.log('📝 Updating ride status to arrived...');
      await update(ref(database, `rides/${activeRide.id}`), {
        status: 'arrived',
        arrivedAt: Date.now(),
      });
      console.log('✅ Ride status updated to arrived');
    } catch (error) {
      console.error('❌ Error updating ride to arrived:', error);
    }
  };

  const handleStartTrip = async () => {
    if (!activeRide) {
      console.error('❌ Cannot start trip: no active ride');
      return;
    }

    try {
      console.log('📝 Updating ride status to started...');
      await update(ref(database, `rides/${activeRide.id}`), {
        status: 'started',
        startedAt: Date.now(),
      });
      console.log('✅ Ride status updated to started');
    } catch (error) {
      console.error('❌ Error starting trip:', error);
    }
  };

  const handleCompleteTrip = async () => {
    const uid = auth.currentUser?.uid;
    if (!uid || !activeRide) {
      console.error('��� Cannot complete trip: missing uid or active ride');
      return;
    }

    try {
      console.log('📝 Updating ride status to completed...');
      await update(ref(database, `rides/${activeRide.id}`), {
        status: 'completed',
        completedAt: Date.now(),
      });

      console.log('📝 Cleaning up messages...');
      await remove(ref(database, `rides/${activeRide.id}/messages`));

      console.log('[v0] Updating driver status to available...');
      await update(ref(database, `drivers/${uid}`), {
        busy: false,
        currentRide: null,
      });

      // Update drivers_online/{uid} isBusy = false
      await update(ref(database, `drivers_online/${uid}`), {
        isBusy: false,
        lastUpdated: Date.now(),
      });

      console.log('[v0] Trip completed - driver is now available');

      setActiveRide(null);
      setRideStatus(null);
    } catch (error) {
      console.error('❌ Error completing trip:', error);
    }
  };

  const startX = useRef(0);
  const savedTranslateX = useRef(0);

  const gesture = Gesture.Pan()
    .enabled(userStatus === 'approved' && registrationCompleted)
    .onStart(() => {
      savedTranslateX.current = isOnline ? SLIDE_WIDTH : 0;
    })
    .onUpdate((event) => {
      const newValue = Math.max(0, Math.min(savedTranslateX.current + event.translationX, SLIDE_WIDTH));
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
      savedPanelY.current = (panelY as any)._value || 0;
    })
    .onUpdate((event) => {
      const maxUp = -(PANEL_MAX_HEIGHT - PANEL_MIN_HEIGHT);
      const newValue = Math.max(maxUp, Math.min(0, savedPanelY.current + event.translationY));
      panelY.setValue(newValue);
    })
    .onEnd((event) => {
      const maxUp = -(PANEL_MAX_HEIGHT - PANEL_MIN_HEIGHT);
      const snapThreshold = maxUp / 2;
      const currentValue = savedPanelY.current + event.translationY;
      
      if (currentValue < snapThreshold) {
        // Snap to expanded
        Animated.spring(panelY, {
          toValue: maxUp,
          useNativeDriver: true,
          tension: 80,
          friction: 12,
        }).start();
      } else {
        // Snap to collapsed
        Animated.spring(panelY, {
          toValue: 0,
          useNativeDriver: true,
          tension: 80,
          friction: 12,
        }).start();
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

      {/* RIDE MANAGEMENT PANEL */}
      <RideManagementPanel
        rideStatus={rideStatus}
        rideInfo={activeRide}
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

      {/* FLOATING TOGGLE - Behind the panel, FULL WIDTH */}
      <View
        style={[
          styles.toggleContainer,
          (userStatus !== 'approved' || !registrationCompleted) && styles.disabledSlider,
        ]}
        pointerEvents={(userStatus === 'approved' && registrationCompleted) ? 'auto' : 'none'}
      >
        <View style={[styles.slideTrack, isOnline && styles.slideTrackOnline]}>
          <Text style={styles.slideInstructionText}>
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
              <Text style={styles.chevronText}>{'>>'}</Text>
            </Animated.View>
          </GestureDetector>
        </View>
      </View>

      {/* DRAGGABLE SLIDING PANEL */}
      <Animated.View
        style={[
          styles.slidingPanel,
          {
            transform: [{ translateY: panelY }],
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
          {/* Scheduled Requests Card */}
          <View style={styles.scheduledCard}>
            <View style={styles.scheduledIconCircle}>
              <Clock color="#666" size={24} />
            </View>
            <View style={styles.scheduledTextContainer}>
              <Text style={styles.scheduledTitle}>New scheduled requests</Text>
              <Text style={styles.scheduledSubtitle}>Choose a request that suits you</Text>
            </View>
          </View>

          {/* Stats Row */}
          <View style={styles.statsRow}>
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
              <Text style={styles.statValue}>5.00</Text>
            </View>
          </View>
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
  
  // Floating toggle - FULL WIDTH, positioned above the panel
  toggleContainer: {
    position: 'absolute',
    bottom: 300, // Above the panel when collapsed (panel is 280px)
    left: 16,
    right: 16,
    zIndex: 5, // Lower z-index so panel slides over it
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
    left: 60,
    right: 0,
    textAlign: 'center',
    color: '#fff',
    fontSize: 17,
    fontWeight: '600',
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
  disabledSlider: {
    opacity: 0.5,
  },
  
  // Sliding panel - positioned BEHIND the bottom nav, IN FRONT of toggle
  slidingPanel: {
    position: 'absolute',
    bottom: 0, // Starts from bottom, slides behind nav
    left: 0,
    right: 0,
    height: 280, // Min height when collapsed (includes space behind nav)
    backgroundColor: '#F5F5F5',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    zIndex: 10, // Higher than toggle (5), lower than nav (15)
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



