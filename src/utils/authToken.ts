import { auth } from '../context/AuthContext';

// Fetch a fresh Firebase ID token; falls back to currentUser?.getIdToken if available
export const getFirebaseIdToken = async (): Promise<string | null> => {
  try {
    const user = auth.currentUser;
    if (!user) return null;
    return await user.getIdToken(true);
  } catch (error) {
    console.warn('Failed to fetch Firebase ID token:', error);
    return null;
  }
};
