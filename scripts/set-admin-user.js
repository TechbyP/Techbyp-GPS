// Set Firebase user as admin and update Firestore user role
import admin from 'firebase-admin';
import { readFileSync } from 'fs';

const serviceAccount = JSON.parse(
  readFileSync('./scripts/firebase-service-account.json', 'utf8')
);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

async function setAdmin(email) {
  try {
    console.log(`🔍 Looking for user: ${email}`);
    const user = await admin.auth().getUserByEmail(email);
    console.log(`✅ Found user: ${user.uid}`);

    // Set custom claim
    await admin.auth().setCustomUserClaims(user.uid, { admin: true });
    console.log('✅ Custom claim set: admin=true');

    // Update Firestore user document role
    const db = admin.firestore();
    await db.collection('users').doc(user.uid).set({
      email: user.email || email,
      displayName: user.displayName || null,
      role: 'admin',
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });

    console.log('✅ Firestore user document updated with role=admin');
    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

// Get email from command line args or use default
const email = process.argv[2] || 'florin@techbyp.com';
setAdmin(email);
