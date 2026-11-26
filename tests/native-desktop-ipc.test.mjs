import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {createRequire} from "node:module";
import {fileURLToPath} from "node:url";
import vm from "node:vm";
const path=fileURLToPath(new URL("../apps/desktop/main.cjs",import.meta.url));
const source=readFileSync(path,"utf8");
const require=createRequire(path);
const BOOT="https://adminerva-org.github.io/Adminerva/desktop-session.html";
const LOGIN="https://adminerva-org.github.io/Adminerva/login.html?switch=1";
async function bootDesktop(){
 const ipc=new Map(),events=new Map(),dialogs=[],browserUrls=[],windows=[];
 let openCount=0,menu=null;
 class FakeWebContents {
  constructor(){
   this.mainFrame={};
   this.url="https://adminerva-org.github.io/Adminerva/guest-home.html";
   this.session={
    setPermissionRequestHandler:handler=>{this.requestPermission=handler;},
    setPermissionCheckHandler:handler=>{this.checkPermission=handler;}
   };
  }
  getURL(){return this.url;}
  setWindowOpenHandler(handler){this.windowOpen=handler;}
  on(name,handler){events.set(name,handler);}
  once(name,handler){events.set(name,handler);}
 }
 class FakeWindow{
  constructor(options){this.options=options;this.webContents=new FakeWebContents();this._closed=false;this._hidden=false;this.handlers=new Map();windows.push(this);}
  on(name,handler){this.handlers.set(name,handler);events.set("window:"+name,handler);}
  async loadURL(url){this.webContents.url=url;}
  show(){this._hidden=false;}
  hide(){this._hidden=true;}
  close(){this._closed=true;this.handlers.get("closed")?.();}
  isDestroyed(){return this._closed;}
  static getAllWindows(){return windows;}
 }
 const mock={
  app:{isPackaged:false,enableSandbox(){},whenReady(){return Promise.resolve()},on(){}},
  BrowserWindow:FakeWindow,
  shell:{async openExternal(url){browserUrls.push(url);}},
  Menu:{buildFromTemplate:items=>items,setApplicationMenu:items=>{menu=items;}},
  dialog:{async showMessageBox(_window,options){dialogs.push(options);return {response:0};}},
  ipcMain:{handle:(name,callback)=>ipc.set(name,callback)}
 };
 const localRequire=id=>id==="electron"?mock:id==="./update-check.cjs"?{checkUpdateStatus:async()=>({state:"no-newer-version-listed"}),DOWNLOAD_CENTER_URL:"https://adminerva-org.github.io/Adminerva/downloads.html"}:
  id==="./native-handoff-client.cjs"?{sendHandoff:async()=>{openCount++;throw Error("not enabled");}}:require(id);
 const ctx=vm.createContext({
  require:localRequire,__dirname:fileURLToPath(new URL("../apps/desktop/",import.meta.url)),
  process:{env:{ADMINERVA_ENABLE_DESKTOP_SIGNIN_UI:"true"},platform:"win32"},
  setTimeout,URL,console
 });
 vm.runInContext(source,ctx,{filename:path,timeout:5000});
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(windows.length,1);
 const win=windows[0],sender=win.webContents;
 const top={sender,senderFrame:sender.mainFrame};
 const frame={sender,senderFrame:{}};
 return {
  ipc,events,dialogs,browserUrls,windows,win,top,frame,ctx,
  get menu(){return menu;},
  get openCount(){return openCount;},
  setToken(value){vm.runInContext("pendingToken="+JSON.stringify(value)+";tokenConsumedForBootstrap=false",ctx);},
  read(expr){return vm.runInContext(expr,ctx)}
 };
}
test("native Electron sign-in IPC only returns one token to its trusted bootstrap frame",async()=>{
 const h=await bootDesktop();
 const consume=h.ipc.get("adminerva:consume-signin-token");
 const confirm=h.ipc.get("adminerva:confirm-signin");
 assert.equal(typeof consume,"function");
 assert.equal(confirm(h.top),false);
 assert.equal(consume(h.top),null);
 h.setToken("test-only-custom-token");
 assert.equal(consume(h.top),null,"cannot consume credentials on a guest page");
 h.win.webContents.url=BOOT;
 assert.equal(consume(h.frame),null,"subframes cannot receive native tokens");
 assert.equal(confirm(h.frame),false);
 assert.equal(consume(h.top),"test-only-custom-token");
 assert.equal(consume(h.top),null,"token cannot be redeemed twice");
 assert.equal(confirm(h.top),true);
 assert.equal(confirm(h.top),false,"cannot replay approval");
 assert.equal(h.read("allowPrivate"),true);
 assert.equal(h.read("pendingToken"),null);
 assert.equal(h.read("tokenConsumedForBootstrap"),false);
});
test("canceled or reloaded pairing cannot grant private navigation",async()=>{
 const h=await bootDesktop(),consume=h.ipc.get("adminerva:consume-signin-token");
 const confirm=h.ipc.get("adminerva:confirm-signin");
 h.setToken("test-only-custom-token");
 h.win.webContents.url=BOOT;
 assert.equal(consume(h.top),"test-only-custom-token");
 h.menu[0].submenu[1].click();
 assert.equal(confirm(h.top),false);
 assert.equal(h.read("allowPrivate"),false);
 h.setToken("another-test-token");
 assert.equal(consume(h.top),"another-test-token");
 h.events.get("did-start-navigation")({url:BOOT,isMainFrame:true,isSameDocument:false});
 assert.equal(confirm(h.top),false);
});
test("authenticated Studio workspace blocks native account switching until safe sign-out",async()=>{
 const h=await bootDesktop();
 vm.runInContext("allowPrivate=true",h.ctx);
 h.menu[0].submenu[0].click();
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(h.openCount,0,"no new pairing should be created");
 assert.equal(h.dialogs.length,1);
 assert.match(h.dialogs[0].detail,/Finish saving your Studio work/);
 const details={url:LOGIN,preventDefault(){this.blocked=true;}};
 h.events.get("will-navigate")(details);
 assert.equal(h.read("allowPrivate"),false,"navigating to sign-in must revoke private routing");
 assert.equal(details.blocked,true,"sign-in remains in the system browser");
 assert.equal(h.win.webContents.checkPermission(),false);
 assert.equal(h.win.webContents.windowOpen({url:"file:///etc/passwd"}).action,"deny");
});

test("sign-out revokes private desktop navigation and clears the prior learner's workspace",async()=>{
 const h=await bootDesktop();
 const ended=h.ipc.get("adminerva:session-ended");
 assert.equal(typeof ended,"function");
 assert.equal(await ended(h.frame),false,"subframe may not change authentication state");
 h.win.webContents.url="https://evil.example/forged.html";
 assert.equal(await ended(h.top),false,"unapproved origin cannot report sign-out");
 h.win.webContents.url="https://adminerva-org.github.io/Adminerva/student-playground.html";
 vm.runInContext("allowPrivate=true",h.ctx);
 assert.equal(await ended(h.top),true);
 assert.equal(h.read("allowPrivate"),false);
 const guest=h.windows.at(-1);
 assert.notEqual(guest,h.win);
 assert.equal(guest.webContents.url,"https://adminerva-org.github.io/Adminerva/guest-home.html");
 assert.equal(guest.options.webPreferences.partition,"persist:adminerva-public-preview");
 assert.equal(h.win.isDestroyed(),true);
 assert.equal(h.win._hidden,true);
 assert.equal(await ended(h.top),false,"replayed sign-out is harmless");
});

test("native desktop auth stays window-session scoped while browser login remains persistent",()=>{
 const firebase=readFileSync(new URL("../js/core/firebase-core.js",import.meta.url),"utf8");
 const preload=readFileSync(new URL("../apps/desktop/preload-auth-dev.cjs",import.meta.url),"utf8");
 assert.match(firebase,/desktopSession\?\[browserSessionPersistence\]/);
 assert.match(firebase,/\[indexedDBLocalPersistence, browserLocalPersistence, browserSessionPersistence\]/);
 assert.match(firebase,/observedUid=null/);
 assert.match(firebase,/desktopBridge\.reportSignedOut\(\)/);
 assert.match(preload,/reportSignedOut:\(\)=>ipcRenderer\.invoke\("adminerva:session-ended"\)/);
 assert.match(source,/ipcMain\.handle\("adminerva:session-ended"/);
 assert.match(source,/createWindow\(\);/);
});

test("Studio logout and leave guards refuse to abandon unconfirmed code",()=>{
 const project=readFileSync(new URL("../js/student/project-studio.mjs",import.meta.url),"utf8");
 const nav=readFileSync(new URL("../js/core/adminerva-nav.js",import.meta.url),"utf8");
 assert.match(project,/window\.addEventListener\("adminerva:before-signout",event=>/);
 assert.match(project,/window\.addEventListener\("beforeunload",event=>/);
 assert.match(project,/saveState\(captureState\(\)\)/);
 assert.match(project,/cloudPending\.size>0\|\|cloudWrites\.size>0\|\|unbackedProjectIds\.size>0/);
 assert.match(project,/setCloudStatus\("Cloud save pending/);
 assert.match(nav,/dispatchEvent\(new CustomEvent\("adminerva:before-signout",\{cancelable:true\}\)\)/);
 assert.match(nav,/event\.stopPropagation\(\)/);
 assert.match(nav,/button\.disabled=false/);
 assert.match(nav,/await signOut\(getAuth\(\)\)/);
 // Do not continue to login via finally after a Firebase sign-out failure.
 assert.doesNotMatch(nav,/finally\s*\{[\s\S]{0,200}window\.location\.href\s*=\s*"login.html"/);
});

test("unsigned packaged application cannot enable the developer credential bridge",async()=>{
 const s=readFileSync(new URL("../apps/desktop/main.cjs",import.meta.url),"utf8");
 const bundle=JSON.parse(readFileSync(new URL("../apps/desktop/package.json",import.meta.url),"utf8"));
 assert.match(s,/const DEV_SIGNIN=!app\.isPackaged/);
 assert.match(s,/DEV_SIGNIN\?"preload-auth-dev\.cjs":"preload\.cjs"/);
 assert.match(s,/schoolUserPartition\(accountUid\)/);
 assert.equal(bundle.build.files.includes("preload-auth-dev.cjs"),false);
 assert.equal(bundle.build.files.includes("native-handoff-client.cjs"),false);
 assert.equal(bundle.build.files.includes("native-auth-protocol.cjs"),false);
});

test("a failed school-role bootstrap also leaves its isolated account partition",async()=>{
 const h=await bootDesktop();
 h.win.webContents.url=BOOT;
 const report=h.ipc.get("adminerva:session-ended");
 assert.equal(await report(h.top),false);
 const guest=h.windows.at(-1);
 assert.notEqual(guest,h.win);
 assert.equal(guest.webContents.url,"https://adminerva-org.github.io/Adminerva/guest-home.html");
 assert.equal(guest.options.webPreferences.partition,"persist:adminerva-public-preview");
 assert.equal(h.win.isDestroyed(),true);
});
