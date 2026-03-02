# Firebase Setup Checklist ✓

## Quick Deployment Steps (5-10 minutes)

- [ ] **Step 1**: Create Firebase project at https://console.firebase.google.com
- [ ] **Step 2**: Run `firebase login` in terminal
- [ ] **Step 3**: Copy Firebase project ID to `.firebaserc`
- [ ] **Step 4**: Get Firebase web config and fill `.env.production`
- [ ] **Step 5**: Get Google OAuth Client ID and add to `.env.production`
- [ ] **Step 6**: Run `firebase deploy`
- [ ] **Step 7**: Test app at the Firebase Hosting URL
- [ ] **Step 8**: Enable Google provider in Firebase Authentication

---

## What's Already Done ✅

- [x] App built for production (`npm run build`)
- [x] `firebase.json` created with proper hosting config
- [x] `.firebaserc` template created
- [x] `.env.production` template created
- [x] `FIREBASE_DEPLOYMENT.md` guide created
- [x] Vite config supports environment variables
- [x] Production build ready (`dist/` folder)

---

## What You Need to Do

### 1. Firebase Setup (2 min)
```bash
firebase login
# Then update .firebaserc with your project ID
```

### 2. Get Credentials (3 min)
- Firebase Web Config → `.env.production`
- Google OAuth Client ID → `.env.production`

### 3. Deploy (1 min)
```bash
firebase deploy
```

---

## Files Created

| File | Purpose |
|------|---------|
| `firebase.json` | Firebase Hosting configuration |
| `.firebaserc` | Firebase project ID config (needs your project ID) |
| `.env.production` | Environment variables for production (needs your credentials) |
| `FIREBASE_DEPLOYMENT.md` | Detailed deployment guide |
| `dist/` | Production-ready app (already built) |

---

## Key URLs

- **Firebase Console**: https://console.firebase.google.com
- **Google Cloud Console**: https://console.cloud.google.com
- **Google AI Studio** (Gemini): https://aistudio.google.com

---

## After Deployment

Your app will be live at:
```
https://YOUR_PROJECT_ID.web.app
```

Example: `https://rubric-app-12345.web.app`

---

## For Future Updates

```bash
# Whenever you make changes to the code:
npm run build       # Rebuild the app
firebase deploy     # Deploy to Firebase
```

---

## Need Help?

See `FIREBASE_DEPLOYMENT.md` for detailed instructions and troubleshooting.
