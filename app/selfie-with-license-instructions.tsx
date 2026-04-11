 import React from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Platform,
  Alert,
  Image,
} from 'react-native';
import { useState } from 'react';
import { router } from 'expo-router';
import { ArrowLeft } from 'lucide-react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useRegistration } from '@/context/RegistrationContext';
import { database, auth } from '@/config/firebase';
import { ref, update } from 'firebase/database';

export default function SelfieWithLicenseInstructionsPage() {
  const { registrationData, updateLicense } = useRegistration();
  const [showCamera, setShowCamera] = useState(false);
  const [capturedImage, setCapturedImage] = useState<string | null>(null);
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const [cameraRef, setCameraRef] = useState<CameraView | null>(null);

  const handleTakeSelfie = async () => {
    if (!cameraPermission?.granted) {
      const { status } = await requestCameraPermission();
      if (status !== 'granted') {
        Alert.alert('Permission Required', 'Camera permission is required to take selfies.');
        return;
      }
    }
    setShowCamera(true);
  };

  const takePicture = async () => {
    if (cameraRef) {
      try {
        const photo = await cameraRef.takePictureAsync();
        if (photo?.uri) {
          setCapturedImage(photo.uri);
          setShowCamera(false);
        }
      } catch (error) {
        console.error('Error taking selfie:', error);
        Alert.alert('Error', 'Failed to take selfie. Please try again.');
      }
    }
  };

  const handleRetry = () => {
    setCapturedImage(null);
    setShowCamera(true);
  };

  const handleSave = async () => {
    if (capturedImage) {
      updateLicense({
        ...registrationData.license,
        selfieWithLicense: capturedImage,
      });

      const uid = auth.currentUser?.uid || registrationData.uid;
      if (uid) {
        try {
          await update(ref(database, `users/${uid}/license`), {
            selfieWithLicense: '',
          });
        } catch (error) {
          console.error('Error updating Firebase:', error);
        }
      }

      router.back();
    }
  };

  if (capturedImage) {
    return (
      <View style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => setCapturedImage(null)}>
            <ArrowLeft color="#fff" size={28} />
          </TouchableOpacity>
          <Text style={styles.headerText}>Preview</Text>
          <View style={{ width: 28 }} />
        </View>

        <View style={styles.previewContainer}>
          <Image source={{ uri: capturedImage }} style={styles.previewImage} />
        </View>

        <View style={styles.previewActions}>
          <TouchableOpacity style={styles.retryButton} onPress={handleRetry}>
            <Text style={styles.retryButtonText}>Retry</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.saveButton} onPress={handleSave}>
            <Text style={styles.saveButtonText}>Save</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  if (showCamera) {
    return (
      <View style={styles.cameraContainer}>
        <CameraView
          style={styles.camera}
          ref={(ref) => setCameraRef(ref)}
          facing="front"
        >
          <View style={styles.cameraControls}>
            <TouchableOpacity
              style={styles.closeButton}
              onPress={() => setShowCamera(false)}
            >
              <ArrowLeft color="#fff" size={28} />
            </TouchableOpacity>

            <TouchableOpacity style={styles.captureButton} onPress={takePicture}>
              <View style={styles.captureButtonInner} />
            </TouchableOpacity>
          </View>
        </CameraView>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()}>
          <ArrowLeft color="#fff" size={28} />
        </TouchableOpacity>
        <Text style={styles.headerText}>Driver license</Text>
        <View style={{ width: 28 }} />
      </View>

      <View style={styles.content}>
        <Text style={styles.title}>Driver license</Text>

        <View style={styles.instructionsContainer}>
          <View style={styles.instructionItem}>
            <Text style={styles.checkmark}>✓</Text>
            <Text style={styles.instructionText}>
              Take a picture with your original driver license.
            </Text>
          </View>
          <View style={styles.instructionItem}>
            <Text style={styles.checkmark}>✓</Text>
            <Text style={styles.instructionText}>
              Please don't use screenshots, copies, or printed photos.
            </Text>
          </View>
          <View style={styles.instructionItem}>
            <Text style={styles.checkmark}>✓</Text>
            <Text style={styles.instructionText}>
              No filters, your face and all the details must be clearly visible
            </Text>
          </View>
        </View>

        <View style={styles.illustrationContainer}>
          <View style={styles.illustrationBox}>
            <Text style={styles.illustrationText}>🤳</Text>
          </View>
        </View>
      </View>

      <View style={styles.footer}>
        <TouchableOpacity style={styles.primaryButton} onPress={handleTakeSelfie}>
          <Text style={styles.primaryButtonText}>Take a selfie</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  // original styles preserved
  container: { flex: 1, backgroundColor: '#1a1a1a' },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 20, paddingTop: Platform.OS === 'ios' ? 60 : 40, paddingBottom: 20 },
  headerText: { color: '#fff', fontSize: 18, fontWeight: '600' },
  content: { flex: 1, paddingHorizontal: 24, paddingTop: 20 },
  title: { fontSize: 32, fontWeight: 'bold', color: '#fff', marginBottom: 32 },
  instructionsContainer: { marginBottom: 40 },
  instructionItem: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 20, paddingHorizontal: 8 },
  checkmark: { fontSize: 20, color: '#B19CD9', marginRight: 12, marginTop: 2 },
  instructionText: { flex: 1, fontSize: 16, color: '#fff', lineHeight: 24, flexWrap: 'wrap' },
  illustrationContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  illustrationBox: { width: 160, height: 160, backgroundColor: '#B19CD9', borderRadius: 20,
    justifyContent: 'center', alignItems: 'center' },
  illustrationText: { fontSize: 80 },
  footer: { paddingHorizontal: 24, paddingBottom: Platform.OS === 'ios' ? 30 : 20, paddingTop: 8 },
  primaryButton: { backgroundColor: '#B19CD9', borderRadius: 12, padding: 18, alignItems: 'center' },
  primaryButtonText: { fontSize: 18, fontWeight: '600', color: '#000' },
  cameraContainer: { flex: 1, backgroundColor: '#000' },
  camera: { flex: 1 },
  cameraControls: { flex: 1, justifyContent: 'space-between',
    paddingTop: Platform.OS === 'ios' ? 60 : 40, paddingBottom: 40, paddingHorizontal: 20 },
  closeButton: { alignSelf: 'flex-start' },
  captureButton: { width: 80, height: 80, borderRadius: 40, backgroundColor: 'rgba(255, 255, 255, 0.3)',
    justifyContent: 'center', alignItems: 'center', alignSelf: 'center' },
  captureButtonInner: { width: 64, height: 64, borderRadius: 32, backgroundColor: '#fff' },
  previewContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 24 },
  previewImage: { width: '100%', height: '70%', borderRadius: 16, resizeMode: 'contain' },
  previewActions: { flexDirection: 'row', paddingHorizontal: 24, paddingBottom: Platform.OS === 'ios' ? 30 : 20, gap: 12 },
  retryButton: { flex: 1, backgroundColor: '#3a3a3a', borderRadius: 12, padding: 18, alignItems: 'center' },
  retryButtonText: { fontSize: 18, fontWeight: '600', color: '#fff' },
  saveButton: { flex: 1, backgroundColor: '#B19CD9', borderRadius: 12, padding: 18, alignItems: 'center' },
  saveButtonText: { fontSize: 18, fontWeight: '600', color: '#000' },
});

