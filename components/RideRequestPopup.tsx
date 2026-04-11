import React from 'react';
import {
  View,
  Text,
  Modal,
  TouchableOpacity,
  StyleSheet,
  Dimensions,
} from 'react-native';
import { User, MapPin, Navigation, DollarSign } from 'lucide-react-native';

const { width } = Dimensions.get('window');

interface RideRequestPopupProps {
  visible: boolean;
  ride: {
    userName: string;
    pickup: string;
    destination: string;
    price: number;
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

  return (
    <Modal
      visible={visible}
      transparent={true}
      animationType="fade"
      onRequestClose={onCancel}
    >
      <View style={styles.overlay}>
        <View style={styles.card}>
          <Text style={styles.title}>New Ride Request</Text>

          <View style={styles.infoRow}>
            <User color="#333" size={20} />
            <View style={styles.infoContent}>
              <Text style={styles.label}>Passenger</Text>
              <Text style={styles.value}>{ride.userName}</Text>
            </View>
          </View>

          <View style={styles.infoRow}>
            <MapPin color="#00C853" size={20} />
            <View style={styles.infoContent}>
              <Text style={styles.label}>Pickup</Text>
              <Text style={styles.value}>{ride.pickup}</Text>
            </View>
          </View>

          <View style={styles.infoRow}>
            <Navigation color="#4285F4" size={20} />
            <View style={styles.infoContent}>
              <Text style={styles.label}>Destination</Text>
              <Text style={styles.value}>{ride.destination}</Text>
            </View>
          </View>

          <View style={styles.infoRow}>
            <DollarSign color="#FFB300" size={20} />
            <View style={styles.infoContent}>
              <Text style={styles.label}>Price</Text>
              <Text style={styles.priceValue}>£{ride.price}</Text>
            </View>
          </View>

          <View style={styles.buttonContainer}>
            <TouchableOpacity style={styles.rejectButton} onPress={onReject}>
              <Text style={styles.rejectText}>Reject</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.acceptButton} onPress={onAccept}>
              <Text style={styles.acceptText}>Accept</Text>
            </TouchableOpacity>
          </View>

          <TouchableOpacity style={styles.cancelButton} onPress={onCancel}>
            <Text style={styles.cancelText}>Cancel</Text>
          </TouchableOpacity>
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
    marginBottom: 24,
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
  cancelButton: {
    marginTop: 12,
    paddingVertical: 12,
    alignItems: 'center',
  },
  cancelText: {
    color: '#888',
    fontSize: 14,
    fontWeight: '600',
  },
});

