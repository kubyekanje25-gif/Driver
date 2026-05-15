import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Dimensions,
  Animated,
  PanResponder,
  Platform,
} from 'react-native';
import { User, MapPin, Navigation, DollarSign, Hash, GripHorizontal } from 'lucide-react-native';
import { ref, onValue, off } from 'firebase/database';
import { database, auth } from '@/config/firebase';

const { width, height } = Dimensions.get('window');

// Panel positions
const PANEL_EXPANDED_Y = 0; // Fully expanded (attached to top)
const PANEL_MINIMIZED_Y = -280; // Minimized (only handle bar visible)
const PANEL_HEIGHT = 380;

interface TripRequest {
  orderId: string;
  workflowType: 'direct_trip' | 'delivery';
  requestType: string;
  status: string;
  createdAt: number;
  expiresAt: number;
  data: {
    pickupAddress: string;
    destinationAddress: string;
    pickupLat: number;
    pickupLng: number;
    dropLat: number;
    dropLng: number;
    total: number;
    fee: number;
    userName: string;
    userPhone: string;
    serviceType?: string;
  };
}

export default function GlobalTripRequestPanel() {
  const [currentRequest, setCurrentRequest] = useState<TripRequest | null>(null);
  const [isVisible, setIsVisible] = useState(false);
  const [isMinimized, setIsMinimized] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  // Animation value for panel position
  const panelY = useRef(new Animated.Value(PANEL_MINIMIZED_Y)).current;

  // Pan responder for drag gestures
  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: () => {
        panelY.stopAnimation();
      },
      onPanResponderMove: (_, gestureState) => {
        // Calculate new position based on drag
        const newY = isMinimized
          ? PANEL_MINIMIZED_Y + gestureState.dy
          : PANEL_EXPANDED_Y + gestureState.dy;
        
        // Clamp between minimized and expanded
        const clampedY = Math.max(PANEL_MINIMIZED_Y, Math.min(PANEL_EXPANDED_Y, newY));
        panelY.setValue(clampedY);
      },
      onPanResponderRelease: (_, gestureState) => {
        const velocity = gestureState.vy;
        const currentY = isMinimized
          ? PANEL_MINIMIZED_Y + gestureState.dy
          : PANEL_EXPANDED_Y + gestureState.dy;

        // Snap based on velocity or position
        if (velocity < -0.5 || (velocity >= -0.5 && velocity <= 0.5 && currentY < (PANEL_MINIMIZED_Y + PANEL_EXPANDED_Y) / 2)) {
          // Swipe up or in upper half -> minimize
          animateToPosition(PANEL_MINIMIZED_Y);
          setIsMinimized(true);
        } else {
          // Swipe down or in lower half -> expand
          animateToPosition(PANEL_EXPANDED_Y);
          setIsMinimized(false);
        }
      },
    })
  ).current;

  const animateToPosition = (toValue: number) => {
    Animated.spring(panelY, {
      toValue,
      useNativeDriver: true,
      tension: 80,
      friction: 12,
    }).start();
  };

  // Listen to driver_trip_requests/{driverUid}
  useEffect(() => {
    const uid = auth.currentUser?.uid;
    if (!uid) return;

    const tripRequestsRef = ref(database, `driver_trip_requests/${uid}`);
    const listener = onValue(tripRequestsRef, (snapshot) => {
      const data = snapshot.val();

      if (!data) {
        // No requests - hide panel if status allows
        if (currentRequest?.status === 'completed' || 
            currentRequest?.status === 'rejected' || 
            currentRequest?.status === 'expired' ||
            currentRequest?.status === 'cancelled') {
          setCurrentRequest(null);
          setIsVisible(false);
        } else if (!currentRequest) {
          setIsVisible(false);
        }
        return;
      }

      // Get all requests
      const requests = Object.entries(data).map(([orderId, requestData]: [string, any]) => ({
        orderId,
        ...requestData,
      })) as TripRequest[];

      if (requests.length === 0) {
        if (!currentRequest || ['completed', 'rejected', 'expired', 'cancelled'].includes(currentRequest.status)) {
          setCurrentRequest(null);
          setIsVisible(false);
        }
        return;
      }

      // Get the latest/current active request
      const activeRequest = requests.find(r => 
        !['completed', 'rejected', 'expired', 'cancelled'].includes(r.status)
      );

      if (activeRequest) {
        const prevStatus = currentRequest?.status;
        setCurrentRequest(activeRequest);

        // Show panel on new incoming request
        if (activeRequest.status === 'incoming_request' && !isVisible) {
          setIsVisible(true);
          setIsMinimized(false);
          animateToPosition(PANEL_EXPANDED_Y);
        }

        // Handle status changes that should hide panel
        if (['completed', 'rejected', 'expired', 'cancelled'].includes(activeRequest.status)) {
          setTimeout(() => {
            setIsVisible(false);
            setCurrentRequest(null);
          }, 1000); // Brief delay to show final status
        }
      } else {
        // No active request found
        setCurrentRequest(null);
        setIsVisible(false);
      }
    });

    return () => off(tripRequestsRef, 'value', listener);
  }, [currentRequest?.status, isVisible]);

  // API call handlers
  const callBackendAction = async (action: string) => {
    const uid = auth.currentUser?.uid;
    if (!uid || !currentRequest) return;

    setIsLoading(true);
    try {
      let endpoint = '';
      let body: any = {
        orderId: currentRequest.orderId,
        driverId: uid,
      };

      switch (action) {
        case 'accept':
          endpoint = '/api/acceptDriverRequest';
          break;
        case 'reject':
          endpoint = '/api/declineDriverRequest';
          break;
        case 'arrived':
        case 'started':
        case 'at_store':
        case 'picked_up':
        case 'delivered':
        case 'completed':
          endpoint = '/api/updateTripStatus';
          body.status = action;
          break;
        default:
          return;
      }

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        throw new Error(`Failed to ${action}`);
      }

      // DO NOT manually close or update state
      // WAIT for RTDB listener to receive status update
    } catch (error) {
      console.error(`[v0] Error calling ${action}:`, error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleAccept = () => callBackendAction('accept');
  const handleReject = () => callBackendAction('reject');
  const handleArrived = () => callBackendAction('arrived');
  const handleStartTrip = () => callBackendAction('started');
  const handleComplete = () => callBackendAction('completed');
  const handleAtStore = () => callBackendAction('at_store');
  const handlePickedUp = () => callBackendAction('picked_up');
  const handleDelivered = () => callBackendAction('delivered');

  // Render buttons based on workflowType and status
  const renderButtons = () => {
    if (!currentRequest) return null;

    const { workflowType, status } = currentRequest;

    if (workflowType === 'direct_trip') {
      switch (status) {
        case 'incoming_request':
          return (
            <View style={styles.buttonRow}>
              <TouchableOpacity 
                style={styles.rejectButton} 
                onPress={handleReject}
                disabled={isLoading}
              >
                <Text style={styles.buttonText}>Reject</Text>
              </TouchableOpacity>
              <TouchableOpacity 
                style={styles.acceptButton} 
                onPress={handleAccept}
                disabled={isLoading}
              >
                <Text style={styles.buttonText}>Accept</Text>
              </TouchableOpacity>
            </View>
          );
        case 'accepted':
          return (
            <TouchableOpacity 
              style={styles.actionButton} 
              onPress={handleArrived}
              disabled={isLoading}
            >
              <Text style={styles.buttonText}>Arrived</Text>
            </TouchableOpacity>
          );
        case 'arrived':
          return (
            <TouchableOpacity 
              style={styles.actionButton} 
              onPress={handleStartTrip}
              disabled={isLoading}
            >
              <Text style={styles.buttonText}>Start Trip</Text>
            </TouchableOpacity>
          );
        case 'started':
          return (
            <TouchableOpacity 
              style={styles.completeButton} 
              onPress={handleComplete}
              disabled={isLoading}
            >
              <Text style={styles.buttonText}>Complete</Text>
            </TouchableOpacity>
          );
        default:
          return null;
      }
    } else if (workflowType === 'delivery') {
      switch (status) {
        case 'incoming_request':
          return (
            <View style={styles.buttonRow}>
              <TouchableOpacity 
                style={styles.rejectButton} 
                onPress={handleReject}
                disabled={isLoading}
              >
                <Text style={styles.buttonText}>Reject</Text>
              </TouchableOpacity>
              <TouchableOpacity 
                style={styles.acceptButton} 
                onPress={handleAccept}
                disabled={isLoading}
              >
                <Text style={styles.buttonText}>Accept</Text>
              </TouchableOpacity>
            </View>
          );
        case 'accepted':
          return (
            <TouchableOpacity 
              style={styles.actionButton} 
              onPress={handleAtStore}
              disabled={isLoading}
            >
              <Text style={styles.buttonText}>At Store</Text>
            </TouchableOpacity>
          );
        case 'at_store':
          return (
            <TouchableOpacity 
              style={styles.actionButton} 
              onPress={handlePickedUp}
              disabled={isLoading}
            >
              <Text style={styles.buttonText}>Picked Up</Text>
            </TouchableOpacity>
          );
        case 'picked_up':
          return (
            <TouchableOpacity 
              style={styles.actionButton} 
              onPress={handleDelivered}
              disabled={isLoading}
            >
              <Text style={styles.buttonText}>Delivered</Text>
            </TouchableOpacity>
          );
        case 'delivered':
          return (
            <TouchableOpacity 
              style={styles.completeButton} 
              onPress={handleComplete}
              disabled={isLoading}
            >
              <Text style={styles.buttonText}>Complete</Text>
            </TouchableOpacity>
          );
        default:
          return null;
      }
    }

    return null;
  };

  // Get status display text
  const getStatusText = () => {
    if (!currentRequest) return '';
    const statusMap: Record<string, string> = {
      incoming_request: 'New Request',
      accepted: 'Accepted - En route to pickup',
      arrived: 'Arrived at pickup',
      started: 'Trip in progress',
      at_store: 'At store',
      picked_up: 'Package picked up',
      delivered: 'Delivered',
      completed: 'Completed',
      rejected: 'Rejected',
      expired: 'Expired',
    };
    return statusMap[currentRequest.status] || currentRequest.status;
  };

  if (!isVisible || !currentRequest) return null;

  const requestData = currentRequest.data || {};
  const pickupAddress = requestData.pickupAddress || 'Unknown';
  const destinationAddress = requestData.destinationAddress || 'Unknown';
  const price = requestData.total || requestData.fee || 0;
  const userName = requestData.userName || 'Customer';

  return (
    <View style={styles.overlay} pointerEvents="box-none">
      <Animated.View
        style={[
          styles.panel,
          {
            transform: [{ translateY: panelY }],
          },
        ]}
        {...panResponder.panHandlers}
      >
        {/* Handle bar - always visible */}
        <View style={styles.handleContainer}>
          <View style={styles.handleBar} />
        </View>

        {/* Panel content */}
        <View style={styles.content}>
          {/* Status badge */}
          <View style={styles.statusBadge}>
            <Text style={styles.statusText}>{getStatusText()}</Text>
          </View>

          {/* Order ID */}
          <View style={styles.orderIdContainer}>
            <Hash color="#666" size={14} />
            <Text style={styles.orderIdText}>{currentRequest.orderId.slice(0, 16)}...</Text>
          </View>

          {/* Customer */}
          <View style={styles.infoRow}>
            <User color="#333" size={18} />
            <View style={styles.infoContent}>
              <Text style={styles.label}>Customer</Text>
              <Text style={styles.value}>{userName}</Text>
            </View>
          </View>

          {/* Pickup */}
          <View style={styles.infoRow}>
            <MapPin color="#00C853" size={18} />
            <View style={styles.infoContent}>
              <Text style={styles.label}>Pickup</Text>
              <Text style={styles.value} numberOfLines={1}>{pickupAddress}</Text>
            </View>
          </View>

          {/* Destination */}
          <View style={styles.infoRow}>
            <Navigation color="#4285F4" size={18} />
            <View style={styles.infoContent}>
              <Text style={styles.label}>Destination</Text>
              <Text style={styles.value} numberOfLines={1}>{destinationAddress}</Text>
            </View>
          </View>

          {/* Fare */}
          <View style={styles.fareRow}>
            <DollarSign color="#FFB300" size={20} />
            <Text style={styles.fareValue}>R{price.toFixed(2)}</Text>
          </View>

          {/* Action buttons */}
          <View style={styles.buttonContainer}>
            {renderButtons()}
          </View>
        </View>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 9999,
    elevation: 9999,
  },
  panel: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: PANEL_HEIGHT,
    backgroundColor: '#fff',
    borderBottomLeftRadius: 24,
    borderBottomRightRadius: 24,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 12,
    elevation: 20,
  },
  handleContainer: {
    alignItems: 'center',
    paddingTop: Platform.OS === 'ios' ? 50 : 30,
    paddingBottom: 8,
  },
  handleBar: {
    width: 40,
    height: 5,
    backgroundColor: '#DDD',
    borderRadius: 3,
  },
  content: {
    flex: 1,
    paddingHorizontal: 20,
    paddingBottom: 20,
  },
  statusBadge: {
    alignSelf: 'center',
    backgroundColor: '#E8F5E9',
    paddingHorizontal: 16,
    paddingVertical: 6,
    borderRadius: 20,
    marginBottom: 12,
  },
  statusText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#2E7D32',
  },
  orderIdContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
    gap: 4,
  },
  orderIdText: {
    fontSize: 12,
    color: '#666',
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
    paddingHorizontal: 4,
  },
  infoContent: {
    marginLeft: 10,
    flex: 1,
  },
  label: {
    fontSize: 11,
    color: '#888',
  },
  value: {
    fontSize: 14,
    fontWeight: '600',
    color: '#333',
  },
  fareRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
    marginBottom: 16,
    gap: 6,
  },
  fareValue: {
    fontSize: 24,
    fontWeight: '700',
    color: '#00C853',
  },
  buttonContainer: {
    marginTop: 'auto',
  },
  buttonRow: {
    flexDirection: 'row',
    gap: 12,
  },
  acceptButton: {
    flex: 1,
    backgroundColor: '#00C853',
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
  },
  rejectButton: {
    flex: 1,
    backgroundColor: '#E53935',
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
  },
  actionButton: {
    backgroundColor: '#2196F3',
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
  },
  completeButton: {
    backgroundColor: '#00C853',
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
  },
});
