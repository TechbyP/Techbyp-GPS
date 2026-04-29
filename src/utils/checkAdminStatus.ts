// Debug utility to check admin status and permissions
import { auth, db } from '../firebase';
import { doc, getDoc } from 'firebase/firestore';

export async function checkAdminStatus() {
  const user = auth.currentUser;
  if (!user) {
    console.error('❌ No user is currently signed in');
    return {
      authenticated: false,
      admin: false
    };
  }

  console.log('\n🔍 ADMIN STATUS CHECK');
  console.log('='.repeat(50));
  
  // Step 1: Check authentication
  console.log('\n1️⃣ Authentication Status:');
  console.log('  ✅ User ID:', user.uid);
  console.log('  ✅ Email:', user.email);
  console.log('  ✅ Email Verified:', user.emailVerified);
  
  // Step 2: Check custom claims
  console.log('\n2️⃣ Custom Claims (From Auth Token):');
  try {
    const tokenResult = await user.getIdTokenResult();
    console.log('  Token issued at:', new Date(tokenResult.issuedAtTime).toISOString());
    console.log('  Token expires at:', new Date(tokenResult.expirationTime).toISOString());
    console.log('  Custom claims:', tokenResult.claims);
    
    if (tokenResult.claims.admin === true) {
      console.log('  ✅ ADMIN CLAIM: YES');
    } else {
      console.log('  ❌ ADMIN CLAIM: NO');
      console.log('  ⚠️  You need to clear browser cache and re-login!');
    }
  } catch (error) {
    console.error('  ❌ Error reading custom claims:', error);
  }
  
  // Step 3: Check Firestore role
  console.log('\n3️⃣ Firestore Role (From users/{uid}):');
  try {
    const userDoc = await getDoc(doc(db, 'users', user.uid));
    if (userDoc.exists()) {
      const data = userDoc.data();
      console.log('  ✅ Document exists');
      console.log('  Role:', data.role || '(not set)');
      
      if (data.role === 'admin') {
        console.log('  ✅ FIRESTORE ROLE: ADMIN');
      } else {
        console.log('  ❌ FIRESTORE ROLE: NOT ADMIN');
      }
    } else {
      console.log('  ❌ users/{uid} document does NOT exist');
      console.log('  ⚠️  Run: node scripts/verify-user-setup.js', user.email);
    }
  } catch (error: any) {
    console.error('  ❌ Error reading Firestore:', error.code, error.message);
    console.log('  ⚠️  Permission denied - your token might be outdated');
    console.log('  ⚠️  Clear browser cache and re-login!');
  }
  
  // Step 4: Check user_profiles
  console.log('\n4️⃣ User Profile (From user_profiles/{uid}):');
  try {
    const profileDoc = await getDoc(doc(db, 'user_profiles', user.uid));
    if (profileDoc.exists()) {
      const data = profileDoc.data();
      console.log('  ✅ Profile exists');
      console.log('  Name:', `${data.firstName || ''} ${data.lastName || ''}`);
      console.log('  Email:', data.email);
      console.log('  Company:', data.company || '(not set)');
    } else {
      console.log('  ❌ user_profiles/{uid} does NOT exist');
    }
  } catch (error) {
    console.error('  ❌ Error reading profile:', error);
  }
  
  // Summary
  console.log('\n📊 SUMMARY:');
  console.log('='.repeat(50));
  
  try {
    const tokenResult = await user.getIdTokenResult();
    const hasAdminClaim = tokenResult.claims.admin === true;
    
    try {
      const userDoc = await getDoc(doc(db, 'users', user.uid));
      const hasAdminRole = userDoc.exists() && userDoc.data().role === 'admin';
      
      if (hasAdminClaim && hasAdminRole) {
        console.log('✅ YOU ARE AN ADMIN - Edit controls should work');
      } else if (!hasAdminClaim && hasAdminRole) {
        console.log('⚠️  Backend is ready, but your TOKEN is outdated');
        console.log('   ➡️  CLEAR BROWSER CACHE and RE-LOGIN');
      } else if (hasAdminClaim && !hasAdminRole) {
        console.log('⚠️  Token is good, but Firestore role is missing');
        console.log('   ➡️  Run: node scripts/set-admin-user.js', user.email);
      } else {
        console.log('❌ You are NOT an admin');
        console.log('   ➡️  Contact system administrator');
      }
    } catch (fsError) {
      console.log('⚠️  Cannot verify Firestore role (permission denied)');
      if (hasAdminClaim) {
        console.log('✅ But your token HAS admin claim - should work!');
      } else {
        console.log('❌ And your token LACKS admin claim');
        console.log('   ➡️  CLEAR BROWSER CACHE and RE-LOGIN');
      }
    }
  } catch (error) {
    console.error('❌ Cannot complete summary:', error);
  }
  
  console.log('='.repeat(50) + '\n');
  
  // Quick fix instructions
  console.log('🔧 QUICK FIX:');
  console.log('1. Press F12 to keep console open');
  console.log('2. Go to Application > Storage > Clear site data');
  console.log('3. Close DevTools');
  console.log('4. Log out of the app');
  console.log('5. Log back in');
  console.log('6. Run checkAdminStatus() again\n');
}

// Make it globally available
if (typeof window !== 'undefined') {
  (window as any).checkAdminStatus = checkAdminStatus;
  console.log('🛠️  Debug utility loaded. Run checkAdminStatus() to check admin permissions.');
}

export default checkAdminStatus;
