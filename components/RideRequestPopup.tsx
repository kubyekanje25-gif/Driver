import React from 'react';
import {
  View,
  Text,
  Modal,
  TouchableOpacity,
  StyleSheet,
  Dimensions,
} from 'react-native';
import { User, MapPin, Navigation, DollarSign, Hash } from 'lucide-react-native';

const { width } = Dimensions.get('window');

interface RideRequestPopupProps {
  visible: boolean;
  ride: {
    orderId?: string;
    userName?: string;
    pickup?: string;
    pickupAddress?: string;
    destination?: string;
    destinationAddress?: string;
    price?: number;
    fare?: number;
    workflowType?: string;
  } | null;
  onAccept: () => void;
  onReject: () => void;
  onCancel: () => void;
}

export default function RideRequestPopup({
  visible,
  ride,
  onAccept,
  onReject,
  onCancel,
}: RideRequestPopupProps) {
  if (!ride) return null;

  const pickupAddress = ride.pickupAddress || ride.pickup || 'Unknown';
  const destinationAddress = ride.destinationAddress || ride.destination || 'Unknown';
  const price = ride.price || ride.fare || 0;
  const userName = ride.userName || 'Customer';
  const orderId = ride.orderId || '';

  return (
    <Modal
      visible={visible}
      transparent={true}
      animationType="fade"
      onRequestClose={onCancel}
    >
      <View style={styles.overlay}>
        <View style={styles.card}>
          <Text style={styles.title}>New Trip Request</Text>

          {orderId && (
            <View style={styles.orderIdContainer}>
              <Hash color="#666" size={14} />
              <Text style={styles.orderIdText}>{orderId.slice(0, 12)}...</Text>
            </View>
          )}

          <View style={styles.infoRow}>
            <User color="#333" size={20} />
            <View style={styles.infoContent}>
              <Text style={styles.label}>Customer</Text>
              <Text style={styles.value}>{userName}</Text>
            </View>
          </View>

          <View style={styles.infoRow}>
            <MapPin color="#00C853" size={20} />
            <View style={styles.infoContent}>
              <Text style={styles.label}>Pickup</Text>
              <Text style={styles.value} numberOfLines={2}>{pickupAddress}</Text>
            </View>
          </View>

          <View style={styles.infoRow}>
            <Navigation color="#4285F4" size={20} />
            <View style={styles.infoContent}>
              <Text style={styles.label}>Destination</Text>
              <Text style={styles.value} numberOfLines={2}>{destinationAddress}</Text>
            </View>
          </View>

          <View style={styles.infoRow}>
            <DollarSign color="#FFB300" size={20} />
            <View style={styles.infoContent}>
              <Text style={styles.label}>Fare</Text>
              <Text style={styles.priceValue}>R{price.toFixed(2)}</Text>
            </View>
          </View>

          <View style={styles.buttonContainer}>
            <TouchableOpacity style={styles.rejectButton} onPress={onReject}>
              <Text style={styles.rejectText}>Decline</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.acceptButton} onPress={onAccept}>
              <Text style={styles.acceptText}>Accept</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  card: {
    width: width - 48,
    backgroundColor: '#fff',
    borderRadius: 20,
    padding: 24,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 12,
    elevation: 10,
  },
  title: {
    fontSize: 24,
    fontWeight: '700',
    color: '#000',
    textAlign: 'center',
    marginBottom: 8,
  },
  orderIdContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
    gap: 4,
  },
  orderIdText: {
    fontSize: 12,
    color: '#666',
    fontFamily: 'monospace',
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 16,
    paddingLeft: 8,
  },
  infoContent: {
    marginLeft: 12,
    flex: 1,
  },
  label: {
    fontSize: 12,
    color: '#888',
    marginBottom: 2,
  },
  value: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
  },
  priceValue: {
    fontSize: 20,
    fontWeight: '700',
    color: '#00C853',
  },
  buttonContainer: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 24,
  },
  acceptButton: {
    flex: 1,
    backgroundColor: '#00C853',
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: 'center',
  },
  acceptText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
  },
  rejectButton: {
    flex: 1,
    backgroundColor: '#E53935',
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: 'center',
  },
  rejectText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
  },
});
