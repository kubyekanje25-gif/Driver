import React, { createContext, useContext, useState, useEffect } from 'react';
import { ref, onValue, off } from 'firebase/database';
import { database, auth } from '@/config/firebase';

interface IncomingRide {
  id: string;
  userName: string;
  pickup: string;
  destination: string;
  price: number;
  status: string;
  [key: string]: any;
}

interface IncomingRidesContextType {
  incomingRide: IncomingRide | null;
  showIncomingRidePopup: boolean;
  dismissIncomingRide: () => void;
}

const IncomingRidesContext = createContext<IncomingRidesContextType | undefined>(undefined);

export function IncomingRidesProvider({ children }: { children: React.ReactNode }) {
  const [incomingRide, setIncomingRide] = useState<IncomingRide | null>(null);
  const [showIncomingRidePopup, setShowIncomingRidePopup] = useState(false);

  useEffect(() => {
    const uid = auth.currentUser?.uid;
    if (!uid) return;

    const incomingRef = ref(database, `drivers/${uid}/incoming`);

    const incomingListener = onValue(incomingRef, (snapshot) => {
      const data = snapshot.val();

      if (data) {
        let foundPendingRide = false;

        Object.entries(data).forEach(([rideId, rideData]: [string, any]) => {
          if (rideData && rideData.status === 'pending' && !foundPendingRide) {
            foundPendingRide = true;
            setIncomingRide({
              id: rideId,
              ...rideData,
            });
            setShowIncomingRidePopup(true);
          }
        });

        if (!foundPendingRide) {
          setIncomingRide(null);
          setShowIncomingRidePopup(false);
        }
      } else {
        setIncomingRide(null);
        setShowIncomingRidePopup(false);
      }
    });

    return () => {
      off(incomingRef, 'value', incomingListener);
    };
  }, []);

  const dismissIncomingRide = () => {
    setShowIncomingRidePopup(false);
    setIncomingRide(null);
  };

  return (
    <IncomingRidesContext.Provider
      value={{
        incomingRide,
        showIncomingRidePopup,
        dismissIncomingRide,
      }}
    >
      {children}
    </IncomingRidesContext.Provider>
  );
}

export function useIncomingRides() {
  const context = useContext(IncomingRidesContext);
  if (context === undefined) {
    throw new Error('useIncomingRides must be used within IncomingRidesProvider');
  }
  return context;
}