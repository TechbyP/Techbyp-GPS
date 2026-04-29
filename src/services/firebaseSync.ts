import { 
  collection, 
  addDoc, 
  updateDoc, 
  deleteDoc, 
  doc, 
  getDocs, 
  getDoc,
  query, 
  where,
  orderBy,
  Timestamp,
  writeBatch,
  setDoc,
  limit,
  serverTimestamp,
  onSnapshot
} from 'firebase/firestore';
import { db, auth } from '../firebase';
import { environmentConfig } from '../config/environment';
import { TIMEOUTS, withTimeout } from '../config/timeouts';
import { normalizeGeometry, serializeGeometryForFirestore, deserializeGeometryFromFirestore, simplifyGeometryForStorage } from '../utils/geometryUtils';
import { normalizeBoundaryRenderMeta } from '../utils/boundaryRenderMeta';

// Per-user subcollections under users/{uid}/
const getCollectionPath = (uid: string, collectionName: string) => 
  `users/${uid}/${collectionName}`;

const authError = (code: string, message: string, extras?: Record<string, any>) => {
  return Object.assign(new Error(message), { code, ...extras });
};

const ensureAuthForUid = async (uid: string) => {
  const current = auth.currentUser;
  if (!current) {
    throw authError('auth/not-authenticated', 'Firebase user not authenticated');
  }
  if (current.uid !== uid) {
    // Check if current user is admin - admins can access any user's data
    console.log('[Firebase] Auth UID mismatch - checking admin status. Current:', current.uid, 'Requested:', uid);
    try {
      const tokenResult = await current.getIdTokenResult();
      const claimRole = typeof tokenResult.claims.role === 'string'
        ? tokenResult.claims.role.toLowerCase()
        : '';
      let isAdmin = tokenResult.claims.admin === true || claimRole === 'admin';
      
      console.log('[Firebase] Token claims:', { admin: tokenResult.claims.admin, role: tokenResult.claims.role });

      // Fallback for deployments that mark admin in users/{uid}.role but do not use custom token claims.
      if (!isAdmin) {
        const userDoc = await getDoc(doc(db, 'users', current.uid));
        const firestoreRole = userDoc.exists()
          ? String((userDoc.data() as any).role || '').toLowerCase()
          : '';
        isAdmin = firestoreRole === 'admin';
        console.log('[Firebase] Firestore role fallback:', firestoreRole || 'none');
      }
      
      if (!isAdmin) {
        console.error('[Firebase] User is not admin, blocking access to other user data');
        throw authError('auth/mismatch', `Authenticated as ${current.uid} but requested ${uid}`, {
          currentUid: current.uid,
          requestedUid: uid
        });
      }
      // Admin user - allow access to other users' data
      console.log('[Firebase] ✅ Admin user confirmed - allowing access to user:', uid);
    } catch (claimError: any) {
      // If we can't read claims, assume not admin and throw mismatch error
      if (claimError.code === 'auth/mismatch') {
        throw claimError;
      }
      console.error('[Firebase] Error reading token claims:', claimError);
      throw authError('auth/mismatch', `Authenticated as ${current.uid} but requested ${uid}`, {
        currentUid: current.uid,
        requestedUid: uid
      });
    }
  }
};

/**
 * Extract timestamp value from either Firestore timestamp object, plain number, or ISO string
 * Handles { toMillis: () => number }, plain number, and ISO string formats
 */
const getTimestampValue = (timestamp: any): number => {
  if (!timestamp) return 0;
  if (typeof timestamp === 'number') return timestamp;
  if (typeof timestamp === 'string') return new Date(timestamp).getTime();
  if (timestamp.toMillis && typeof timestamp.toMillis === 'function') return timestamp.toMillis();
  return 0;
};

/**
 * Convert Firestore data to app-friendly format
 * - Converts Timestamps to ISO strings
 * - Handles nested objects if necessary
 */
const convertFirestoreData = (data: any): any => {
  if (!data) return data;
  const result = { ...data };
  
  // Fields that might contain timestamps
  const timestampFields = ['created_at', 'updated_at', 'timestamp', 'synced_at', 'lastActive', 'createdAt', 'lab_exported_at'];
  
  timestampFields.forEach(field => {
    if (result[field]) {
      // Handle Firestore Timestamp
      if (typeof result[field].toDate === 'function') {
        result[field] = result[field].toDate().toISOString();
      } 
      // Handle serialized Timestamp (e.g. from cache)
      else if (result[field].seconds !== undefined && result[field].nanoseconds !== undefined) {
        result[field] = new Date(result[field].seconds * 1000).toISOString();
      }
      // Handle number (legacy)
      else if (typeof result[field] === 'number') {
        result[field] = new Date(result[field]).toISOString();
      }
    }
  });
  
  return result;
};

// Firestore does not allow nested arrays, so render_meta.lod coordinates
// cannot be stored directly. Persist only lightweight summary fields.
const toFirestoreRenderMeta = (meta: any) => {
  if (!meta || typeof meta !== 'object') return null;

  const safeMeta: any = {
    bbox: Array.isArray(meta.bbox) ? meta.bbox.slice(0, 4) : undefined,
    centroid: meta.centroid === null
      ? null
      : (Array.isArray(meta.centroid) ? meta.centroid.slice(0, 2) : undefined),
    point_count: Number.isFinite(meta.point_count) ? Math.floor(meta.point_count) : undefined,
    schema_version: Number.isFinite(meta.schema_version) ? Math.floor(meta.schema_version) : 1,
    updated_at: typeof meta.updated_at === 'string' ? meta.updated_at : new Date().toISOString()
  };

  Object.keys(safeMeta).forEach((key) => {
    if (safeMeta[key] === undefined) {
      delete safeMeta[key];
    }
  });

  return Object.keys(safeMeta).length > 0 ? safeMeta : null;
};

const findFirestoreNestedArrayPaths = (value: any, basePath = '', maxPaths = 20): string[] => {
  const paths: string[] = [];

  const walk = (node: any, path: string) => {
    if (paths.length >= maxPaths || node === null || node === undefined) {
      return;
    }

    if (Array.isArray(node)) {
      for (let index = 0; index < node.length; index += 1) {
        const child = node[index];
        const childPath = path ? `${path}[${index}]` : `[${index}]`;

        if (Array.isArray(child)) {
          paths.push(childPath);
          if (paths.length >= maxPaths) {
            return;
          }
        }

        walk(child, childPath);
      }
      return;
    }

    if (typeof node === 'object') {
      Object.entries(node).forEach(([key, child]) => {
        if (paths.length >= maxPaths) {
          return;
        }
        const childPath = path ? `${path}.${key}` : key;
        walk(child, childPath);
      });
    }
  };

  walk(value, basePath);
  return paths;
};

// ==================== Users ====================

export const firebaseGPS = {
  // Lightweight connectivity probe that does not require auth
  async ping() {
    const start = Date.now();
    try {
      // Use analytics collection because it is publicly readable per rules
      const q = query(collection(db, 'analytics'), limit(1));
      await withTimeout(
        getDocs(q),
        TIMEOUTS.FIREBASE_PING,
        'Firebase ping timeout'
      );
      return { success: true, duration: Date.now() - start };
    } catch (error: any) {
      // Permission denied still proves Firestore is reachable; treat as success for connectivity
      if (error?.code === 'permission-denied') {
        return {
          success: true,
          duration: Date.now() - start,
          unauthorized: true,
        };
      }

      return {
        success: false,
        duration: Date.now() - start,
        error: error?.message || 'Unknown ping error'
      };
    }
  },

  // Helper: wait for Firebase auth to be ready
  async waitForAuth(expectedUid: string, timeoutMs: number = 5000): Promise<boolean> {
    const startTime = Date.now();
    
    while (Date.now() - startTime < timeoutMs) {
      if (auth.currentUser && auth.currentUser.uid === expectedUid) {
        return true;
      }
      
      // Wait 100ms before checking again
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    console.error('[Firebase] Auth timeout after', timeoutMs + 'ms. Current:', auth.currentUser?.uid, 'Expected:', expectedUid);
    return false;
  },

  // Helper: retry with exponential backoff for Firestore operations
  async withRetry<T>(fn: () => Promise<T>, attempts = 3, baseDelayMs = 500): Promise<T> {
    let lastErr: any;
    for (let i = 0; i < attempts; i++) {
      try {
        return await fn();
      } catch (err: any) {
        lastErr = err;
        const isTransient = (
          err?.code === 'unavailable' ||
          err?.code === 'deadline-exceeded' ||
          err?.message?.includes('timeout')
        );
        if (!isTransient || i === attempts - 1) break;
        const delay = baseDelayMs * Math.pow(2, i);
        environmentConfig.log('Firebase', `Retrying Firestore op (attempt ${i + 2}/${attempts}) in ${delay}ms`);
        await new Promise(res => setTimeout(res, delay));
      }
    }
    throw lastErr;
  },
  // Test Firebase connectivity
  async testConnection(uid: string) {
    const startTime = Date.now();
    try {
      // Try a simple Firestore operation
      const testDoc = doc(db, `users/${uid}`);
      await withTimeout(
        getDoc(testDoc),
        TIMEOUTS.HEALTH_CHECK,
        'Connection test timeout'
      );
      
      const duration = Date.now() - startTime;
      return { success: true, duration };
    } catch (error: any) {
      const duration = Date.now() - startTime;
      console.warn('[Firebase] Connection test issue:', error.message);
      return { success: false, duration, error: error.message };
    }
  },

  // User Management
  async createUserDocument(uid: string, email: string, displayName?: string) {
    try {
      const userDocRef = doc(db, 'users', uid);
      await this.withRetry(() => setDoc(userDocRef, {
        email,
        displayName: displayName || '',
        createdAt: serverTimestamp(),
        lastActive: serverTimestamp(),
        settings: {
          theme: 'light',
          language: 'en'
        }
      }, { merge: true })); // Use merge to avoid overwriting existing data
      console.log('✅ User document created/updated:', email);
      return uid;
    } catch (error) {
      console.error('Error creating user document in Firebase:', error);
      throw error;
    }
  },

  // Auto-ensure user document exists
  async ensureUserDocument(uid: string, email?: string, displayName?: string) {
    if (!environmentConfig.shouldRunFirebaseConnectionTests()) {
      // In development we skip doc creation checks to avoid noisy timeouts
      return;
    }
    try {
      const userDocRef = doc(db, 'users', uid);
      
      // Add timeout to prevent hanging
      const docSnap = await Promise.race([
        getDoc(userDocRef),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('User doc check timeout')), 12000)
        )
      ] as any);
      
      if (!docSnap.exists()) {
        await this.createUserDocument(uid, email || 'unknown@example.com', displayName);
      } else {
        // Update last active
        await this.updateUserLastActive(uid);
      }
    } catch (error) {
      if ((error as any)?.message?.includes('timeout')) {
        console.warn('[Firebase] ensureUserDocument timed out (non-critical)');
      } else {
        console.error('Error ensuring user document:', error);
      }
      // Don't throw - this is not critical
    }
  },

  async updateUserLastActive(uid: string) {
    try {
      const userDocRef = doc(db, 'users', uid);
      await this.withRetry(() => updateDoc(userDocRef, {
        lastActive: serverTimestamp()
      }));
    } catch (error) {
      console.error('Error updating user last active:', error);
      // Don't throw - this is not critical
    }
  },
  
  async getUserDocument(uid: string) {
    try {
      const userDocRef = doc(db, 'users', uid);
      const userDoc = await getDoc(userDocRef);
      if (userDoc.exists()) {
        return userDoc.data();
      }
      return null;
    } catch (error) {
      console.error('Error fetching user document:', error);
      return null;
    }
  },
  
  async updateUserRole(uid: string, role: string) {
    try {
      const userDocRef = doc(db, 'users', uid);
      await this.withRetry(() => updateDoc(userDocRef, {
        role,
        updated_at: serverTimestamp()
      }));
    } catch (error) {
      console.error('Error updating user role:', error);
      throw error;
    }
  },
  
  async updateUserOrganization(uid: string, organizationId: string) {
    try {
      const userDocRef = doc(db, 'users', uid);
      await this.withRetry(() => updateDoc(userDocRef, {
        organization_id: organizationId,
        updated_at: serverTimestamp()
      }));
    } catch (error) {
      console.error('Error updating user organization:', error);
      throw error;
    }
  },

  // Projects
  async createProject(uid: string, name: string, description?: string, clientId?: string) {
    try {
      // Preserve offline/local IDs by allowing caller-provided doc IDs
      if (clientId) {
        const docRef = doc(db, getCollectionPath(uid, 'projects'), clientId);
        await this.withRetry(() => setDoc(docRef, {
          name,
          description: description || '',
          created_at: serverTimestamp(),
          updated_at: serverTimestamp()
        }, { merge: true }));
        return docRef.id;
      }

      const docRef = await this.withRetry(() => addDoc(
        collection(db, getCollectionPath(uid, 'projects')), 
        {
          name,
          description: description || '',
          created_at: serverTimestamp(),
          updated_at: serverTimestamp()
        }
      ));
      return docRef.id;
    } catch (error) {
      console.error('Error creating project in Firebase:', error);
      throw error;
    }
  },

  async getProjects(uid: string, retryAttempt = 0): Promise<any[]> {
    
    // CRITICAL: Wait for auth to be ready (tablet timing issue - increased from 5s to 15s for tablets)
    const authWaitTime = retryAttempt === 0 ? 15000 : 5000; // Longer wait on first attempt
    if (!auth.currentUser) {
      console.warn(`[Firebase] Auth not ready yet, waiting up to ${authWaitTime}ms...`);
      const authReady = await this.waitForAuth(uid, authWaitTime);
      if (!authReady) {
        console.error('[Firebase] Auth timeout - cannot fetch projects without authentication');
        if (retryAttempt < 2) {
          console.log('[Firebase] Retrying getProjects after auth failure...');
          await new Promise(resolve => setTimeout(resolve, 2000)); // 2s wait before retry
          return this.getProjects(uid, retryAttempt + 1);
        }
        throw new Error('Authentication required to fetch projects. Please wait for login to complete.');
      }
    }
    
    // Check authentication status
    
    // Fail fast on auth mismatch or missing auth to surface to UI
    await ensureAuthForUid(uid);

    // Ensure user document exists - but don't block if it's slow
    this.ensureUserDocument(uid, auth.currentUser?.email || undefined, auth.currentUser?.displayName || undefined)
      .catch(err => console.warn('[Firebase] ensureUserDocument failed (non-critical):', err.message));
    
    try {
      // Building Firebase projects query - logging suppressed to reduce console spam
      const collectionPath = getCollectionPath(uid, 'projects');
      
      // Fetch projects directly without pagination for now
      const q = query(
        collection(db, collectionPath)
      );
      const startTime = Date.now();
      
      // Add timeout logging
      const timeoutTracker = setTimeout(() => {
        const elapsed = Date.now() - startTime;
        console.warn('[Firebase] Query taking longer than expected:', elapsed + 'ms');
      }, 4000); // Warn if taking more than 4 seconds

      // Increased timeout to 30s for slow networks or initial connection
      const snapshot = await Promise.race([
        getDocs(q),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Projects query timeout after 30s')), 30000))
      ]) as any;
      clearTimeout(timeoutTracker);
      
      const duration = Date.now() - startTime;
      // Firebase snapshot received - logging suppressed to reduce console spam
      const projects = snapshot.docs.map((doc: any) => ({ id: doc.id, ...convertFirestoreData(doc.data()) }));

      // Sort newest-first so UI shows recently active projects on top
      projects.sort((a: any, b: any) => {
        const aTime = getTimestampValue(a.updated_at) || getTimestampValue(a.created_at);
        const bTime = getTimestampValue(b.updated_at) || getTimestampValue(b.created_at);
        return bTime - aTime; // descending order
      });

      // Projects mapped and sorted
      return projects;
    } catch (error: any) {
      console.error('[Firebase] Error getting projects (attempt ' + (retryAttempt + 1) + '):', error);
      console.error('[Firebase] Error details:', {
        message: error.message,
        code: error.code,
        stack: error.stack
      });
      console.error('[Firebase] Network status:', navigator.onLine ? 'ONLINE' : 'OFFLINE');
      console.error('[Firebase] Auth status:', auth.currentUser ? 'AUTHENTICATED' : 'NOT AUTHENTICATED');
      console.error('[Firebase] Current user UID:', auth.currentUser?.uid);
      console.error('[Firebase] Current user email:', auth.currentUser?.email);
      console.error('[Firebase] Target user UID:', uid);
      console.error('[Firebase] Collection path attempted:', getCollectionPath(uid, 'projects'));
      
      // Check token claims if permission denied
      if (error.code === 'permission-denied' && auth.currentUser) {
        try {
          const tokenResult = await auth.currentUser.getIdTokenResult();
          console.error('[Firebase] Token claims:', tokenResult.claims);
          console.error('[Firebase] Admin claim:', tokenResult.claims.admin ? 'YES' : 'NO');
          console.error('[Firebase] Token issued at:', new Date(tokenResult.issuedAtTime).toISOString());
        } catch (claimError) {
          console.error('[Firebase] Could not read token claims:', claimError);
        }
      }
      
      // CRITICAL FIX: Retry with exponential backoff instead of silently returning empty
      if (retryAttempt < 2) {
        const isRetriable = error?.code === 'unavailable' || 
                            error?.code === 'deadline-exceeded' || 
                            error?.message?.includes('timeout') ||
                            error?.message?.includes('offline');
        
        if (isRetriable || navigator.onLine) {
          const backoffMs = 2000 * Math.pow(2, retryAttempt); // 2s, 4s, 8s
          console.log(`[Firebase] Retriable error detected, retrying after ${backoffMs}ms...`);
          await new Promise(resolve => setTimeout(resolve, backoffMs));
          return this.getProjects(uid, retryAttempt + 1);
        }
      }
      
      // Return empty array so app can fall back to local cache only if all retries exhausted
      console.warn(`[Firebase] All retry attempts exhausted, returning empty array for local fallback`);
      return [];
    }
  },

  async updateProject(uid: string, projectId: string, name: string, description?: string) {
    try {
      const projectRef = doc(db, getCollectionPath(uid, 'projects'), projectId);
      await this.withRetry(() => updateDoc(projectRef, {
        name,
        description: description ?? '',
        updated_at: serverTimestamp()
      }));
    } catch (error) {
      console.error('Error updating project in Firebase:', error);
      throw error;
    }
  },

  async deleteProject(uid: string, projectId: string) {
    try {
      // Get all child data
      const [tracks, boundaries, fieldSamples] = await Promise.all([
        this.getTracks(uid, projectId),
        this.getFieldBoundaries(uid, projectId),
        this.getFieldSamples(uid, projectId)
      ]);
      
      // Delete all tracks and their children (GPS points and samples)
      for (const track of tracks) {
        await this.deleteTrack(uid, track.id);
      }
      
      // Delete all boundaries
      for (const boundary of boundaries) {
        await this.deleteFieldBoundary(uid, boundary.id);
      }

      // Delete dedicated field samples (Option B model)
      for (const sample of fieldSamples) {
        await this.deleteFieldSample(uid, sample.id);
      }
      
      // Finally delete project
      await this.withRetry(() => deleteDoc(doc(db, getCollectionPath(uid, 'projects'), projectId)));
    } catch (error) {
      console.error('Error deleting project cascade from Firebase:', error);
      throw error;
    }
  },

  // Tracks
  async createTrack(uid: string, projectId: string, name: string, fieldBoundaryId?: string, clientId?: string) {
    try {
      if (clientId) {
        const docRef = doc(db, getCollectionPath(uid, 'tracks'), clientId);
        await this.withRetry(() => setDoc(docRef, {
          project_id: projectId,
          name,
          field_boundary_id: fieldBoundaryId || null,
          created_at: Timestamp.now()
        }, { merge: true }));
        return docRef.id;
      }

      const docRef = await addDoc(
        collection(db, getCollectionPath(uid, 'tracks')),
        {
          project_id: projectId,
          name,
          field_boundary_id: fieldBoundaryId || null,
          created_at: Timestamp.now()
        }
      );
      return docRef.id;
    } catch (error) {
      console.error('Error creating track in Firebase:', error);
      throw error;
    }
  },

  async getTracks(uid: string, projectId: string) {
    console.log('[Firebase] getTracks called for project:', projectId);
    try {
      const q = query(
        collection(db, getCollectionPath(uid, 'tracks')),
        where('project_id', '==', projectId)
      );
      const snapshot = await getDocs(q);
      const tracks = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      
      // CRITICAL FIX: Fetch GPS points and samples for each track
      // This ensures PC sees all samples created on tablet
      const hydratedTracks = await Promise.all(
        tracks.map(async (track: any) => {
          try {
            const [points, samples] = await Promise.all([
              this.getGpsPoints(uid, track.id),
              this.getSamples(uid, track.id)
            ]);
            return {
              ...track,
              gps_points: points || [],
              samples: samples || []
            };
          } catch (error) {
            console.warn(`[Firebase] Failed to load children for track ${track.id}:`, error);
            return {
              ...track,
              gps_points: [],
              samples: []
            };
          }
        })
      );
      
      hydratedTracks.sort((a: any, b: any) => {
        const aTime = a.updated_at?.toMillis?.() || a.created_at?.toMillis?.() || 0;
        const bTime = b.updated_at?.toMillis?.() || b.created_at?.toMillis?.() || 0;
        return bTime - aTime;
      });
      
      return hydratedTracks;
    } catch (error: any) {
      console.error('[Firebase] Error getting tracks:', {
        error: error.message,
        code: error.code
      });
      return [];
    }
  },

  async deleteTrack(uid: string, trackId: string) {
    try {
      
      // Use Firestore batch for atomic delete
      const batch = writeBatch(db);
      
      // Get all GPS points
      const pointsQuery = query(
        collection(db, getCollectionPath(uid, 'gps_points')),
        where('track_id', '==', trackId)
      );
      const pointsSnapshot = await getDocs(pointsQuery);
      console.log(`[Firebase] Deleting ${pointsSnapshot.docs.length} GPS points`);
      pointsSnapshot.docs.forEach(doc => batch.delete(doc.ref));
      
      // Get all samples
      const samplesQuery = query(
        collection(db, getCollectionPath(uid, 'samples')),
        where('track_id', '==', trackId)
      );
      const samplesSnapshot = await getDocs(samplesQuery);
      samplesSnapshot.docs.forEach(doc => batch.delete(doc.ref));
      
      // Delete track
      batch.delete(doc(db, getCollectionPath(uid, 'tracks'), trackId));
      
      // Commit batch
      await batch.commit();
    } catch (error) {
      console.error('Error deleting track cascade from Firebase:', error);
      throw error;
    }
  },

  async updateTrack(uid: string, trackId: string, updates: { name?: string; field_boundary_id?: string | null; color?: string }) {
    try {
      const trackRef = doc(db, getCollectionPath(uid, 'tracks'), trackId);
      const updateData: any = { updated_at: Timestamp.now() };
      
      if (updates.name !== undefined) updateData.name = updates.name;
      if (updates.field_boundary_id !== undefined) updateData.field_boundary_id = updates.field_boundary_id;
      if (updates.color !== undefined) updateData.color = updates.color;
      
      await updateDoc(trackRef, updateData);
    } catch (error) {
      console.error('Error updating track in Firebase:', error);
      throw error;
    }
  },

  async getTrackById(uid: string, trackId: string) {
    try {
      const ref = doc(db, getCollectionPath(uid, 'tracks'), trackId);
      const snap = await getDoc(ref);
      if (!snap.exists()) return null;
      return { id: snap.id, ...snap.data() } as any;
    } catch (error) {
      console.error('Error getting track by id from Firebase:', error);
      return null;
    }
  },

  // GPS Points (batch operations for performance)
  async addGpsPoints(uid: string, points: Array<{
    id?: string;
    track_id: string;
    latitude: number;
    longitude: number;
    altitude?: number;
    accuracy?: number;
    timestamp?: string;
  }>) {
    try {
      // Sanitize points to avoid undefined fields (Firestore rejects undefined)
      const sanitized = points.map((point) => {
        const copy: any = {
          // Preserve client-provided IDs to prevent duplicate points after sync
          ...(point.id ? { id: point.id } : {}),
          track_id: point.track_id,
          latitude: point.latitude,
          longitude: point.longitude,
          timestamp: point.timestamp || new Date().toISOString(),
        };

        if (typeof point.altitude === 'number') {
          copy.altitude = point.altitude;
        }
        if (typeof point.accuracy === 'number') {
          copy.accuracy = point.accuracy;
        }
        return copy;
      });

      // ✅ ISSUE #11 FIX: Split into batches to avoid Firestore 500 operation limit
      const BATCH_SIZE = 450; // Keep under 500 limit with safety margin
      const batches: any[][] = [];
      
      for (let i = 0; i < sanitized.length; i += BATCH_SIZE) {
        batches.push(sanitized.slice(i, i + BATCH_SIZE));
      }
      
      console.log(`[Firebase] Splitting ${sanitized.length} points into ${batches.length} batch(es)`);
      
      const collectionRef = collection(db, getCollectionPath(uid, 'gps_points'));
      
      // Process batches sequentially to avoid overwhelming Firestore
      for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
        const batch = writeBatch(db);
        const batchPoints = batches[batchIndex];
        
        batchPoints.forEach(point => {
          const docRef = point.id ? doc(collectionRef, point.id) : doc(collectionRef);
          batch.set(docRef, {
            ...point,
            synced_at: Timestamp.now()
          });
        });

        await batch.commit();
      }

      return true;
    } catch (error) {
      console.error('Error adding GPS points to Firebase:', error);
      throw error;
    }
  },

  async getGpsPoints(uid: string, trackId: string) {
    try {
      const baseCollection = collection(db, getCollectionPath(uid, 'gps_points'));
      try {
        const q = query(
          baseCollection,
          where('track_id', '==', trackId),
          orderBy('timestamp', 'asc')
        );
        const snapshot = await getDocs(q);
        return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      } catch (indexErr: any) {
        // Fallback without orderBy if Firestore index is missing
        if (indexErr?.code === 'failed-precondition' || indexErr?.message?.includes('index')) {
          console.warn('[Firebase] Missing index for gps_points; retrying without orderBy', {
            trackId,
            message: indexErr?.message
          });
          const qNoOrder = query(
            baseCollection,
            where('track_id', '==', trackId)
          );
          const snapshot = await getDocs(qNoOrder);
          // Sort on client to keep rendering stable
          const docs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
          docs.sort((a: any, b: any) => {
            const ta = a.timestamp?.toMillis?.() || a.timestamp || 0;
            const tb = b.timestamp?.toMillis?.() || b.timestamp || 0;
            return ta - tb;
          });
          return docs;
        }
        throw indexErr;
      }
    } catch (error) {
      console.error('Error getting GPS points from Firebase:', error);
      return [];
    }
  },

  // Samples
  async addSample(
    uid: string,
    trackId: string,
    latitude: number,
    longitude: number,
    name: string,
    notes?: string,
    clientId?: string,
    sampleNumber?: number,
    metadata?: {
      depth_cm?: number;
      horizon?: string;
      soil_type?: string;
      sampling_method?: string;
      coordinate_system?: string;
      device_accuracy_m?: number;
      operator?: string;
      field_id?: string;
      parcel_id?: string;
      legal_ref?: string;
      lab_export_status?: string;
      lab_exported_at?: string;
    }
  ) {
    try {
      // CRITICAL FIX: Sanitize metadata - remove undefined values for Firestore compatibility
      const sanitizedMetadata: any = {};
      if (metadata) {
        Object.keys(metadata).forEach(key => {
          const value = (metadata as any)[key];
          if (value !== undefined) {
            sanitizedMetadata[key] = value;
          }
        });
      }
      
      const data = {
        track_id: trackId,
        latitude,
        longitude,
        name,
        notes: notes || '',
        sample_number: sampleNumber ?? null,
        ...sanitizedMetadata,
        timestamp: Timestamp.now()
      };

      if (clientId) {
        const docRef = doc(db, getCollectionPath(uid, 'samples'), clientId);
        await this.withRetry(() => setDoc(docRef, data, { merge: true }));
        return docRef.id;
      }

      const docRef = await addDoc(
        collection(db, getCollectionPath(uid, 'samples')),
        data
      );
      return docRef.id;
    } catch (error) {
      console.error('Error adding sample to Firebase:', error);
      throw error;
    }
  },

  async getSamples(uid: string, trackId: string) {
    try {
      const baseCollection = collection(db, getCollectionPath(uid, 'samples'));
      try {
        const q = query(
          baseCollection,
          where('track_id', '==', trackId),
          orderBy('timestamp', 'asc')
        );
        const snapshot = await getDocs(q);
        return snapshot.docs.map(doc => ({ id: doc.id, ...convertFirestoreData(doc.data()) }));
      } catch (indexErr: any) {
        if (indexErr?.code === 'failed-precondition' || indexErr?.message?.includes('index')) {
          console.warn('[Firebase] Missing index for samples; retrying without orderBy', {
            trackId,
            message: indexErr?.message
          });
          const qNoOrder = query(
            baseCollection,
            where('track_id', '==', trackId)
          );
          const snapshot = await getDocs(qNoOrder);
          const docs = snapshot.docs.map(doc => ({ id: doc.id, ...convertFirestoreData(doc.data()) }));
          docs.sort((a: any, b: any) => {
            const ta = a.timestamp ? new Date(a.timestamp).getTime() : 0;
            const tb = b.timestamp ? new Date(b.timestamp).getTime() : 0;
            return ta - tb;
          });
          return docs;
        }
        throw indexErr;
      }
    } catch (error) {
      console.error('Error getting samples from Firebase:', error);
      return [];
    }
  },

  async deleteSample(uid: string, sampleId: string) {
    try {
      await deleteDoc(doc(db, getCollectionPath(uid, 'samples'), sampleId));
    } catch (error) {
      console.error('Error deleting sample from Firebase:', error);
      throw error;
    }
  },

  // Dedicated field samples (Option B)
  async addFieldSample(
    uid: string,
    projectId: string,
    fieldBoundaryId: string,
    latitude: number,
    longitude: number,
    name: string,
    notes?: string,
    clientId?: string,
    sampleNumber?: number,
    metadata?: Record<string, any>
  ) {
    try {
      const sanitizedMetadata: any = {};
      if (metadata) {
        Object.keys(metadata).forEach(key => {
          const value = metadata[key];
          if (value !== undefined) {
            sanitizedMetadata[key] = value;
          }
        });
      }

      const data = {
        project_id: projectId,
        field_boundary_id: fieldBoundaryId,
        latitude,
        longitude,
        name,
        notes: notes || '',
        sample_number: sampleNumber ?? null,
        ...sanitizedMetadata,
        timestamp: Timestamp.now(),
        created_at: Timestamp.now(),
      };

      if (clientId) {
        const docRef = doc(db, getCollectionPath(uid, 'field_samples'), clientId);
        await this.withRetry(() => setDoc(docRef, data, { merge: true }));
        return docRef.id;
      }

      const docRef = await addDoc(
        collection(db, getCollectionPath(uid, 'field_samples')),
        data
      );
      return docRef.id;
    } catch (error) {
      console.error('Error adding field sample to Firebase:', error);
      throw error;
    }
  },

  async getFieldSamples(uid: string, projectId: string) {
    try {
      const baseCollection = collection(db, getCollectionPath(uid, 'field_samples'));
      try {
        const q = query(
          baseCollection,
          where('project_id', '==', projectId),
          orderBy('timestamp', 'asc')
        );
        const snapshot = await getDocs(q);
        return snapshot.docs.map(doc => ({ id: doc.id, ...convertFirestoreData(doc.data()) }));
      } catch (indexErr: any) {
        if (indexErr?.code === 'failed-precondition' || indexErr?.message?.includes('index')) {
          console.warn('[Firebase] Missing index for field_samples; retrying without orderBy', {
            projectId,
            message: indexErr?.message
          });
          const qNoOrder = query(
            baseCollection,
            where('project_id', '==', projectId)
          );
          const snapshot = await getDocs(qNoOrder);
          const docs = snapshot.docs.map(doc => ({ id: doc.id, ...convertFirestoreData(doc.data()) }));
          docs.sort((a: any, b: any) => {
            const ta = a.timestamp ? new Date(a.timestamp).getTime() : 0;
            const tb = b.timestamp ? new Date(b.timestamp).getTime() : 0;
            return ta - tb;
          });
          return docs;
        }
        throw indexErr;
      }
    } catch (error) {
      console.error('Error getting field samples from Firebase:', error);
      return [];
    }
  },

  async deleteFieldSample(uid: string, sampleId: string) {
    try {
      await deleteDoc(doc(db, getCollectionPath(uid, 'field_samples'), sampleId));
    } catch (error) {
      console.error('Error deleting field sample from Firebase:', error);
      throw error;
    }
  },

  // Field Boundaries
  async createFieldBoundary(
    uid: string,
    projectId: string,
    name: string,
    geometry: any,
    color?: string,
    properties?: any,
    clientId?: string,
    renderMeta?: any
  ) {
    try {
      await ensureAuthForUid(uid);

      // Normalize and validate geometry using centralized utility
      const normalizedGeometry = normalizeGeometry(geometry);
      const simplifiedGeometry = simplifyGeometryForStorage(normalizedGeometry);
      
      // Serialize for Firestore (single source of truth)
      const geometryString = serializeGeometryForFirestore(simplifiedGeometry);
      const normalizedRenderMeta = normalizeBoundaryRenderMeta(renderMeta, normalizedGeometry);
      const data: any = {
        project_id: projectId,
        name,
        geometry: geometryString,
        color: color || '#00FF00',
        created_at: serverTimestamp()
      };

      if (normalizedRenderMeta) {
        const firestoreRenderMeta = toFirestoreRenderMeta(normalizedRenderMeta);
        if (firestoreRenderMeta) {
          data.render_meta = firestoreRenderMeta;
        }
      }
      
      if (properties) {
        // Sanitize properties for Firestore
        if (properties === null || (typeof properties === 'object' && !Array.isArray(properties))) {
          data.properties = properties;
        } else if (typeof properties === 'string') {
          try {
            data.properties = JSON.parse(properties);
          } catch {
            data.properties = { value: properties };
          }
        } else {
          data.properties = { value: properties };
        }
      }

      const createNestedArrayPaths = findFirestoreNestedArrayPaths(data);
      if (createNestedArrayPaths.length > 0) {
        console.warn('[Firebase] createFieldBoundary contains Firestore-incompatible nested arrays:', {
          uid,
          projectId,
          boundaryName: name,
          paths: createNestedArrayPaths
        });
      }

      if (clientId) {
        const docRef = doc(db, getCollectionPath(uid, 'field_boundaries'), clientId);
        await this.withRetry(() => setDoc(docRef, data, { merge: true }));
        return docRef.id;
      }

      const docRef = await addDoc(
        collection(db, getCollectionPath(uid, 'field_boundaries')),
        data
      );
      return docRef.id;
    } catch (error) {
      console.error('Error creating field boundary in Firebase:', error);
      throw error;
    }
  },

  async getFieldBoundaries(uid: string, projectId: string) {
    try {
      const q = query(
        collection(db, getCollectionPath(uid, 'field_boundaries')),
        where('project_id', '==', projectId)
      );
      const snapshot = await getDocs(q);
      console.log('[Firebase] Field boundaries snapshot received:', snapshot.docs.length);
      return snapshot.docs.map(doc => {
        const data = convertFirestoreData(doc.data());
        
        // Deserialize geometry using centralized utility (handles validation)
        let geometry;
        try {
          geometry = deserializeGeometryFromFirestore(data.geometry);
        } catch (error) {
          console.error('[Firebase] Error deserializing geometry for boundary', doc.id, error);
          // Return with null geometry rather than crashing
          geometry = null;
        }
        
        return {
          id: doc.id,
          ...data,
          geometry
        };
      });
    } catch (error: any) {
      console.error('[Firebase] Error getting field boundaries:', {
        error: error.message,
        code: error.code
      });
      return [];
    }
  },

  async deleteFieldBoundary(uid: string, boundaryId: string) {
    try {
      await deleteDoc(doc(db, getCollectionPath(uid, 'field_boundaries'), boundaryId));
    } catch (error) {
      console.error('Error deleting field boundary from Firebase:', error);
      throw error;
    }
  },

  async updateFieldBoundary(
    uid: string,
    boundaryId: string,
    name?: string,
    geometry?: any,
    color?: string,
    properties?: any,
    renderMeta?: any
  ) {
    try {
      const updates: any = {
        updated_at: serverTimestamp()
      };

      // CRITICAL FIX: Sanitize all fields before adding to updates
      // Firestore throws "n.indexOf is not a function" when it receives invalid data types
      
      if (name !== undefined) {
        // Ensure name is a string
        updates.name = String(name || '');
      }
      
      if (geometry !== undefined) {
        try {
          const normalizedGeometry = normalizeGeometry(geometry);
          const simplifiedGeometry = simplifyGeometryForStorage(normalizedGeometry);
          updates.geometry = serializeGeometryForFirestore(simplifiedGeometry);
          console.log('[Firebase] Serialized geometry for update:', typeof updates.geometry, updates.geometry?.substring(0, 100));
        } catch (geoError: any) {
          console.error('[Firebase] Failed to normalize/serialize geometry:', geoError);
          throw new Error(`Invalid geometry: ${geoError.message}`);
        }
      }
      
      if (color !== undefined) {
        // Ensure color is a string
        updates.color = String(color || '');
      }
      
      if (properties !== undefined) {
        // Ensure properties is a plain object or null, not undefined
        // Firestore doesn't like certain data types, so we need to sanitize
        if (properties === null) {
          updates.properties = null;
        } else if (typeof properties === 'object' && !Array.isArray(properties)) {
          // Deep clone to avoid reference issues and remove any undefined values
          updates.properties = JSON.parse(JSON.stringify(properties));
        } else if (typeof properties === 'string') {
          // If properties is a string, try to parse it
          try {
            updates.properties = JSON.parse(properties);
          } catch {
            // If parse fails, store as-is but wrap in object
            updates.properties = { value: properties };
          }
        } else {
          // For any other type, wrap in object
          updates.properties = { value: properties };
        }
      }

      if (renderMeta !== undefined) {
        if (renderMeta === null) {
          updates.render_meta = null;
        } else {
          const normalizedRenderMeta = normalizeBoundaryRenderMeta(renderMeta, geometry);
          if (normalizedRenderMeta) {
            const firestoreRenderMeta = toFirestoreRenderMeta(normalizedRenderMeta);
            if (firestoreRenderMeta) {
              updates.render_meta = firestoreRenderMeta;
            }
          }
        }
      }

      // CRITICAL FIX: Remove any undefined values from updates object
      // Firestore doesn't handle undefined values properly
      Object.keys(updates).forEach(key => {
        if (updates[key] === undefined) {
          delete updates[key];
        }
      });

      const updateNestedArrayPaths = findFirestoreNestedArrayPaths(updates);
      if (updateNestedArrayPaths.length > 0) {
        console.warn('[Firebase] updateFieldBoundary contains Firestore-incompatible nested arrays:', {
          uid,
          boundaryId,
          paths: updateNestedArrayPaths
        });
      }

      console.log('[Firebase] updateFieldBoundary:', boundaryId, 'updates:', {
        ...updates,
        geometry: updates.geometry ? `${typeof updates.geometry} (${updates.geometry.length} chars)` : undefined
      });

      const boundaryRef = doc(db, getCollectionPath(uid, 'field_boundaries'), boundaryId);
      await updateDoc(boundaryRef, updates);
    } catch (error) {
      console.error('Error updating field boundary in Firebase:', error);
      throw error;
    }
  },

  // Devices
  async getDevices(uid: string) {
    try {
      const q = query(
        collection(db, getCollectionPath(uid, 'devices')),
        orderBy('created_at', 'desc')
      );
      const snapshot = await getDocs(q);
      return snapshot.docs.map(doc => ({ id: doc.id, ...convertFirestoreData(doc.data()) }));
    } catch (error) {
      console.error('Error getting devices from Firebase:', error);
      return [];
    }
  },

  async saveDevice(uid: string, device: any, clientId?: string) {
    try {
      // Clean device data - remove undefined values that Firestore doesn't accept
      const cleanDevice = Object.fromEntries(
        Object.entries(device).filter(([_, value]) => value !== undefined)
      );

      const docId = clientId ? String(clientId) : undefined;

      if (docId) {
        const docRef = doc(db, getCollectionPath(uid, 'devices'), docId);
        const deviceData = {
          ...cleanDevice,
          created_at: cleanDevice.created_at ?? serverTimestamp(),
          updated_at: serverTimestamp()
        };
        await this.withRetry(() => setDoc(docRef, deviceData, { merge: true }));
        return docRef.id;
      }

      const deviceData = {
        ...cleanDevice,
        created_at: cleanDevice.created_at ?? serverTimestamp(),
        updated_at: serverTimestamp()
      };

      const docRef = await addDoc(
        collection(db, getCollectionPath(uid, 'devices')),
        deviceData
      );
      return docRef.id;
    } catch (error) {
      console.error('Error saving device to Firebase:', error);
      throw error;
    }
  },

  async deleteDevice(uid: string, deviceId: string) {
    try {
      await deleteDoc(doc(db, getCollectionPath(uid, 'devices'), deviceId));
    } catch (error) {
      console.error('Error deleting device from Firebase:', error);
      throw error;
    }
  },

  // Real-time subscription to track changes
  subscribeToTracks(uid: string, projectId: string, onUpdate: (tracks: any[]) => void): () => void {
    console.log('[Firebase] Setting up real-time track subscription for project:', projectId);
    const q = query(
      collection(db, getCollectionPath(uid, 'tracks')),
      where('project_id', '==', projectId)
    );
    
    const unsubscribe = onSnapshot(q, 
      async (snapshot) => {
        console.log('[Firebase] Track snapshot received:', snapshot.docs.length, 'tracks');
        const tracks = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        
        // Hydrate with samples/points
        const hydratedTracks = await Promise.all(
          tracks.map(async (track: any) => {
            try {
              const [points, samples] = await Promise.all([
                this.getGpsPoints(uid, track.id),
                this.getSamples(uid, track.id)
              ]);
              return { ...track, gps_points: points || [], samples: samples || [] };
            } catch (error) {
              console.warn(`[Firebase] Failed to hydrate track ${track.id}:`, error);
              return { ...track, gps_points: [], samples: [] };
            }
          })
        );
        
        onUpdate(hydratedTracks);
      },
      (error) => {
        console.error('[Firebase] Track subscription error:', error);
      }
    );
    
    return unsubscribe;
  }
};
