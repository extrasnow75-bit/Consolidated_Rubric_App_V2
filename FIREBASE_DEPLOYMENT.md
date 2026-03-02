# Firebase Hosting Deployment Guide

## Overview
Your Rubric Creator app is now configured for Firebase Hosting. Follow these steps to deploy it.

---

## Step 1: Create a Firebase Project (If Needed)

### Option A: Create via Google Cloud Console
1. Go to [Firebase Console](https://console.firebase.google.com)
2. Click **"Create a project"**
3. Enter project name: `rubric-app-consolidated` (or your preferred name)
4. Accept the terms and click **"Create project"**
5. Wait for the project to be created

### Option B: Use Existing Firebase Project
If you already have a Firebase project, you can reuse it.

---

## Step 2: Authenticate with Firebase CLI

1. Open PowerShell/Command Prompt
2. Navigate to your project directory:
   ```
   cd "C:\Users\Test Account\Documents\ClaudeProjects\rubric-app-consolidated"
   ```

3. Log in to Firebase:
   ```
   firebase login
   ```
   - Your browser will open automatically
   - Sign in with your Google account
   - Grant permissions when prompted
   - Return to the terminal (it will confirm authentication)

---

## Step 3: Configure Firebase Project ID

1. Open `.firebaserc` file in the project root
2. Replace `YOUR_FIREBASE_PROJECT_ID` with your actual Firebase project ID

   To find your project ID:
   - Go to [Firebase Console](https://console.firebase.google.com)
   - Click your project
   - Click ⚙️ (Settings) icon → Project Settings
   - Copy the **Project ID** (e.g., `rubric-app-12345`)

3. Update `.firebaserc`:
   ```json
   {
     "projects": {
       "default": "your-actual-project-id"
     },
     "targets": {},
     "etags": {}
   }
   ```

4. Save the file

---

## Step 4: Get Firebase Web Configuration

1. Go to [Firebase Console](https://console.firebase.google.com)
2. Click your project
3. Go to **Project Settings** (⚙️ icon)
4. Scroll to **Your apps** section
5. If you don't have a Web app yet:
   - Click **"< >"** to create a web app
   - Register app with any name (e.g., "Rubric Creator Web")
   - Copy the Firebase config
6. If you already have a web app:
   - Click the web app to view its config

The config will look like:
```javascript
{
  apiKey: "AIzaSy...",
  authDomain: "rubric-app-12345.firebaseapp.com",
  projectId: "rubric-app-12345",
  storageBucket: "rubric-app-12345.appspot.com",
  messagingSenderId: "123456789",
  appId: "1:123456789:web:abc..."
}
```

---

## Step 5: Update Environment Variables

1. Open `.env.production` file
2. Fill in the Firebase values from Step 4:
   ```
   VITE_FIREBASE_API_KEY=AIzaSy...
   VITE_FIREBASE_AUTH_DOMAIN=rubric-app-12345.firebaseapp.com
   VITE_FIREBASE_PROJECT_ID=rubric-app-12345
   VITE_FIREBASE_STORAGE_BUCKET=rubric-app-12345.appspot.com
   VITE_FIREBASE_MESSAGING_SENDER_ID=123456789
   VITE_FIREBASE_APP_ID=1:123456789:web:abc...
   ```

3. **Google OAuth Client ID**:
   - Go to [Google Cloud Console](https://console.cloud.google.com)
   - Select your Firebase project
   - Go to **APIs & Services** → **Credentials**
   - Click **"Create Credentials"** → **OAuth 2.0 Client ID**
   - Choose **Web application**
   - Add authorized redirect URI: `https://your-project-id.web.app/auth/callback`
   - Copy your Client ID and paste it:
     ```
     VITE_GOOGLE_OAUTH_CLIENT_ID=your_client_id.apps.googleusercontent.com
     VITE_GOOGLE_OAUTH_REDIRECT_URI=https://rubric-app-12345.web.app/auth/callback
     ```

4. **Gemini API Key** (if using paid tier):
   - Get from [Google AI Studio](https://aistudio.google.com)
   - Paste it (same key as development):
     ```
     VITE_GEMINI_API_KEY=your_api_key
     ```

5. Save `.env.production`

---

## Step 6: Deploy to Firebase Hosting

1. Open terminal in project directory
2. Run deployment:
   ```
   firebase deploy
   ```

3. Wait for deployment to complete
4. You'll see output like:
   ```
   ✔ Deploy complete!

   Project Console: https://console.firebase.google.com/project/rubric-app-12345/overview
   Hosting URL: https://rubric-app-12345.web.app
   ```

5. Your app is now live! Visit the **Hosting URL** in your browser

---

## Step 7: Enable Required Firebase Services (if needed)

Some features may require enabling services in Firebase Console:

1. Go to [Firebase Console](https://console.firebase.google.com)
2. Click your project
3. Go to **Build** section (left sidebar)
4. Ensure these are enabled:
   - **Authentication** (needed for Google Sign-In)
     - Click **Authentication**
     - Go to **Sign-in method**
     - Enable **Google** provider
   - **Hosting** (automatically enabled)

---

## Step 8: Update Firestore Rules (if using Firestore)

Currently, the app doesn't use Firestore, so this step is optional.

If you add Firestore later:
1. Go to Firebase Console → Firestore Database
2. Create database in **production mode**
3. Set appropriate security rules

---

## Troubleshooting

### Error: "Failed to authenticate, have you run `firebase login`?"
- Run `firebase login` and complete the authentication flow

### Error: "Project ID not found in .firebaserc"
- Make sure `.firebaserc` has the correct project ID
- Run `firebase use --add` to re-initialize project selection

### Environment Variables Not Loading
- Make sure `.env.production` is in the project root directory
- Variables must be prefixed with `VITE_` for Vite to expose them
- You may need to rebuild: `npm run build`

### Deployment Succeeds But App Shows Blank Page
- Check browser console for errors (Press F12)
- Verify all environment variables in `.env.production` are correct
- Make sure Firebase web app is registered in Firebase Console

### Google Sign-In Not Working
- Verify Google OAuth Client ID in `.env.production`
- Check that redirect URI in Google Cloud Console matches: `https://your-project-id.web.app/auth/callback`
- Verify Google provider is enabled in Firebase Console

---

## Future Deployments

After the initial setup, deploying updates is simple:

```bash
# Build the app
npm run build

# Deploy to Firebase
firebase deploy
```

Or in one command:
```bash
npm run build && firebase deploy
```

---

## Environment Variables Reference

| Variable | Source | Required |
|----------|--------|----------|
| `VITE_FIREBASE_API_KEY` | Firebase Console → Project Settings | ✓ |
| `VITE_FIREBASE_AUTH_DOMAIN` | Firebase Console → Project Settings | ✓ |
| `VITE_FIREBASE_PROJECT_ID` | Firebase Console → Project Settings | ✓ |
| `VITE_FIREBASE_STORAGE_BUCKET` | Firebase Console → Project Settings | ✓ |
| `VITE_FIREBASE_MESSAGING_SENDER_ID` | Firebase Console → Project Settings | ✓ |
| `VITE_FIREBASE_APP_ID` | Firebase Console → Project Settings | ✓ |
| `VITE_GOOGLE_OAUTH_CLIENT_ID` | Google Cloud Console → Credentials | ✓ |
| `VITE_GOOGLE_OAUTH_REDIRECT_URI` | Same domain as hosting URL | ✓ |
| `VITE_GEMINI_API_KEY` | Google AI Studio | Optional |

---

## What Was Set Up

✅ **firebase.json** - Hosting configuration with:
- React SPA routing (all routes → index.html)
- Caching rules (assets cached forever, index.html no-cache)

✅ **.firebaserc** - Project ID configuration (needs to be filled with your project ID)

✅ **.env.production** - Environment variables template (needs to be filled with your credentials)

✅ **dist/** - Production build (already created with `npm run build`)

---

## Next Steps

1. Follow steps 1-5 above
2. Run `firebase deploy`
3. Visit your live app at the Firebase Hosting URL
4. Test all features (create rubric, convert to CSV, upload to Canvas, etc.)

Good luck! 🚀
