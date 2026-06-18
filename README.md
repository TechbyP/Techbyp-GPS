# GPS Tracker App

A comprehensive GPS tracking application with offline-first architecture, built with React, TypeScript, and Capacitor. Works on web browsers, Windows tablets, and Android devices with full offline support and Firebase sync.

## 🚀 Features

- **📍 Real-time GPS Tracking** - Track your location with high accuracy
- **🗺️ Field Boundary Mapping** - Draw and edit field boundaries on interactive maps
- **💾 Offline-First** - Works completely offline with local SQLite database
- **☁️ Cloud Sync** - Automatically syncs to Firebase when online
- **📱 Cross-Platform** - Runs on Android devices, Windows tablets, and web browsers
- **🪟 Windows Tablet Support** - Full GPS tracking on Windows tablets with touch support
- **🔌 External GPS Support** - Connect external GPS devices via Bluetooth, WiFi, or USB Serial
- **🔐 Secure** - Per-user data isolation with Firebase Authentication
- **🌍 Multi-Language** - Internationalization support (i18n)
- **🎨 Modern UI** - Beautiful interface with dark mode support

## 🪟 Windows Tablet Support

This app fully supports Windows tablets with GPS capabilities:

### Built-in GPS
- Uses the browser's native Geolocation API
- Automatically detects Windows tablets with touch support
- Shows tracking controls on Windows tablets (same as mobile)
- Works in any modern browser (Chrome, Edge, Firefox)

### External GPS Devices
Windows tablets can connect to external GPS devices for enhanced accuracy:

1. **USB Serial GPS** - Connect GPS devices via USB using Web Serial API
   - Supports NMEA 0183 protocol
   - Works with most USB GPS receivers
   - Requires Chrome or Edge browser (Web Serial API support)

2. **Bluetooth GPS** - Connect via Bluetooth (Android app only)
   - Use the Android APK on Windows tablets with Android emulation

3. **WiFi GPS** - Connect to network GPS devices
   - RTK GPS stations (e.g., Emlid Reach RS3)
   - WiFi-enabled GPS receivers

### Installing as PWA on Windows
1. Open the app in Chrome or Edge browser
2. Click the install icon in the address bar (or menu → "Install GPS Tracker")
3. The app will install as a standalone application
4. Launch from Start Menu like any other app
5. Works offline with full functionality

## 📋 Prerequisites

- **Node.js** (v18 or higher)
- **npm** or **yarn**
- **Android Studio** (for building APK)
- **Firebase Project** (for authentication and database)

## 🛠️ Setup Instructions

### 1. Clone the Repository

```bash
git clone https://github.com/TechbyP/GPS-App.git
cd GPS-App
```

### 2. Install Dependencies

```bash
npm install
```

### 3. Configure Firebase

1. Create a Firebase project at [Firebase Console](https://console.firebase.google.com/)
2. Enable **Authentication** (Email/Password)
3. Create a **Firestore Database**
4. Copy `.env.example` to `.env`:
   ```bash
   cp .env.example .env
   ```
5. Fill in your Firebase credentials in `.env`:
   ```env
   VITE_FIREBASE_API_KEY=your_api_key
   VITE_FIREBASE_AUTH_DOMAIN=your-project.firebaseapp.com
   VITE_FIREBASE_PROJECT_ID=your-project-id
   # ... etc
   ```

### 4. Download google-services.json

1. Go to Firebase Console > Project Settings > Your Apps
2. Download `google-services.json`
3. Place it in `android/app/google-services.json`

### 5. Deploy Firestore Rules and Indexes

```bash
# Deploy security rules
firebase deploy --only firestore:rules

# Deploy indexes
firebase deploy --only firestore:indexes
```

## 🏃 Running the App

### Web Development

```bash
npm run dev
```

Visit `http://localhost:5173`

### Web Production Build

```bash
npm run build
```

`npm run build` is the web build and emits `dist/index.html`.
You can also run `npm run build:web` explicitly; it produces the same output.

### Android Development

```bash
# Build the web assets
npm run build

# Sync with Capacitor
npx cap sync

# Open in Android Studio
npx cap open android
```

Then build and run from Android Studio.

### Quick Android Build

```bash
# Verify build requirements
./verify-build.ps1

# Build APK
./build-apk.ps1
```

The APK will be in `android/app/build/outputs/apk/debug/`

## 📁 Project Structure

```
GPS-App/
├── src/
│   ├── components/        # React components
│   │   ├── Auth/         # Authentication screens
│   │   ├── GPS/          # GPS tracking components
│   │   └── ui/           # Reusable UI components
│   ├── services/         # Business logic & API services
│   │   ├── hybridDatabase.ts      # Offline-first database
│   │   ├── firestoreService.ts    # Firebase operations
│   │   ├── localDatabase.ts       # SQLite for Android
│   │   ├── indexedDBService.ts    # IndexedDB for web
│   │   └── databaseMigrations.ts  # Schema migrations
│   ├── context/          # React Context (Auth, etc.)
│   ├── hooks/            # Custom React hooks
│   ├── types/            # TypeScript type definitions
│   ├── utils/            # Utility functions
│   └── config/           # Configuration files
├── android/              # Android native project
├── public/               # Static assets
├── docs/                 # Documentation
└── scripts/              # Build & utility scripts
```

## 🔧 Architecture

### Hybrid Database System

The app uses a **hybrid offline-first architecture**:

- **Online**: Data syncs to Firebase Firestore
- **Offline**: Data saved to local database
  - **Android**: SQLite via Capacitor
  - **Web**: IndexedDB
- **Sync Queue**: Automatically syncs local changes when connection is restored

### Data Flow

```
User Action
    ↓
HybridDB Service
    ↓
├─ Online? → Firebase Firestore → Local Cache
└─ Offline? → Local Database → Sync Queue
```

### Schema Versioning

The app includes an automatic migration system that upgrades the local database schema when needed. See `src/services/databaseMigrations.ts`.

## 🗃️ Database Schema

### Collections

- **users/{uid}/projects** - GPS tracking projects
- **users/{uid}/tracks** - Individual GPS tracks
- **users/{uid}/gps_points** - GPS coordinate points
- **users/{uid}/samples** - Sample collection points
- **users/{uid}/field_boundaries** - Field boundary polygons
- **users/{uid}/devices** - Connected GPS devices

All data is isolated per user for security.

## 🔒 Security

- Firebase Authentication required for all operations
- Firestore security rules enforce per-user data isolation
- No user can access another user's data
- API keys are bundled at build time (not exposed to users)

## 🧪 Testing

```bash
# Run linting
npm run lint

# Build for production
npm run build

# Preview production build
npm run preview
```

## 🌐 Deploying `dist` To A Website

When deploying the web app, upload the contents of `dist/`, not the `dist` folder itself.

Replace these together on the server each time:

- `index.html`
- `sw.js`
- `manifest.webmanifest`
- `.htaccess`
- `assets/`
- any copied static files like `app-logo.png`, `leaflet/`, and `tiles/`

For Apache-based hosting such as many IONOS webspace plans, the generated `.htaccess`
in `dist/` redirects all HTTP traffic to HTTPS and sends a conservative HSTS header.
Upload it together with the other root files from `dist/`.

This app registers a production service worker for PWA/offline behavior. If desktop/local preview looks correct but iPhone still shows old sizing after upload, the most common cause is stale cached HTML/CSS/JS on the phone.

Recommended hosting cache rules:

- `index.html`: `no-cache` or very short cache lifetime
- `sw.js`: `no-cache` or very short cache lifetime
- `manifest.webmanifest`: `no-cache` or very short cache lifetime
- hashed files under `assets/`: long cache lifetime is fine

If an iPhone still shows the old layout after deploy:

1. Close all tabs for the site.
2. In Safari, clear the website data for that domain.
3. If the site was added to the Home Screen, remove that app shortcut and reopen the site once in Safari.
4. Open the deployed site again so it can fetch the latest `index.html` and `sw.js`.

## 📦 Building for Production

### Android APK (Debug)

```bash
./build-apk.ps1
```

### Android APK (Release)

```bash
./build-apk-release.ps1
```

Make sure to configure your keystore in `android/app/build.gradle` for signed releases.

## 🐛 Troubleshooting

### "npm run dev" fails

- Check that all dependencies are installed: `npm install`
- Verify `.env` file exists with Firebase credentials
- Check Node.js version: `node --version` (should be v18+)

### APK build fails

- Run verification script: `./verify-build.ps1`
- Ensure `google-services.json` exists in `android/app/`
- Check that Android SDK is installed and `ANDROID_HOME` is set
- Try cleaning: `cd android && ./gradlew clean`

### Firebase connection issues

- Verify Firebase credentials in `.env`
- Check Firestore rules are deployed
- Ensure user is authenticated
- Check browser console for error details

### Offline mode not working

- On Android: Check that SQLite plugin is installed
- On Web: Check that IndexedDB is enabled in browser
- Verify local database initialization in console logs

## 📄 License

This project is licensed under the MIT License.

## 🤝 Contributing

Contributions are welcome! Please open an issue or submit a pull request.

## 📧 Support

For questions or issues, please open a GitHub issue.

---

**Built with ❤️ using React, TypeScript, Capacitor, and Firebase**
