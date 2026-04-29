// Verify and fix user setup in Firebase
import admin from 'firebase-admin';
import { readFileSync } from 'fs';

const serviceAccount = JSON.parse(
  readFileSync('./scripts/firebase-service-account.json', 'utf8')
);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

async function verifyUserSetup(email) {
  try {
    console.log(`\n🔍 Looking for user: ${email}`);
    const user = await admin.auth().getUserByEmail(email);
    console.log(`✅ Found user: ${user.uid}`);
    console.log(`   Display Name: ${user.displayName || '(not set)'}`);
    console.log(`   Email Verified: ${user.emailVerified}`);

    const db = admin.firestore();
    
    // Check users/{uid} document
    console.log('\n📄 Checking users/{uid} document...');
    const userDoc = await db.collection('users').doc(user.uid).get();
    if (userDoc.exists) {
      console.log('✅ users/{uid} exists:');
      const userData = userDoc.data();
      console.log('   Role:', userData.role || '(not set)');
      console.log('   Email:', userData.email || '(not set)');
      console.log('   Display Name:', userData.displayName || '(not set)');
      
      // Fix if role is missing
      if (!userData.role || userData.role === 'client') {
        console.log('\n🔧 Fixing role to admin...');
        await db.collection('users').doc(user.uid).update({
          role: 'admin',
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });
        console.log('✅ Role updated to admin');
      }
    } else {
      console.log('❌ users/{uid} does NOT exist - creating...');
      await db.collection('users').doc(user.uid).set({
        email: user.email,
        displayName: user.displayName || null,
        role: 'admin',
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      console.log('✅ users/{uid} created with role=admin');
    }

    // Check user_profiles/{uid} document
    console.log('\n📄 Checking user_profiles/{uid} document...');
    const profileDoc = await db.collection('user_profiles').doc(user.uid).get();
    if (profileDoc.exists) {
      console.log('✅ user_profiles/{uid} exists:');
      const profileData = profileDoc.data();
      console.log('   First Name:', profileData.firstName || '(not set)');
      console.log('   Last Name:', profileData.lastName || '(not set)');
      console.log('   Email:', profileData.email || '(not set)');
      console.log('   Company:', profileData.company || '(not set)');
    } else {
      console.log('⚠️  user_profiles/{uid} does NOT exist');
      console.log('   This should be created via the app or manually in Firebase Console');
      console.log('   Required fields: firstName, lastName, email');
    }

    // Check custom claims
    console.log('\n🔑 Checking custom claims...');
    const userRecord = await admin.auth().getUser(user.uid);
    if (userRecord.customClaims?.admin) {
      console.log('✅ Custom claim: admin=true');
    } else {
      console.log('🔧 Setting custom claim: admin=true');
      await admin.auth().setCustomUserClaims(user.uid, { admin: true });
      console.log('✅ Custom claim set');
    }

    console.log('\n✅ User setup verification complete!');
    console.log('\n📋 Summary:');
    console.log(`   User ID: ${user.uid}`);
    console.log(`   Email: ${email}`);
    console.log(`   Role: admin ✅`);
    console.log(`   Custom Claim: admin=true ✅`);
    
    process.exit(0);
  } catch (error) {
    console.error('\n❌ Error:', error.message);
    console.error('\nStack:', error.stack);
    process.exit(1);
  }
}

// Get email from command line args or use default
const email = process.argv[2] || 'florin@techbyp.com';
verifyUserSetup(email);
