import React from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Dimensions,
  Platform,
} from 'react-native';
import { User, MapPin, Navigation, Check } from 'lucide-react-native';

const { width } = Dimensions.get('window');

interface RideManagementPanelProps {
  rideStatus: 'accepted' | 'arrived' | 'started' | null;
  rideInfo: any;
  onArrived: () => void;
  onStartTrip: () => void;
  onCompleteTrip: () => void;
}

export default function RideManagementPanel({
  rideStatus,
  rideInfo,
  onArrived,
  onStartTrip,
  onCompleteTrip,
}: RideManagementPanelProps) {
  if (!rideStatus || !rideInfo) return null;

  const getButtonConfig = () => {
    switch (rideStatus) {
      case 'accepted':
        return {
          label: 'Arrived',
          onPress: onArrived,
          color: '#4285F4',
        };
      case 'arrived':
        return {
          label: 'Start Trip',
          onPress: onStartTrip,
          color: '#00C853',
        };
      case 'started':
        return {
          label: 'Complete Trip',
          onPress: onCompleteTrip,
          color: '#FFB300',
        };
      default:
        return null;
    }
  };

  const buttonConfig = getButtonConfig();
  if (!buttonConfig) return null;

  return (
    <View style={styles.container}>
      <View style={styles.panel}>
        <View style={styles.rideInfoSection}>
          <View style={styles.infoRow}>
            <User color="#fff" size={16} />
            <Text style={styles.infoText}>{rideInfo.clientName || rideInfo.userName || 'Client'}</Text>
          </View>

          <View style={styles.locationContainer}>
            <View style={styles.locationRow}>
              <MapPin color="#00C853" size={14} />
              <Text style={styles.locationText} numberOfLines={1}>
                {rideInfo.pickupAddress || rideInfo.pickup || 'Pickup'}
              </Text>
            </View>
            <View style={styles.locationRow}>
              <Navigation color="#4285F4" size={14} />
              <Text style={styles.locationText} numberOfLines={1}>
                {rideInfo.destinationAddress || rideInfo.destination || 'Destination'}
              </Text>
            </View>
          </View>

          <Text style={styles.priceText}>£{rideInfo.fare || rideInfo.price || 0}</Text>
        </View>

        <TouchableOpacity
          style={[styles.actionButton, { backgroundColor: buttonConfig.color }]}
          onPress={buttonConfig.onPress}
        >
          <Check color="#fff" size={20} />
          <Text style={styles.buttonText}>{buttonConfig.label}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: Platform.OS === 'ios' ? 50 : 40,
    left: 0,
    right: 0,
    zIndex: 100,
    paddingHorizontal: 16,
  },
  panel: {
    backgroundColor: '#2C2C2C',
    borderRadius: 16,
    padding: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 10,
  },
  rideInfoSection: {
    marginBottom: 12,
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  infoText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
    marginLeft: 8,
  },
  locationContainer: {
    marginTop: 8,
    marginBottom: 8,
  },
  locationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 6,
  },
  locationText: {
    color: '#E0E0E0',
    fontSize: 13,
    marginLeft: 8,
    flex: 1,
  },
  priceText: {
    color: '#FFB300',
    fontSize: 20,
    fontWeight: '700',
    textAlign: 'right',
  },
  actionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    borderRadius: 12,
    gap: 8,
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
  },
});

