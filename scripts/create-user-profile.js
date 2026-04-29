// Create user_profiles document for a user
import admin from 'firebase-admin';
import { readFileSync } from 'fs';

const serviceAccount = JSON.parse(
  readFileSync('./scripts/firebase-service-account.json', 'utf8')
);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

async function createUserProfile(email, firstName, lastName, company = '') {
  try {
    console.log(`\n📝 Creating user_profiles document for: ${email}\n`);
    
    const user = await admin.auth().getUserByEmail(email);
    console.log(`✅ User found: ${user.uid}`);
    
    const db = admin.firestore();
    
    // Check if profile already exists
    const profileDoc = await db.collection('user_profiles').doc(user.uid).get();
    if (profileDoc.exists) {
      console.log('⚠️  user_profiles/{uid} already exists');
      console.log('   Updating instead...');
    }
    
    // Create or update profile
    await db.collection('user_profiles').doc(user.uid).set({
      firstName: firstName,
      lastName: lastName,
      email: email,
      company: company,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
    
    console.log('✅ user_profiles/{uid} created/updated');
    console.log(`   Name: ${firstName} ${lastName}`);
    console.log(`   Email: ${email}`);
    console.log(`   Company: ${company || '(none)'}`);
    
    process.exit(0);
  } catch (error) {
    console.error('\n❌ Error:', error.message);
    process.exit(1);
  }
}

// Parse command line args
const email = process.argv[2];
const firstName = process.argv[3];
const lastName = process.argv[4];
const company = process.argv[5] || '';

if (!email || !firstName || !lastName) {
  console.log('Usage: node create-user-profile.js <email> <firstName> <lastName> [company]');
  console.log('Example: node create-user-profile.js david@techbyp.com David Smith "TECHBYP"');
  process.exit(1);
}

createUserProfile(email, firstName, lastName, company);
