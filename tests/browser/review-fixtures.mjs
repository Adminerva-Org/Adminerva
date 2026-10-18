export const ownSha="a".repeat(40);
export const groupSha="b".repeat(40);
export const repository="https://github.com/fixture-group/android";
export const welcomePath="app/src/main/res/layout/welcome.xml";
export const homePath="app/src/main/res/layout/home.xml";
export const password="local-emulator-fixture-only";
export const accounts={
  teacher:{uid:"fixture-teacher",email:"josephsixson@mcstayuman.edu.ph"},
  alice:{uid:"fixture-alice",email:"fixture-alice@example.test"},
  bob:{uid:"fixture-bob",email:"fixture-bob@example.test"}
};
export const assessment={
  schemaVersion:2,evidenceMode:"commit_selection",checkpointMode:"individual",
  title:"Q3 Fixture UI Prototype",quarter:"Q3",type:"Mini PETA",maxScore:20,
  targetPaths:["**/res/layout/*.xml"],expectedExtensions:["xml"],
  createdAt:new Date("2026-01-01T00:00:00Z"),
  deployments:[{section:"fixture-11-A",postDate:new Date("2026-01-01T00:00:00Z"),deadlineEnabled:false}],
  taskContext:"Group prototype with three screens. Alice implements welcome; Bob implements home; a third member implements the feature screen.",
  evalCriteria:"1. UI Completeness — 5 Points\n2. XML & Technical Implementation — 5 Points\n3. Design & Usability — 5 Points\n4. Project Compliance — 5 Points"
};
const contents={
  [welcomePath]:'<LinearLayout xmlns:android="http://schemas.android.com/apk/res/android" android:layout_width="match_parent" android:layout_height="match_parent"><TextView android:text="Welcome" android:layout_width="wrap_content" android:layout_height="wrap_content"/></LinearLayout>',
  [homePath]:'<LinearLayout xmlns:android="http://schemas.android.com/apk/res/android" android:layout_width="match_parent" android:layout_height="match_parent"><TextView android:text="Group home screen" android:layout_width="wrap_content" android:layout_height="wrap_content"/></LinearLayout>'
};
function commit(sha){
  const own=sha===ownSha,path=own?welcomePath:homePath;
  return {sha,parents:own?[]:[{sha:ownSha}],author:{login:own?"fixture-alice":"fixture-bob"},
    commit:{message:own?"Implement welcome screen":"Implement shared home screen",author:{name:own?"Alice":"Bob",date:"2026-01-02T00:00:00Z"}},
    files:[{filename:path,status:"added",patch:"@@ -0,0 +1 @@\n+"+contents[path]}]};
}
export function githubFixture(url){
  const parsed=new URL(url),route=parsed.pathname;
  if(route==="/repos/fixture-group/android")return {default_branch:"main",full_name:"fixture-group/android"};
  if(route.endsWith("/commits"))return parsed.searchParams.get("sha")===ownSha?[commit(ownSha)]:[commit(groupSha),commit(ownSha)];
  if(route.endsWith("/commits/"+ownSha))return commit(ownSha);
  if(route.endsWith("/commits/"+groupSha))return commit(groupSha);
  if(route.includes("/git/trees/"))return {truncated:false,tree:Object.keys(contents).map(path=>({type:"blob",path}))};
  if(route.includes("/contents/")){
    const path=decodeURIComponent(route.split("/contents/")[1]);
    if(!contents[path])throw Error("Unexpected fixture file: "+path);
    if(parsed.searchParams.get("ref")!==groupSha)throw Error("Source was not pinned to the approved checkpoint.");
    return {type:"file",encoding:"base64",content:Buffer.from(contents[path]).toString("base64")};
  }
  throw Error("Unexpected GitHub fixture request: "+route);
}
export const providerDraft={
  criteria:[4,5,null,4].map(score=>score===null?
    {status:"needs_teacher_review",score:null,evidence:[],rationale:"Visual quality requires direct teacher observation before scoring."}:
    {status:"supported",score,evidence:[{sha:ownSha,path:welcomePath}],rationale:"Verified welcome-screen implementation meets the student's documented responsibility."}),
  feedback:"The assigned welcome screen is demonstrated. The teacher must check visual quality and runtime behavior directly.",
  limitations:"Individual attribution was teacher verified. Build and runtime behavior were not executed.",
  projectObservations:"Two of three shared group screens are present. The missing feature screen is assigned to another member and does not lower Alice's individual score."
};
