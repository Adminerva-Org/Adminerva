/* Adminerva Firebase Cloud Messaging service worker. */
importScripts("https://www.gstatic.com/firebasejs/13.0.0/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/13.0.0/firebase-messaging-compat.js");

firebase.initializeApp({
  apiKey: "AIzaSyDQsL9O5YlizeFA2iFJLt_5hY5V7xfM_qU",
  authDomain: "reporeview-e7ca4.firebaseapp.com",
  projectId: "reporeview-e7ca4",
  storageBucket: "reporeview-e7ca4.firebasestorage.app",
  messagingSenderId: "902176956124",
  appId: "1:902176956124:web:46d07f47ccbab034e15e19",
  measurementId: "G-XPXLNGZCY2"
});

firebase.messaging();
