// Firestore Debug Utilities
import { doc, getDoc, collection, getDocs } from 'firebase/firestore';
import { db } from '../firebase';
import { auth } from '../firebase';

export const debugUserFirestoreData = async (uid?: string) => {
  const userId = uid || auth.currentUser?.uid;
  if (!userId) {
    console.log('❌ No user ID provided and no current user');
    return;
  }

  console.group(`🔍 Firestore Data Debug for User: ${userId}`);
  
  try {
    // Check user document
    const userDocRef = doc(db, 'users', userId);
    const userDocSnap = await getDoc(userDocRef);
    
    if (userDocSnap.exists()) {
      console.log('✅ User Document:', userDocSnap.data());
    } else {
      console.log('❌ No user document found');
    }

    // Check user collections
    const collections = ['projects', 'tracks', 'gps_points', 'samples', 'boundaries'];
    
    for (const collectionName of collections) {
      try {
        const collectionRef = collection(db, `users/${userId}/${collectionName}`);
        const snapshot = await getDocs(collectionRef);
        
        console.log(`📁 ${collectionName}:`, {
          count: snapshot.size,
          docs: snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }))
        });
      } catch (error) {
        console.error(`❌ Error reading ${collectionName}:`, error);
      }
    }

  } catch (error) {
    console.error('❌ Debug error:', error);
  }
  
  console.groupEnd();
};

// Quick function to run in browser console
declare global {
  interface Window {
    debugUserData: () => void;
  }
}

if (typeof window !== 'undefined') {
  window.debugUserData = () => debugUserFirestoreData();
}

export const logAllUsers = async () => {
  console.group('👥 All Users in Firestore');
  
  try {
    const usersRef = collection(db, 'users');
    const snapshot = await getDocs(usersRef);
    
    console.log(`Total users: ${snapshot.size}`);
    snapshot.docs.forEach(doc => {
      console.log(`User ${doc.id}:`, doc.data());
    });
    
  } catch (error) {
    console.error('❌ Error reading users:', error);
  }
  
  console.groupEnd();
};