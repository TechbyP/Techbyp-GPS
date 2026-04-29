// Test Firestore permissions for current user
import admin from 'firebase-admin';
import { readFileSync } from 'fs';

const serviceAccount = JSON.parse(
  readFileSync('./scripts/firebase-service-account.json', 'utf8')
);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

async function testPermissions(email) {
  try {
    console.log(`\n🔍 Testing Firestore permissions for: ${email}\n`);
    
    const user = await admin.auth().getUserByEmail(email);
    console.log(`✅ User found: ${user.uid}`);
    
    const db = admin.firestore();
    
    // Test 1: Check users/{uid} document
    console.log('\n--- Test 1: Check users/{uid} document ---');
    const userDoc = await db.collection('users').doc(user.uid).get();
    if (userDoc.exists) {
      const data = userDoc.data();
      console.log('✅ users/{uid} exists');
      console.log('   Role:', data.role || '(not set)');
      console.log('   Email:', data.email || '(not set)');
      console.log('   Display Name:', data.displayName || '(not set)');
    } else {
      console.log('❌ users/{uid} does NOT exist');
    }
    
    // Test 2: Check user_profiles/{uid} document
    console.log('\n--- Test 2: Check user_profiles/{uid} document ---');
    const profileDoc = await db.collection('user_profiles').doc(user.uid).get();
    if (profileDoc.exists) {
      const data = profileDoc.data();
      console.log('✅ user_profiles/{uid} exists');
      console.log('   Name:', `${data.firstName || ''} ${data.lastName || ''}`);
      console.log('   Email:', data.email || '(not set)');
      console.log('   Company:', data.company || '(not set)');
    } else {
      console.log('❌ user_profiles/{uid} does NOT exist');
    }
    
    // Test 3: Check custom claims
    console.log('\n--- Test 3: Check custom claims ---');
    const userRecord = await admin.auth().getUser(user.uid);
    if (userRecord.customClaims) {
      console.log('✅ Custom claims exist:', userRecord.customClaims);
      if (userRecord.customClaims.admin) {
        console.log('   ✅ Admin claim: true');
      } else {
        console.log('   ❌ Admin claim: false or not set');
      }
    } else {
      console.log('❌ No custom claims set');
    }
    
    // Test 4: Check projects subcollection
    console.log('\n--- Test 4: Check projects subcollection ---');
    try {
      const projectsSnapshot = await db.collection('users').doc(user.uid).collection('projects').get();
      console.log(`✅ Can read projects subcollection: ${projectsSnapshot.size} projects found`);
      if (projectsSnapshot.size > 0) {
        projectsSnapshot.forEach(doc => {
          const data = doc.data();
          console.log(`   - ${doc.id}: ${data.name || '(unnamed)'}`);
        });
      }
    } catch (error) {
      console.log('❌ Cannot read projects:', error.message);
    }
    
    // Test 5: Check field_boundaries subcollection
    console.log('\n--- Test 5: Check field_boundaries subcollection ---');
    try {
      const boundariesSnapshot = await db.collection('users').doc(user.uid).collection('field_boundaries').get();
      console.log(`✅ Can read field_boundaries subcollection: ${boundariesSnapshot.size} fields found`);
      if (boundariesSnapshot.size > 0) {
        boundariesSnapshot.forEach(doc => {
          const data = doc.data();
          console.log(`   - ${doc.id}: ${data.name || '(unnamed)'}`);
        });
      }
    } catch (error) {
      console.log('❌ Cannot read field_boundaries:', error.message);
    }
    
    // Summary
    console.log('\n=================================');
    console.log('Summary:');
    console.log('=================================');
    console.log(`User: ${email} (${user.uid})`);
    console.log(`Role in Firestore: ${userDoc.exists ? (userDoc.data().role || '(not set)') : '(doc missing)'}`);
    console.log(`Custom claim admin: ${userRecord.customClaims?.admin ? 'YES ✅' : 'NO ❌'}`);
    console.log(`\nIf custom claim is NO, user needs to:`);
    console.log(`  1. Log out of the app`);
    console.log(`  2. Clear browser cache/storage`);
    console.log(`  3. Log back in`);
    console.log(`  4. Token will be refreshed with new claims`);
    
    process.exit(0);
  } catch (error) {
    console.error('\n❌ Error:', error.message);
    console.error('\nStack:', error.stack);
    process.exit(1);
  }
}

// Get email from command line or default
const email = process.argv[2] || 'david@techbyp.com';
testPermissions(email);
