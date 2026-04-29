// Force refresh Firebase auth token to get updated custom claims
// Run this after setting admin role for a user

import { auth } from '../firebase';

export async function refreshAuthToken(): Promise<void> {
  const user = auth.currentUser;
  if (!user) {
    console.error('No user is currently signed in');
    throw new Error('No user signed in');
  }

  console.log('🔄 Refreshing auth token for user:', user.email);
  
  try {
    // Force refresh the ID token
    const token = await user.getIdToken(true); // true = force refresh
    console.log('✅ Token refreshed successfully');
    
    // Get the token result to see custom claims
    const tokenResult = await user.getIdTokenResult();
    console.log('📋 Custom claims:', tokenResult.claims);
    console.log('📋 Admin claim:', tokenResult.claims.admin);
    
    // Check if admin claim exists
    if (!tokenResult.claims.admin) {
      console.warn('⚠️ Admin claim not found in token. You may need to:');
      console.warn('   1. Run: node scripts/set-admin-user.js your-email@example.com');
      console.warn('   2. Wait 5 minutes for changes to propagate');
      console.warn('   3. Log out and log back in');
    }
    
    return;
  } catch (error) {
    console.error('❌ Error refreshing token:', error);
    throw error;
  }
}

export async function checkUserClaims(): Promise<void> {
  const user = auth.currentUser;
  if (!user) {
    console.error('No user is currently signed in');
    return;
  }

  console.log('🔍 Checking user claims for:', user.email);
  
  try {
    const tokenResult = await user.getIdTokenResult();
    console.log('📋 User ID:', user.uid);
    console.log('📋 Email:', user.email);
    console.log('📋 All custom claims:', tokenResult.claims);
    console.log('📋 Is Admin:', !!tokenResult.claims.admin);
    console.log('📋 Token issued at:', new Date(tokenResult.issuedAtTime));
    console.log('📋 Token expires at:', new Date(tokenResult.expirationTime));
    
    return;
  } catch (error) {
    console.error('❌ Error checking claims:', error);
    throw error;
  }
}

// Make functions available globally for debugging
if (typeof window !== 'undefined') {
  (window as any).refreshAuthToken = refreshAuthToken;
  (window as any).checkUserClaims = checkUserClaims;
  console.log('🛠️ Auth utils loaded. Use:');
  console.log('   - refreshAuthToken() to refresh your token');
  console.log('   - checkUserClaims() to inspect custom claims');
}
