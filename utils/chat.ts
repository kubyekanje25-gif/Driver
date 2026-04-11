import { ref, push, update, remove, onChildAdded, onValue, off, get } from 'firebase/database';
import { Database } from 'firebase/database';

export function sendDriverMessage(
  database: Database,
  rideId: string,
  driverId: string,
  driverName: string,
  text: string
): void {
  const messagesRef = ref(database, `rides/${rideId}/messages`);
  push(messagesRef, {
    sender: 'driver',
    senderName: driverName,
    text,
    timestamp: Date.now(),
  });
}

export function listenForClientMessages(
  database: Database,
  rideId: string,
  driverId: string,
  onNewMessage: (message: any, messageId: string) => void
): () => void {
  const messagesRef = ref(database, `rides/${rideId}/messages`);
  const processedMessages = new Set<string>();

  const callback = (snapshot: any) => {
    const message = snapshot.val();
    const key = snapshot.key;

    if (message && key && !processedMessages.has(key)) {
      processedMessages.add(key);

      if (message.sender === 'client') {
        onNewMessage(message, key);
      }
    }
  };

  onChildAdded(messagesRef, callback);

  return () => {
    off(messagesRef, 'child_added', callback);
  };
}

export function autoDeleteReadMessages(
  database: Database,
  rideId: string,
  clientId: string,
  driverId: string
): () => void {
  return () => {};
}

export function watchRideStatusForCleanup(
  database: Database,
  rideId: string
): () => void {
  const rideRef = ref(database, `rides/${rideId}`);

  const callback = (snap: any) => {
    const ride = snap.val();
    if (ride?.status === 'completed') {
      remove(ref(database, `rides/${rideId}/messages`));
    }
  };

  onValue(rideRef, callback);

  return () => {
    off(rideRef, 'value', callback);
  };
}

export function getAllMessages(
  database: Database,
  rideId: string,
  callback: (messages: Array<{ id: string; data: any }>) => void
): () => void {
  const messagesRef = ref(database, `rides/${rideId}/messages`);

  const listener = (snapshot: any) => {
    const messages: Array<{ id: string; data: any }> = [];
    snapshot.forEach((child: any) => {
      const msgData = child.val();
      messages.push({
        id: child.key || '',
        data: msgData,
      });
    });
    messages.sort((a, b) => a.data.timestamp - b.data.timestamp);
    callback(messages);
  };

  onValue(messagesRef, listener);

  return () => {
    off(messagesRef, 'value', listener);
  };
}

export function markMessagesAsSeen(
  database: Database,
  rideId: string
): void {
  const seenRef = ref(database, `rides/${rideId}/messagesSeen`);
  update(seenRef, {
    driverSeen: true,
    lastSeenAt: Date.now(),
  });
}

export function getUnreadCount(
  database: Database,
  rideId: string,
  driverId: string,
  callback: (count: number) => void
): () => void {
  const messagesRef = ref(database, `rides/${rideId}/messages`);
  const seenRef = ref(database, `rides/${rideId}/messagesSeen`);

  let lastSeenTimestamp = 0;
  let messagesSnapshot: any = null;

  const seenListener = (snapshot: any) => {
    const seenData = snapshot.val();
    if (seenData?.driverSeen) {
      lastSeenTimestamp = seenData.lastSeenAt || 0;
    }
    calculateUnreadCount();
  };

  const messagesListener = (snapshot: any) => {
    messagesSnapshot = snapshot;
    calculateUnreadCount();
  };

  const calculateUnreadCount = () => {
    if (!messagesSnapshot) {
      callback(0);
      return;
    }

    let unreadCount = 0;
    messagesSnapshot.forEach((child: any) => {
      const msg = child.val();
      if (msg?.sender === 'client' && msg?.timestamp > lastSeenTimestamp) {
        unreadCount++;
      }
    });
    callback(unreadCount);
  };

  onValue(seenRef, seenListener);
  onValue(messagesRef, messagesListener);

  return () => {
    off(seenRef, 'value', seenListener);
    off(messagesRef, 'value', messagesListener);
  };
}