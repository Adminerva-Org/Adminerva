/** Shared Firebase application, authentication and Firestore initialization. */
// js/core/firebase-core.js
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js";
import { initializeAuth, indexedDBLocalPersistence, browserLocalPersistence, browserSessionPersistence, browserPopupRedirectResolver, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
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

// The future Electron client runs on shared school computers. Its signed-in
// Firebase account belongs to this *window* only, while local Studio recovery
// drafts remain in the existing persistent storage until cloud-confirmed.
// Browser/PWA sessions retain the existing persistence behavior unchanged.
const desktopBridge=window.adminervaClient;
const desktopSession=desktopBridge?.kind==="desktop"&&
  desktopBridge?.protocol===1&&typeof desktopBridge?.reportSignedOut==="function";
// Initialize Firebase exactly once
const app = initializeApp(firebaseConfig);
const auth = initializeAuth(app, {
  persistence: desktopSession?[browserSessionPersistence]:
    [indexedDBLocalPersistence, browserLocalPersistence, browserSessionPersistence],
  popupRedirectResolver: browserPopupRedirectResolver,
});
const db = getFirestore(app);
// A lost or explicitly signed-out Firebase session revokes native access
// immediately. The IPC is revoke-only; it cannot grant a school role or
// navigate to a protected route.
if(desktopSession){
  let observedUid=null;
  onAuthStateChanged(auth,user=>{
    if(user?.uid){observedUid=user.uid;return;}
    if(!observedUid)return; // A signed-out bootstrap must not cancel pairing.
    observedUid=null;
    try{void desktopBridge.reportSignedOut().catch(()=>{});}catch{}
  });
}

// Export for module imports
export { app, auth, db };

// Attach to global window object for legacy script compatibility
window.db = db;
window.auth = auth;
