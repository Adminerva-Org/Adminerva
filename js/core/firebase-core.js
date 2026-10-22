/** Shared Firebase application, authentication and Firestore initialization. */
// js/core/firebase-core.js
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js";
import { initializeAuth, indexedDBLocalPersistence, browserLocalPersistence, browserSessionPersistence, browserPopupRedirectResolver } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyDQsL9O5YlizeFA2iFJLt_5hY5V7xfM_qU",
  authDomain: "reporeview-e7ca4.firebaseapp.com",
  projectId: "reporeview-e7ca4",
  storageBucket: "reporeview-e7ca4.firebasestorage.app",
  messagingSenderId: "902176956124",
  appId: "1:902176956124:web:46d07f47ccbab034e15e19",
  measurementId: "G-XPXLNGZCY2",
};

// Initialize Firebase exactly once
const app = initializeApp(firebaseConfig);
const auth = initializeAuth(app, {
  persistence: [indexedDBLocalPersistence, browserLocalPersistence, browserSessionPersistence],
  popupRedirectResolver: browserPopupRedirectResolver,
});
const db = getFirestore(app);

// Export for module imports
export { app, auth, db };

// Attach to global window object for legacy script compatibility
window.db = db;
window.auth = auth;
