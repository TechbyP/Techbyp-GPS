// Update Firebase user password using Admin SDK
import admin from 'firebase-admin';
import { readFileSync } from 'fs';

// Load service account
const serviceAccount = JSON.parse(
  readFileSync('./scripts/firebase-service-account.json', 'utf8')
);

// Initialize Firebase Admin
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

async function updateUserPassword(email, newPassword) {
  try {
    console.log(`🔍 Looking for user: ${email}`);
    
    // Get user by email
    const user = await admin.auth().getUserByEmail(email);
    console.log(`✅ Found user: ${user.uid}`);
    
    // Update password
    await admin.auth().updateUser(user.uid, {
      password: newPassword
    });
    
    console.log(`✅ Password updated successfully for ${email}`);
    console.log(`   New password: ${newPassword}`);
    
    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

// Update password for florin@tecbyp.com
const userEmail = 'florin@tecbyp.com';
const newPassword = 'flo123';

updateUserPassword(userEmail, newPassword);
