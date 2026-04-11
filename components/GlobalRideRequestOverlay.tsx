import React, { useState, useEffect } from 'react';
import { Platform } from 'react-native';
import { ref, update, remove, onValue, off } from 'firebase/database';
import { database, auth } from '@/config/firebase';
import RideRequestPopup from '@/components/RideRequestPopup';
import { useIncomingRides } from '@/context/IncomingRidesContext';

export default function GlobalRideRequestOverlay() {
  const { incomingRide, showIncomingRidePopup, dismissIncomingRide } = useIncomingRides();
  const [driverData, setDriverData] = useState<any>(null);

  useEffect(() => {
    const uid = auth.currentUser?.uid;
    if (!uid) return;

    const userRef = ref(database, `users/${uid}`);
    const listener = onValue(userRef, (snapshot) => {
      const data = snapshot.val();
      if (data) {
        setDriverData(data);
      }
    });

    return () => off(userRef, 'value', listener);
  }, []);

  const handleAccept = async () => {
    const uid = auth.currentUser?.uid;
    if (!uid || !incomingRide || !driverData) return;

    try {
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

      let latitude = 0;
      let longitude = 0;

      // Only use expo-location on native platforms
      if (Platform.OS !== 'web') {
        try {
          const Location = await import('expo-location');
          const { status } = await Location.requestForegroundPermissionsAsync();
          if (status === 'granted') {
            const location = await Location.getCurrentPositionAsync({});
            latitude = location.coords.latitude;
            longitude = location.coords.longitude;
          }
        } catch (e) {
          console.warn('Location not available:', e);
        }
      } else {
        // Use browser geolocation API for web
        try {
          const position = await new Promise<GeolocationPosition>((resolve, reject) => {
            navigator.geolocation.getCurrentPosition(resolve, reject);
          });
          latitude = position.coords.latitude;
          longitude = position.coords.longitude;
        } catch (e) {
          console.warn('Web geolocation not available:', e);
        }
      }

      await update(ref(database, `rideRequests/${incomingRide.id}`), {
        status: 'accepted',
      });

      await update(ref(database, `rides/${incomingRide.id}`), {
        status: 'accepted',
        acceptedAt: Date.now(),
        driverId: uid,
        driverName,
        plateNumber,
        carModel,
        rating,
        photo,
        location: {
          latitude,
          longitude,
        },
      });

      await remove(ref(database, `drivers/${uid}/incoming/${incomingRide.id}`));

      await update(ref(database, `drivers/${uid}`), {
        busy: true,
        currentRide: incomingRide.id,
      });

      console.log('✅ Incoming ride accepted from global overlay with full driver info');
      dismissIncomingRide();
    } catch (error) {
      console.error('Error accepting incoming ride:', error);
    }
  };

  const handleReject = async () => {
    const uid = auth.currentUser?.uid;
    if (!uid || !incomingRide) return;

    try {
      await remove(ref(database, `drivers/${uid}/incoming/${incomingRide.id}`));

      console.log('❌ Incoming ride rejected from global overlay');
      dismissIncomingRide();
    } catch (error) {
      console.error('Error rejecting incoming ride:', error);
    }
  };

  const handleCancel = () => {
    dismissIncomingRide();
  };

  return (
    <RideRequestPopup
      visible={showIncomingRidePopup}
      ride={incomingRide}
      onAccept={handleAccept}
      onReject={handleReject}
      onCancel={handleCancel}
    />
  );
}
