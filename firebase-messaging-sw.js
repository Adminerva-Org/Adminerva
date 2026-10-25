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

const messaging=firebase.messaging();

messaging.onBackgroundMessage(payload=>{
  const data=payload?.data||{};
  if(!data.adminervaKind)return;
  const test=data.adminervaKind==="test_ping";
  const tag=test?"adminerva-test-ping":String(data.tag||("adminerva-"+(data.type||"notice")+"-"+(data.sourceId||"event"))).slice(0,120);
  const shown=self.registration.showNotification(data.title||(test?"Adminerva test notification":"Adminerva"),{
    body:data.body||(test?"Push notifications are working on this device.":"You have a new Adminerva notification."),
    icon:"assets/adminerva-emblem-192.png",
    badge:"assets/adminerva-notification-badge.png",
    tag,
    renotify:true,
    data:{
      target:data.target||"student-home.html",
      adminervaKind:data.adminervaKind,
      type:data.type||"notice",
      sourceId:data.sourceId||""
    }
  });
  if(!test)return shown;
  const closeAfter=Math.min(30000,Math.max(5000,Number(data.autoCloseMs)||15000));
  return shown.then(()=>new Promise(resolve=>setTimeout(resolve,closeAfter)))
    .then(()=>self.registration.getNotifications({tag}))
    .then(notifications=>{for(const notification of notifications)notification.close();});
});

self.addEventListener("notificationclick",event=>{
  const target=event.notification?.data?.target;
  if(!target)return;
  event.notification.close();
  event.waitUntil(clients.openWindow(target));
});
