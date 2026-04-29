import { doc, getDoc, setDoc, updateDoc } from 'firebase/firestore';
import { db } from '../firebase';

export interface UserProfile {
  uid: string;
  email: string;
  customerNumber?: string;
  firstName?: string;
  lastName?: string;
  company?: string;
  street?: string;
  postalCode?: string;
  city?: string;
  phone?: string;
  country?: string;
  federalState?: string;
  createdAt: string;
  updatedAt: string;
}

class UserProfileService {
  private readonly COLLECTION = 'user_profiles';

  async createProfile(profile: UserProfile): Promise<void> {
    const docRef = doc(db, this.COLLECTION, profile.uid);
    // Filter out undefined values
    const cleanProfile = Object.fromEntries(
      Object.entries(profile).filter(([_, value]) => value !== undefined)
    );
    console.log('🔄 Creating user profile:', cleanProfile);
    await setDoc(docRef, cleanProfile);
    console.log('✅ User profile created successfully');
  }

  async getProfile(uid: string): Promise<UserProfile | null> {
    try {
      const docRef = doc(db, this.COLLECTION, uid);
      const docSnap = await getDoc(docRef);
      
      if (docSnap.exists()) {
        const data = docSnap.data() as UserProfile;
        console.log('📖 Retrieved user profile:', data);
        return data;
      }
      console.log('📖 No user profile found for uid:', uid);
      return null;
    } catch (error) {
      console.error('Error fetching user profile:', error);
      return null;
    }
  }

  async updateProfile(uid: string, updates: Partial<UserProfile>): Promise<void> {
    const docRef = doc(db, this.COLLECTION, uid);
    // Filter out undefined values
    const cleanUpdates = Object.fromEntries(
      Object.entries(updates).filter(([_, value]) => value !== undefined)
    );
    await updateDoc(docRef, {
      ...cleanUpdates,
      updatedAt: new Date().toISOString()
    });
  }

  async upsertProfile(profile: Partial<UserProfile> & { uid: string; email: string }): Promise<void> {
    const docRef = doc(db, this.COLLECTION, profile.uid);
    const now = new Date().toISOString();
    
    const existing = await this.getProfile(profile.uid);
    
    if (existing) {
      // Filter out undefined values for update
      const cleanUpdates = Object.fromEntries(
        Object.entries(profile).filter(([_, value]) => value !== undefined)
      );
      await updateDoc(docRef, {
        ...cleanUpdates,
        updatedAt: now
      });
    } else {
      // Filter out undefined values for create
      const cleanProfile = Object.fromEntries(
        Object.entries({
          ...profile,
          createdAt: now,
          updatedAt: now
        }).filter(([_, value]) => value !== undefined)
      );
      await setDoc(docRef, cleanProfile);
    }
  }
}

export const userProfileService = new UserProfileService();
