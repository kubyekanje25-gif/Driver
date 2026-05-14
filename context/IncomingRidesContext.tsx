import React, { createContext, useContext, useState, useEffect } from 'react';
import { collection, query, where, onSnapshot } from 'firebase/firestore';
import { firestore, auth } from '@/config/firebase';

interface Order {
  id: string;
  workflowType: 'direct_trip' | 'store_delivery';
  status: string;
  driverStatus?: string;
  pickup?: string;
  pickupAddress?: string;
  destination?: string;
  destinationAddress?: string;
  fare?: number;
  price?: number;
  userName?: string;
  clientName?: string;
  userId?: string;
  clientId?: string;
  [key: string]: any;
}

interface OrdersContextType {
  activeOrder: Order | null;
  hasActiveOrder: boolean;
}

const OrdersContext = createContext<OrdersContextType | undefined>(undefined);

export function OrdersProvider({ children }: { children: React.ReactNode }) {
  const [activeOrder, setActiveOrder] = useState<Order | null>(null);

  useEffect(() => {
    const uid = auth.currentUser?.uid;
    if (!uid) return;

    // Listen to Firestore orders collection where driverId matches current driver
    // AND status is not "completed"
    const ordersRef = collection(firestore, 'orders');
    const q = query(
      ordersRef,
      where('driverId', '==', uid),
      where('status', '!=', 'completed')
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      if (snapshot.empty) {
        setActiveOrder(null);
        return;
      }

      // Get the first active order (there should typically be only one)
      const orderDoc = snapshot.docs[0];
      const orderData = orderDoc.data();
      
      setActiveOrder({
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
      });
    }, (error) => {
      console.error('[v0] Error listening to orders:', error);
      setActiveOrder(null);
    });

    return () => unsubscribe();
  }, []);

  return (
    <OrdersContext.Provider
      value={{
        activeOrder,
        hasActiveOrder: activeOrder !== null,
      }}
    >
      {children}
    </OrdersContext.Provider>
  );
}

export function useOrders() {
  const context = useContext(OrdersContext);
  if (context === undefined) {
    throw new Error('useOrders must be used within OrdersProvider');
  }
  return context;
}

// Keep old export for backward compatibility during migration
export const IncomingRidesProvider = OrdersProvider;
export const useIncomingRides = useOrders;
