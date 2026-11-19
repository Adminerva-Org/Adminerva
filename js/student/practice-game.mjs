/** One public mission map. Authenticated submissions and every point are checked by the server. */
import {auth,db} from "../core/firebase-core.js?v=1.3.0";
import {onAuthStateChanged} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import {collection,query,orderBy,limit,onSnapshot} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import {COURSES,hashSeed} from "./practice-courses.mjs?v=1.5.0";
import {PROGRAMMING_GAMES,getProgrammingGame,programmingGameMatches,gameDeviceLabel} from "./practice-games.mjs?v=1.4.0";
import {PRACTICE_SEASON,DIFFICULTIES,missionMeta,seasonActivity,publicActivity} from "./practice-season.mjs?v=1.5.0";
import {resumePracticeSession,activePracticeSession,resetPracticeSession,practiceRequest,practiceSchoolRequest,resolvePracticeContext} from "./practice-session.mjs?v=1.5.0";
import {practiceBridgeKey} from "./practice-playground-bridge.mjs?v=1.3.0";
const field=id=>document.getElementById(id),guestPage=document.body.dataset.practiceAccess==="public";
const typeNames=guestPage?{choice:"Choose the answer",output:"Write the output",ordering:"Build the sequence",matching:"Match the pairs",debugging:"Fix the bug"}:{choice:"Quick Pick",output:"Code Trace",ordering:"Code Builder",matching:"Logic Match",debugging:"Bug Hunt"},typeIcons={choice:"◉",output:"⌨",ordering:"⇅",matching:"⇄",debugging:"⌁"};
const initialGame=getProgrammingGame(new URLSearchParams(location.search).get("game"));
const TOTAL_MISSIONS=COURSES.reduce((sum,entry)=>sum+entry.missions.length,0);
let user=null,eligible=false,accountPreview=false,hub={},course=COURSES[0],activeGame=initialGame.external||guestPage&&initialGame.id==="challenge-arena"?"all":initialGame.id,mission=null,attempt=null,answer=null,busy=false,epoch=0,loadSequence=0,pending=null,boardMode="global",globalRows=[],publicBoardReady=false,publicBoardError=false,assignedPacks=[],hintLevel=0,builderSelection=null,bugLineFound=false;
function node(tag,text,className=""){const item=document.createElement(tag);if(text!==undefined)item.textContent=text;item.className=className;return item;}
function localGet(key){try{return JSON.parse(sessionStorage.getItem(key)||"null");}catch{return null;}}
function localSet(key,value){try{if(value===null)sessionStorage.removeItem(key);else sessionStorage.setItem(key,JSON.stringify(value));return true;}catch{return false;}}
const owner=()=>user?.uid||"public-visitor-v1",pendingKey=()=>"Adminerva_Season_Pending_"+owner(),draftKey=()=>"Adminerva_Season_Draft_"+owner()+"_"+(mission?.id||""),resumeKey=()=>"Adminerva_Games_Resume_"+owner(),traceScratchKey=()=>"Adminerva_Games_TraceScratch_"+owner()+"_"+(mission?.id||"");
function persistentGet(key){try{return JSON.parse(localStorage.getItem(key)||"null");}catch{return null;}}
function persistentSet(key,value){try{if(value===null)localStorage.removeItem(key);else localStorage.setItem(key,JSON.stringify(value));return true;}catch{return false;}}
const sprintKey=()=>"Adminerva_Games_Sprint_"+PRACTICE_SEASON+"_"+owner();
function sprintState(){
  const saved=localGet(sprintKey())||{};
  return {done:Math.max(0,Math.min(5,Number(saved.done)||0)),streak:Math.max(0,Number(saved.streak)||0),startedAt:Number(saved.startedAt)||Date.now()};
}
function saveSprint(state){localSet(sprintKey(),state);}
function resetSprint(){saveSprint({done:0,streak:0,startedAt:Date.now()});renderSprintHud();}
function renderSprintHud(){
  const hud=field("gamesSprintHud");if(!hud)return;
  const active=!guestPage&&field("practiceMissionPanel")?.dataset.game==="code-sprint";hud.hidden=!active;if(!active)return;const graphic=field("gamesSprintGraphic");if(graphic&&!graphic.childElementCount)graphic.append(gameGlyph("sprint"));
  const state=sprintState(),round=Math.min(5,state.done+1);field("gamesSprintRound").textContent=state.done>=5?"Sprint complete":"Round "+round+" / 5";field("gamesSprintStreak").textContent="Streak "+state.streak;
  [...field("gamesSprintPips").children].forEach((pip,index)=>{pip.classList.toggle("is-complete",index<state.done);pip.classList.toggle("is-current",index===state.done&&state.done<5);pip.textContent=index<state.done?"✓":String(index+1);});
  field("gamesSprintReset").hidden=state.done<5;
}
function sprintCorrect(){
  const state=sprintState();if(state.done>=5)return;state.done++;state.streak++;saveSprint(state);renderSprintHud();
}
function sprintMiss(){
  const state=sprintState();if(!state.streak)return;state.streak=0;saveSprint(state);renderSprintHud();
}
function saveDraft(){if(mission)localSet(draftKey(),{answer});}
function sync(message,tone="ready"){field("labSync").textContent=message;field("labSync").dataset.tone=tone;}
function notice(message,tone="info"){field("labNoticeText").textContent=message;field("labNotice").hidden=!message;field("labNotice").dataset.tone=tone;}
function feedback(message,tone="info"){field("practiceFeedback").textContent=message;field("practiceFeedback").dataset.tone=tone;field("practiceFeedback").hidden=!message;}
function setBusy(value){busy=value;field("practiceMissionPanel").setAttribute("aria-busy",String(value));for(const id of ["practiceCheckBtn","practiceBackBtn","practiceReconnectBtn","practiceTransferBtn","practiceSyncBtn","labPreferencesSave","labNextMission","labHintBtn"])field(id).disabled=value;field("practiceClass").disabled=value||!(hub.classes||[]).length;for(const control of field("practiceChoices").querySelectorAll("input,select,button"))control.disabled=value||!!pending||control.dataset.boundary==="true";field("practiceCheckBtn").textContent=value?(pending?"Saving…":"Please wait…"):pending?"Retry save":attempt?.completed?"Check replay":"Submit answer";field("practiceCheckBtn").disabled=value||!eligible||!attempt?.attemptId;}
function completed(id){return (hub.courses||[]).some(row=>row.completed?.includes(id));}
function earned(id){for(const row of hub.courses||[])if(row.missionScores?.[id]!==undefined)return row.missionScores[id];return 0;}
function renderSummary(){
  const points=hub.points||0,count=hub.completedCount||0,level=1+Math.floor(points/250);
  field("practiceOverview").replaceChildren(...[[points.toLocaleString(),"Skill XP"],[count+" / "+TOTAL_MISSIONS,"Missions"],["Level "+level,"Season level"]].map(([value,label])=>{const item=node("div",undefined,"lab-stat");item.append(node("strong",value),node("span",label));return item;}));
  field("labPreviousProgress").textContent=hub.legacyCount?hub.legacyCount+" earlier missions are preserved.":"Practice XP stays separate from school grades.";
  field("labIdentity").textContent=user?user.displayName||hub.alias||"Signed-in learner":"Public visitor";
  field("labAccountLink").textContent=user?"My workspace":"Sign in";field("labAccountLink").href=user?(guestPage?"guest-home.html":"student-home.html"):"login.html";
  field("labPreferences").hidden=!eligible;field("labPreferencesSignin").hidden=eligible||accountPreview;
  if(document.activeElement!==field("labAlias"))field("labAlias").value=hub.alias||"";
  field("labOptIn").checked=hub.optIn===true;
  const select=field("practiceClass"),selected=hub.classId||"";select.replaceChildren();
  for(const profile of hub.classes||[])select.add(new Option(profile.section,profile.id));select.disabled=!(hub.classes||[]).length;select.hidden=!(hub.classes||[]).length;select.value=selected;
  field("labClassHint").textContent=(hub.classes||[]).length?"Only your class sees this private class board.":"Your class board appears when your school links a student section.";
  renderHubHero();
}
function assignedMissionRefs(){
  return new Set(assignedPacks.flatMap(pack=>Array.isArray(pack.missionRefs)?pack.missionRefs:[]).map(String));
}
function assignedChallengeTarget(){
  const packs=[...assignedPacks].sort((a,b)=>{
    const toTime=value=>{const source=typeof value?.toDate==="function"?value.toDate():value,time=new Date(source||0).getTime();return Number.isFinite(time)&&time>0?time:Number.MAX_SAFE_INTEGER;};
    return toTime(a.dueDate)-toTime(b.dueDate);
  });
  for(const pack of packs){
    for(const ref of pack.missionRefs||[]){
      const [courseId,missionId]=String(ref).split(":"),entry=COURSES.find(item=>item.id===courseId),target=entry?.missions.find(item=>item.id===missionId);
      if(entry&&target&&!completed(target.id))return {course:entry,mission:target,challenge:true,challengeTitle:pack.title||"Teacher Challenge"};
    }
  }
  return null;
}
function weakestSkillTarget(){
  const groups=[
    {label:"OOP",entries:COURSES.flatMap(entry=>entry.id==="java"?entry.missions.filter(item=>item.oop===true).map(mission=>({course:entry,mission})):[])},
    {label:"Debugging",entries:COURSES.flatMap(entry=>entry.missions.filter(item=>missionMeta(entry,item).type==="debugging").map(mission=>({course:entry,mission})))},
    {label:"Logic",entries:COURSES.flatMap(entry=>entry.id==="logic"?entry.missions.map(mission=>({course:entry,mission})):[])}
  ].map(group=>({...group,done:group.entries.filter(({mission})=>completed(mission.id)).length}))
   .filter(group=>group.entries.some(({mission})=>!completed(mission.id)))
   .sort((a,b)=>(a.done/Math.max(1,a.entries.length))-(b.done/Math.max(1,b.entries.length)));
  const group=groups[0],target=group?.entries.find(({mission})=>!completed(mission.id));
  return target?{...target,recommendation:group.label}:null;
}
function featuredTarget(){
  const last=hub.resume?.courseId&&hub.resume?.missionId?hub.resume:persistentGet(resumeKey());
  if(last?.courseId&&last?.missionId){
    const lastCourse=COURSES.find(entry=>entry.id===last.courseId),lastMission=lastCourse?.missions.find(item=>item.id===last.missionId);
    if(lastCourse&&lastMission&&!completed(lastMission.id)&&gameMissions(lastCourse).some(item=>item.id===lastMission.id))return {course:lastCourse,mission:lastMission,resume:true};
  }
  if(activeGame==="challenge-arena"){
    const challenge=assignedChallengeTarget();if(challenge)return challenge;
  }
  if(activeGame==="all"){
    const challenge=assignedChallengeTarget();if(challenge)return challenge;
    if((hub.completedCount||0)>0){const recommended=weakestSkillTarget();if(recommended)return recommended;}
  }
  const ordered=[course,...COURSES.filter(entry=>entry.id!==course.id)];
  for(const entry of ordered){
    const pool=gameMissions(entry);
    if(!pool.length)continue;
    return {course:entry,mission:pool.find(item=>!completed(item.id))||pool[0],resume:false};
  }
  return null;
}
function dailyQuestState(){
  const target=3,server=hub.dailyQuest;
  if(server&&Number.isFinite(Number(server.done))&&Number.isFinite(Number(server.target)))
    return {done:Math.max(0,Math.min(Number(server.target),Number(server.done))),target:Number(server.target),date:server.date||""};
  if(!Object.prototype.hasOwnProperty.call(hub,"completedCount"))return {done:0,target};
  const now=new Date(),day=[now.getFullYear(),String(now.getMonth()+1).padStart(2,"0"),String(now.getDate()).padStart(2,"0")].join("-");
  const key="Adminerva_Games_DailyQuest_"+(hub.season||"season")+"_"+owner()+"_"+day,count=hub.completedCount||0;
  let baseline=null;
  try{const saved=Number(localStorage.getItem(key));if(Number.isFinite(saved))baseline=saved;}catch{}
  if(baseline===null){baseline=count;try{localStorage.setItem(key,String(count));}catch{}}
  return {done:Math.max(0,Math.min(target,count-baseline)),target};
}
function progressBreakdown(){
  const entries=COURSES.flatMap(entry=>entry.missions.map(mission=>({course:entry,mission})));
  const ratio=predicate=>{const pool=entries.filter(({course,mission})=>predicate(course,mission));if(!pool.length)return 0;return Math.round(pool.filter(({mission})=>completed(mission.id)).length/pool.length*100);};
  return [
    {id:"labProgressLogic",label:"Logic",value:ratio(course=>course.id==="logic")},
    {id:"labProgressDebug",label:"Debugging",value:ratio((course,mission)=>missionMeta(course,mission).type==="debugging")},
    {id:"labProgressOop",label:"OOP",value:ratio((course,mission)=>course.id==="java"&&mission.oop===true)}
  ];
}
function renderHubHero(){
  const title=field("labHeroTitle");if(!title)return;
  const count=hub.completedCount||0,points=hub.points||0,total=Math.max(1,TOTAL_MISSIONS);
  const progress=Math.max(0,Math.min(100,Math.round(count/total*100))),level=1+Math.floor(points/250),levelProgress=Math.max(0,Math.min(100,Math.round((points%250)/250*100)));
  const target=featuredTarget(),game=getProgrammingGame(activeGame);
  field("labHeroMode").textContent=target?.resume?"Resume mission":target?.challenge?"Teacher Challenge":target?.recommendation?"Recommended · "+target.recommendation:game.name;
  title.textContent=target?target.mission.title.replace(/ · (Guided|Apply|Challenge)$/,""):"Programming missions";
  field("labHeroSub").textContent=target?(target.challenge?(target.challengeTitle+" · "+target.course.name):(target.course.name+" · "+typeNames[missionMeta(target.course,target.mission).type])):"Choose a game and start a mission.";
  field("labHeroProgress").style.width=progress+"%";field("labHeroProgressText").textContent=progress+"%";
  const button=field("labHeroContinue");button.disabled=!target;button.dataset.course=target?.course.id||"";button.dataset.mission=target?.mission.id||"";button.querySelector("span:last-child").textContent=target?.resume?"Resume":target?.challenge?"Play Challenge":target&&completed(target.mission.id)?"Replay":"Continue";
  field("labLevelText").textContent="Lv. "+level;field("labLevelPoints").textContent=(points%250)+" / 250 XP";field("labLevelProgress").style.width=levelProgress+"%";
  const debugDone=COURSES.flatMap(entry=>entry.missions.filter(item=>missionMeta(entry,item).type==="debugging")).filter(item=>completed(item.id)).length;
  const oopDone=COURSES.find(entry=>entry.id==="java")?.missions.filter(item=>item.oop===true&&completed(item.id)).length||0;
  field("labBadgeStarter").classList.toggle("is-earned",count>=1);
  field("labBadgeExplorer").classList.toggle("is-earned",debugDone>=5);
  field("labBadgeMaster").classList.toggle("is-earned",oopDone>=10);
  const daily=dailyQuestState();field("labDailyQuestText").textContent=daily.done+" / "+daily.target+" missions";
  [...field("labDailyQuestPips").children].forEach((pip,index)=>{const done=index<daily.done;pip.classList.toggle("is-complete",done);pip.textContent=done?"✓":String(index+1);});
  for(const item of progressBreakdown()){const ring=field(item.id);ring.style.setProperty("--value",String(item.value));ring.setAttribute("aria-label",item.label+" "+item.value+" percent");ring.querySelector("strong").textContent=item.value+"%";}
}
function formatChallengeDue(value){
  if(!value)return "";
  const source=typeof value?.toDate==="function"?value.toDate():value,date=new Date(source);if(Number.isNaN(date.getTime()))return "";
  return "Due "+date.toLocaleDateString(undefined,{month:"short",day:"numeric"});
}
function renderChallenges(){
  const list=field("gamesChallengeList"),count=field("gamesChallengeCount");if(!list||!count)return;
  list.replaceChildren();count.textContent=assignedPacks.length?assignedPacks.length+" active":"None assigned";const nav=field("gamesChallengesNav");if(nav){nav.dataset.count=assignedPacks.length?String(Math.min(99,assignedPacks.length)):"";nav.classList.toggle("has-count",assignedPacks.length>0);}
  if(!assignedPacks.length){
    const empty=node("div",undefined,"games-challenge-empty");empty.append(node("span","✓","games-challenge-empty-icon"),node("span","No teacher challenges right now."));list.append(empty);return;
  }
  for(const pack of assignedPacks){
    const refs=(pack.missionRefs||[]).map(value=>{const [courseId,missionId]=String(value).split(":");const entry=COURSES.find(item=>item.id===courseId),target=entry?.missions.find(item=>item.id===missionId);return entry&&target?{course:entry,mission:target}:null;}).filter(Boolean);
    const done=refs.filter(ref=>completed(ref.mission.id)).length,total=refs.length,percent=total?Math.round(done/total*100):0,next=refs.find(ref=>!completed(ref.mission.id))||refs[0];
    const card=node("article",undefined,"games-challenge-card"),head=node("div",undefined,"games-challenge-head"),text=node("div"),title=node("strong",pack.title||"Teacher Challenge"),meta=node("small",[done+" / "+total+" missions",formatChallengeDue(pack.dueDate)].filter(Boolean).join(" · "));text.append(title,meta);head.append(text,node("span",done===total&&total?"✓":"✦","games-challenge-icon"));
    const meter=node("div",undefined,"games-meter"),fill=node("span");fill.style.width=percent+"%";meter.append(fill);card.append(head,meter);
    if(next){const button=node("button",done===total&&total?"Review":"Continue","games-challenge-button");button.type="button";button.addEventListener("click",()=>{if(busy)return;activeGame="challenge-arena";course=next.course;const url=new URL(location.href);url.searchParams.set("game","challenge-arena");url.searchParams.set("course",course.id);url.searchParams.set("mission",next.mission.id);history.replaceState(null,"",url);renderCourses();void openMission(next.course,next.mission);});card.append(button);}
    list.append(card);
  }
}
window.addEventListener("adminerva:practice-packs",event=>{
  assignedPacks=Array.isArray(event.detail?.packs)?event.detail.packs:[];
  renderChallenges();
  renderCourses();
  renderHubHero();
});
function returnToGamesHub(){
  if(busy)return false;
  saveDraft();loadSequence++;field("practiceMissionPanel").hidden=true;field("labMapPanel").hidden=false;renderCourses();return true;
}
function celebrateMission(){
  if(guestPage||matchMedia("(prefers-reduced-motion: reduce)").matches)return;
  const layer=field("gamesCelebrationLayer");if(!layer)return;
  layer.replaceChildren();layer.classList.remove("is-active");
  const symbols=["◆","✦","◇","•"];
  for(let index=0;index<16;index++){
    const spark=node("span",symbols[index%symbols.length]);spark.style.setProperty("--x",((index%8)-3.5)*24+"px");spark.style.setProperty("--y",(-45-(index%5)*15)+"px");spark.style.setProperty("--delay",(index%4)*24+"ms");spark.style.setProperty("--spin",(index%2?1:-1)*(80+(index%5)*35)+"deg");layer.append(spark);
  }
  requestAnimationFrame(()=>layer.classList.add("is-active"));
  setTimeout(()=>{layer.classList.remove("is-active");layer.replaceChildren();},950);
}
let gamesHeaderOffsetFrame=0;
function syncGamesHeaderOffset(){
  const nav=document.querySelector("#adminerva-nav nav"),rect=nav?.getBoundingClientRect();
  const offset=rect?Math.max(0,Math.ceil(Math.min(rect.bottom,rect.height))):0;
  document.documentElement.style.setProperty("--games-header-offset",offset+"px");
}
function queueGamesHeaderOffset(){
  if(gamesHeaderOffsetFrame)return;
  gamesHeaderOffsetFrame=requestAnimationFrame(()=>{gamesHeaderOffsetFrame=0;syncGamesHeaderOffset();});
}
function watchGamesHeader(){
  const root=document.getElementById("adminerva-nav");let resizeObserver=null;
  const attach=()=>{
    syncGamesHeaderOffset();
    const nav=root?.querySelector("nav");if(!nav)return false;
    if("ResizeObserver" in window){resizeObserver?.disconnect();resizeObserver=new ResizeObserver(queueGamesHeaderOffset);resizeObserver.observe(nav);}
    return true;
  };
  if(!attach()&&root&&"MutationObserver" in window){
    const observer=new MutationObserver(()=>{if(attach())observer.disconnect();});
    observer.observe(root,{childList:true,subtree:true});
  }
  window.addEventListener("scroll",queueGamesHeaderOffset,{passive:true});
  window.addEventListener("resize",queueGamesHeaderOffset,{passive:true});
  window.addEventListener("orientationchange",queueGamesHeaderOffset,{passive:true});
  window.visualViewport?.addEventListener("resize",queueGamesHeaderOffset,{passive:true});
  window.visualViewport?.addEventListener("scroll",queueGamesHeaderOffset,{passive:true});
}
function enhanceGamesHub(){
  const app=field("practiceApp"),existing=[...app.children],shell=node("div",undefined,"games-shell"),rail=node("nav",undefined,"games-rail"),content=node("div",undefined,"games-content");
  rail.setAttribute("aria-label","Games navigation");
  const setCurrentRail=link=>{for(const item of rail.querySelectorAll(".games-rail-link")){const current=item===link;item.classList.toggle("is-current",current);if(current)item.setAttribute("aria-current","location");else item.removeAttribute("aria-current");}};
  [["#gamesHome","⌂","Hub"],["#labGameCatalog","🎮","Games"],["#gamesChallenges","✦","Challenges"],["#gamesProgress","◫","Progress"]].forEach(([href,icon,label],index)=>{const link=document.createElement("a");link.href=href;link.className="games-rail-link"+(index===0?" is-current":"");if(index===0)link.setAttribute("aria-current","location");if(label==="Challenges")link.id="gamesChallengesNav";link.append(node("span",icon),node("span",label));link.addEventListener("click",()=>{const href=link.getAttribute("href");if(href!=="#gamesProgress"&&!field("practiceMissionPanel").hidden)returnToGamesHub();setCurrentRail(link);});rail.append(link);});
  content.append(...existing);const celebrationLayer=node("div",undefined,"games-celebration");celebrationLayer.id="gamesCelebrationLayer";celebrationLayer.setAttribute("aria-hidden","true");shell.append(rail,content,celebrationLayer);app.replaceChildren(shell);
  const statusbar=content.querySelector(".lab-statusbar");if(statusbar){statusbar.classList.add("games-statusbar");field("labIdentity").hidden=true;field("labAccountLink").hidden=true;field("practiceSyncBtn").textContent="↻";field("practiceSyncBtn").setAttribute("aria-label","Refresh game progress");field("practiceSyncBtn").title="Refresh game progress";}
  const hero=content.querySelector(".lab-hero");hero.id="gamesHome";hero.className="games-hero";
  const copy=node("div",undefined,"games-hero-copy"),eyebrow=node("p","CONTINUE PLAYING","lab-eyebrow"),mode=node("div",undefined,"games-hero-mode"),modeIcon=node("span","◈"),modeText=node("span","Mission Map");modeText.id="labHeroMode";mode.append(modeIcon,modeText);
  const title=node("h1","Programming missions");title.id="labHeroTitle";const sub=node("p","Choose a game and start a mission.","games-hero-sub");sub.id="labHeroSub";
  const progress=node("div",undefined,"games-hero-progress"),meter=node("div",undefined,"games-meter"),fill=node("span");fill.id="labHeroProgress";meter.append(fill);const progressText=node("strong","0%");progressText.id="labHeroProgressText";progress.append(meter,progressText);
  const continueButton=node("button",undefined,"games-primary");continueButton.id="labHeroContinue";continueButton.type="button";continueButton.append(node("span","▶"),node("span","Continue"));
  copy.append(eyebrow,mode,title,sub,progress,continueButton);
  const art=node("div",undefined,"games-hero-art");["one","two","three"].forEach(kind=>art.append(node("span",undefined,"games-orb "+kind)));const image=document.createElement("img");image.src="assets/adminerva-owl.png";image.alt="";art.append(image);hero.replaceChildren(copy,art);
  const map=field("labMapPanel");map.classList.add("games-section");const headings=map.querySelectorAll(".lab-section-heading h2");if(headings[0])headings[0].textContent="Game modes";if(headings[1])headings[1].textContent="Skill paths";
  const challenges=node("section",undefined,"games-challenges");challenges.id="gamesChallenges";const challengeHead=node("div",undefined,"games-challenge-section-head"),challengeTitle=node("div");challengeTitle.append(node("p","CHALLENGES","lab-eyebrow"),node("h2","Teacher missions"));const challengeCount=node("span","None assigned","lab-pill");challengeCount.id="gamesChallengeCount";challengeHead.append(challengeTitle,challengeCount);const challengeList=node("div",undefined,"games-challenge-list");challengeList.id="gamesChallengeList";challenges.append(challengeHead,challengeList);map.prepend(challenges);
  const sidebar=content.querySelector(".lab-sidebar"),dailyCard=node("section",undefined,"games-utility-card games-glass games-daily-card"),dailyTitle=node("div",undefined,"games-utility-title");dailyTitle.append(node("strong","Daily Quest"),node("span","◫"));const dailyRow=node("div",undefined,"games-daily-row"),dailyText=node("span","0 / 3 missions");dailyText.id="labDailyQuestText";const dailyPips=node("div",undefined,"games-daily-pips");dailyPips.id="labDailyQuestPips";for(let index=1;index<=3;index++)dailyPips.append(node("span",String(index)));dailyRow.append(dailyText,dailyPips);dailyCard.append(dailyTitle,dailyRow),levelCard=node("section",undefined,"games-utility-card games-glass"),levelTitle=node("div",undefined,"games-utility-title"),levelLabel=node("strong","Skill XP"),levelText=node("span","Lv. 1");levelText.id="labLevelText";levelTitle.append(levelLabel,levelText);const levelRow=node("div",undefined,"games-level-row"),nextLevel=node("strong","Next level"),levelPoints=node("small","0 / 250 XP");levelPoints.id="labLevelPoints";levelRow.append(nextLevel,levelPoints);const levelMeter=node("div",undefined,"games-meter"),levelFill=node("span");levelFill.id="labLevelProgress";levelMeter.append(levelFill);levelCard.append(levelTitle,levelRow,levelMeter);
  const achievementCard=node("section",undefined,"games-utility-card games-glass"),achievementTitle=node("div",undefined,"games-utility-title");achievementTitle.append(node("strong","Achievements"),node("span","◆"));const achievements=node("div",undefined,"games-achievements");[["labBadgeStarter","✦","First Win · complete 1 mission"],["labBadgeExplorer","⌁","Bug Hunter · complete 5 debugging missions"],["labBadgeMaster","◇","OOP Architect · complete 10 OOP missions"]].forEach(([id,icon,label])=>{const badge=node("span",icon,"games-badge");badge.id=id;badge.title=label;badge.setAttribute("aria-label",label);achievements.append(badge);});achievementCard.append(achievementTitle,achievements);
  const progressCard=node("section",undefined,"games-utility-card games-glass"),progressTitle=node("div",undefined,"games-utility-title");progressTitle.append(node("strong","Your progress"),node("span","▥"));const rings=node("div",undefined,"games-progress-rings");[["labProgressLogic","Logic","all","logic"],["labProgressDebug","Debug","bug-detective",""],["labProgressOop","OOP","oop-builder","java"]].forEach(([id,label,gameId,courseId])=>{const wrap=node("button",undefined,"games-progress-item"),ring=node("div",undefined,"games-progress-ring");wrap.type="button";wrap.setAttribute("aria-label","Open "+label+" practice");wrap.addEventListener("click",()=>{if(busy)return;activeGame=gameId;if(courseId)course=COURSES.find(item=>item.id===courseId)||course;ensureCourseForGame();const url=new URL(location.href);if(gameId==="all")url.searchParams.delete("game");else url.searchParams.set("game",gameId);if(courseId)url.searchParams.set("course",courseId);else url.searchParams.delete("course");url.searchParams.delete("mission");history.replaceState(null,"",url);renderCourses();const gameLink=rail.querySelector('a[href="#labGameCatalog"]');if(gameLink)setCurrentRail(gameLink);field("labGameCatalog")?.scrollIntoView({behavior:"smooth",block:"start"});});ring.id=id;ring.style.setProperty("--value","0");ring.append(node("strong","0%"));wrap.append(ring,node("small",label));rings.append(wrap);});progressCard.id="gamesProgress";progressCard.append(progressTitle,rings,field("practiceOverview"),field("labPreviousProgress"));
  const preferences=sidebar.querySelector(".lab-public-preferences");if(preferences?.querySelector("summary"))preferences.querySelector("summary").textContent="Leaderboard profile";
  const legacyBoard=sidebar.querySelector(".lab-board"),rankings=document.createElement("details");rankings.className="lab-board games-ranking-card";const rankSummary=node("summary",undefined,"games-ranking-summary");rankSummary.append(node("span","Rankings"),node("span","🏆"));if(legacyBoard){rankings.append(rankSummary,...legacyBoard.children);legacyBoard.replaceWith(rankings);}sidebar.querySelector(".lab-tip-card")?.remove();
  sidebar.prepend(progressCard);sidebar.prepend(achievementCard);sidebar.prepend(levelCard);sidebar.prepend(dailyCard);
  assignedPacks=Array.isArray(window.__adminervaPracticePacks)?window.__adminervaPracticePacks:[];renderChallenges();
  watchGamesHeader();
  if("IntersectionObserver" in window){
    const links=[...rail.querySelectorAll(".games-rail-link")],targets=links.filter(link=>link.getAttribute("href")!=="#gamesProgress").map(link=>document.querySelector(link.getAttribute("href"))).filter(Boolean);
    const observer=new IntersectionObserver(entries=>{const visible=entries.filter(entry=>entry.isIntersecting).sort((a,b)=>b.intersectionRatio-a.intersectionRatio)[0];if(!visible)return;const link=links.find(item=>item.getAttribute("href")==="#"+visible.target.id);if(link)setCurrentRail(link);},{rootMargin:"-20% 0px -60% 0px",threshold:[0,.15,.35,.6]});
    targets.forEach(target=>observer.observe(target));
  }
}
function missionModule(entryCourse,entryMission){return entryCourse.modules?.find(module=>module.missions.some(item=>item.id===entryMission.id))||null;}
function missionGameId(entryCourse,entryMission){
  if(entryMission.oop===true)return "oop-builder";
  const meta=missionMeta(entryCourse,entryMission);
  if(meta.type==="debugging")return "bug-detective";
  if(meta.type==="output")return "trace-quest";
  if(meta.type==="ordering")return "algorithm-maze";
  if(meta.type==="matching")return "logic-circuit";
  if(entryCourse.id==="web")return "interface-repair";
  if(entryCourse.id==="logic")return "data-detective";
  return "code-sprint";
}
function gameMissions(entryCourse,gameId=activeGame){
  if(gameId==="challenge-arena"){
    const refs=assignedMissionRefs();
    return entryCourse.missions.filter(entry=>refs.has(entryCourse.id+":"+entry.id));
  }
  return entryCourse.missions.filter(entry=>programmingGameMatches(gameId,entryCourse,entry,missionMeta(entryCourse,entry),missionModule(entryCourse,entry)));
}
function ensureCourseForGame(){if(gameMissions(course).length)return;course=COURSES.find(entry=>gameMissions(entry).length)||COURSES[0];}
function recommendedGameId(){
  const last=hub.resume?.courseId&&hub.resume?.missionId?hub.resume:persistentGet(resumeKey());
  if(last?.courseId&&last?.missionId){
    const entry=COURSES.find(item=>item.id===last.courseId),target=entry?.missions.find(item=>item.id===last.missionId);
    if(entry&&target&&!completed(target.id))return last.gameId&&getProgrammingGame(last.gameId).id!=="all"?getProgrammingGame(last.gameId).id:missionGameId(entry,target);
  }
  const challenge=assignedChallengeTarget();if(challenge)return "challenge-arena";
  if(!(hub.completedCount||0))return "code-sprint";
  const target=weakestSkillTarget();
  return target?.recommendation==="OOP"?"oop-builder":target?.recommendation==="Debugging"?"bug-detective":target?.recommendation==="Logic"?"logic-circuit":"code-sprint";
}
function renderGameCatalog(){
  const catalog=field("labGameCatalog");if(!catalog)return;catalog.replaceChildren();
  const recommended=guestPage?null:recommendedGameId(),
    sourceGames=guestPage?PROGRAMMING_GAMES.filter(game=>game.id!=="challenge-arena"):PROGRAMMING_GAMES,
    ordered=guestPage?[...sourceGames]:[...sourceGames].sort((a,b)=>a.id===recommended?-1:b.id===recommended?1:a.id==="all"?-1:b.id==="all"?1:0);
  for(const game of ordered){
    const total=game.external?0:COURSES.reduce((sum,entry)=>sum+gameMissions(entry,game.id).length,0);
    const done=game.external?0:COURSES.reduce((sum,entry)=>sum+gameMissions(entry,game.id).filter(item=>completed(item.id)).length,0);
    const item=game.external?document.createElement("a"):document.createElement("button");
    item.className="lab-game-card"+(!game.external&&game.id===activeGame?" is-active":"")+(game.id===recommended?" is-recommended":"");
    item.dataset.game=game.id;
    if(game.external){
      item.href=guestPage?"guest-xml-lab.html":"student-xml-lab.html";
      item.setAttribute("aria-label",game.name+", open XML Layout Lab");
    }else{
      item.type="button";
      item.setAttribute("aria-pressed",String(game.id===activeGame));
      item.addEventListener("click",()=>{
        if(busy||game.id===activeGame)return;
        activeGame=game.id;ensureCourseForGame();
        const url=new URL(location.href);if(game.id==="all")url.searchParams.delete("game");else url.searchParams.set("game",game.id);url.searchParams.delete("course");url.searchParams.delete("mission");history.replaceState(null,"",url);
        renderCourses();
        field("labCourseTitle")?.scrollIntoView({behavior:"smooth",block:"nearest"});
      });
    }
    const top=node("div",undefined,"lab-game-card-top"),visual=node("span",undefined,"lab-game-card-visual"),glyphKind={"challenge-arena":"challenge","bug-detective":"bug","trace-quest":"trace","algorithm-maze":"builder","logic-circuit":"match","oop-builder":"oop","interface-repair":"interface","data-detective":"data","code-sprint":"sprint","xml-layout":"interface"}[game.id]||"oop";
    visual.append(gameGlyph(glyphKind));top.append(node("span",game.icon,"lab-game-card-icon"),node("span",game.id===recommended?"FOR YOU":game.tag,"lab-game-card-tag"));
    item.append(top,visual,node("strong",game.name),node("p",game.description),node("span",gameDeviceLabel(game),"lab-game-device"));
    if(game.external)item.append(node("small","Open XML Lab ↗"));
    else if(guestPage)item.append(node("small",done+" / "+total+" complete"));
    else{
      const progress=node("div",undefined,"lab-game-progress"),meter=node("div",undefined,"games-meter"),fill=node("span"),count=node("small",done+" / "+total);
      fill.style.width=(total?Math.round(done/total*100):0)+"%";meter.append(fill);progress.append(meter,count);item.append(progress);
    }
    catalog.append(item);
  }
  renderHubHero();
}
function renderCourses(){
  renderGameCatalog();ensureCourseForGame();
  const game=getProgrammingGame(activeGame),tabs=field("labCourseTabs");tabs.replaceChildren();
  const availableCourses=COURSES.filter(entry=>gameMissions(entry).length);
  for(const entry of availableCourses){const pool=gameMissions(entry),button=node("button",undefined,"lab-course-tab");button.type="button";button.setAttribute("aria-pressed",String(entry.id===course.id));button.append(node("span",entry.icon,"lab-course-icon"),node("span",entry.name),node("small",pool.filter(item=>completed(item.id)).length+"/"+pool.length));button.addEventListener("click",()=>{if(busy)return;course=entry;renderCourses();});tabs.append(button);}
  field("labCourseTitle").textContent=course.name;field("labCourseSubtitle").textContent=game.name+" · "+course.subtitle;const map=field("practiceCourseList");map.replaceChildren();
  course.modules.forEach((module,moduleIndex)=>{
    const pool=new Set(gameMissions(course).map(item=>item.id)),
      visible=module.missions.filter(entry=>pool.has(entry.id));if(!visible.length)return;
    const section=node("section",undefined,"lab-map-module"),heading=node("div",undefined,"lab-module-heading"),count=visible.filter(item=>completed(item.id)).length,nextId=visible.find(item=>!completed(item.id))?.id;
    heading.append(node("span",String(moduleIndex+1).padStart(2,"0"),"lab-module-number"),node("h3",module.title),node("small",count+" / "+visible.length));section.append(heading);
    const path=node("div",undefined,"lab-mission-path");path.setAttribute("aria-label",module.title+" missions");
    visible.forEach(entry=>{
      const meta=missionMeta(course,entry),done=completed(entry.id),button=node("button",undefined,"lab-mission-node"+(done?" is-complete":"")+(entry.id===nextId?" is-next":""));button.type="button";button.dataset.difficulty=meta.name.toLowerCase();button.title=entry.title+" · "+typeNames[meta.type]+" · "+meta.name;button.setAttribute("aria-label",entry.title+", "+typeNames[meta.type]+", "+meta.name+", "+(done?earned(entry.id)+" points earned":meta.maximum+" points available"));
      button.append(node("span",done?"✓":typeIcons[meta.type],"lab-node-icon"),node("small",done?earned(entry.id)+" pts":meta.maximum+" pts"),node("span",String(course.missions.findIndex(item=>item.id===entry.id)+1),"lab-node-number"));button.addEventListener("click",()=>void openMission(course,entry));path.append(button);
    });section.append(path);map.append(section);
  });
  if(activeGame==="challenge-arena"&&!map.children.length){
    const empty=node("div",undefined,"games-arena-empty");
    empty.append(node("span","✦","games-arena-empty-icon"),
      node("strong","No teacher challenges assigned"),
      node("p","Your teacher-assigned Practice Packs will appear here automatically."));
    map.append(empty);
  }
}
function renderBoard(){
  field("labGlobalTab").setAttribute("aria-pressed",String(boardMode==="global"));field("labClassTab").setAttribute("aria-pressed",String(boardMode==="class"));field("labClassControls").hidden=boardMode!=="class";
  field("labBoardFootnote").textContent=boardMode==="global"?"Current season · top 30 public aliases. Equal points share a rank.":"Current season · private class aliases. Equal points share a rank.";
  const rows=boardMode==="global"?globalRows:hub.classRows||[],list=field("practiceStandings");list.replaceChildren();
  if(!rows.length){const message=boardMode==="global"?(publicBoardError?"Rankings could not connect. Refresh to try again.":publicBoardReady?"A new season is starting. Opt in and set the pace.":"Connecting to public rankings…"):(eligible?"No class scores yet. Finish a mission to begin.":"Sign in with a linked student account to see your class.");list.append(node("li",message,"lab-board-empty"));return;}
  let rank=0,prior=null;rows.forEach((row,index)=>{if(row.points!==prior)rank=index+1;prior=row.points;const item=node("li",undefined,"lab-rank-row"+(row.isCurrent?" is-you":""));item.append(node("span",rank<=3?["🥇","🥈","🥉"][rank-1]:String(rank),"lab-rank-number"),node("span",row.alias+(row.isCurrent?" · You":"")),node("strong",row.points.toLocaleString()+" points"));list.append(item);});
}
async function call(name,payload={}){return practiceSchoolRequest(name,payload);}
async function refreshHub(classId=field("practiceClass").value){
  const version=epoch,uid=user?.uid,reconnect=field("practiceReconnectBtn");
  if(reconnect)reconnect.hidden=true;
  accountPreview=false;
  if(!user){
    eligible=false;hub={season:PRACTICE_SEASON,eligible:false,classes:[],courses:[],legacyCount:0};
    renderSummary();renderCourses();renderBoard();sync("Public preview");notice("");return;
  }
  try{
    const context=await resolvePracticeContext();
    if(version!==epoch||uid!==user?.uid)return;
    if(context.mode==="preview"){
      eligible=false;accountPreview=true;
      hub={season:PRACTICE_SEASON,eligible:false,classes:[],courses:[],legacyCount:0,points:0,completedCount:0};
      globalRows=[];publicBoardReady=true;publicBoardError=false;
      renderSummary();renderCourses();renderBoard();renderChallenges();
      sync("Staff preview");
      notice("Preview mode · Games are interactive, but XP and scored submissions are disabled for staff/admin accounts.","info");
      return;
    }
    const result=await call("practiceHub",{classId:classId||""});
    if(version!==epoch||uid!==user?.uid)return;
    hub=result;eligible=result.eligible===true;
    if(Array.isArray(result.publicRows)){globalRows=result.publicRows;publicBoardReady=true;publicBoardError=false;}
    renderSummary();renderCourses();renderBoard();renderChallenges();sync("Saved to your school");
    if(!pending)notice("");
  }catch(error){
    if(version!==epoch)return;
    eligible=false;accountPreview=false;sync("Connection needed","error");
    const reason=error.details?.reason||"";
    const message=reason==="practice-migration"?"Your Practice progress is being finalized for this school. Saved scores are protected while reconciliation completes.":
      reason==="school-selection"?"Choose your active school from the account menu, then reconnect Games.":
      reason==="enrollment"?"Your active school enrollment could not be verified. Ask your school administrator to check your student membership and enrollment.":
      reason==="staff-preview"?"This account can preview Games, but scored Practice is reserved for enrolled students.":
      ["revoked-sign-in","recent-sign-in","verified-sign-in"].includes(reason)?"Your sign-in needs to be renewed before Practice can save scores.":
      error.message&&error.message!=="internal" ? error.message : "Practice could not connect to your school. The map remains available.";
    if(reconnect&&["revoked-sign-in","recent-sign-in","verified-sign-in","session-moved"].includes(reason)){reconnect.hidden=false;reconnect.textContent="Reconnect account";}
    notice(message,"error");renderSummary();renderBoard();
  }
}
function errorFeedback(error){const reason=error.details?.reason,transfer=["transfer-required","recent-sign-in","session-moved","revoked-sign-in"].includes(reason);field("practiceTransferBtn").hidden=!transfer;if(transfer)notice("Practice needs to reconnect. Continue on this device to resume safely.","warning");sync("Not saved yet","error");feedback(transfer?"Continue practice on this device to reconnect. Your saved points stay safe.":error.message||"The answer could not be confirmed. Retry the same answer to avoid counting it twice.","warning");}
async function connect(takeover=false){const result=await resumePracticeSession({season:true,takeover,reauthenticate:takeover});field("practiceTransferBtn").hidden=true;sync(result.transferred?"Practice moved here":"Connected");return result;}
function readAnswer(){
  if(["choice","debugging"].includes(attempt.question.type)){const selected=field("practiceChoices").querySelector("input:checked");return selected?Number(selected.value):null;}
  if(attempt.question.type==="output")return field("labOutputAnswer").value.trim();
  if(["ordering","matching"].includes(attempt.question.type))return answer;
  return answer;
}
function reducedGameMotion(){return matchMedia("(prefers-reduced-motion: reduce)").matches;}
function coarsePointer(){return matchMedia("(pointer: coarse)").matches;}
function svgNode(name,attrs={}){const element=document.createElementNS("http://www.w3.org/2000/svg",name);for(const [key,value] of Object.entries(attrs))element.setAttribute(key,String(value));return element;}
function traceVariables(code){
  const source=String(code||""),blocked=new Set(["if","else","for","while","return","print","println","System","Math","new","class","public","private","protected","static","final","true","false","null"]),found=[];
  const patterns=[/\b(?:int|double|float|long|boolean|String|char|var|let|const)\s+([A-Za-z_$][\w$]*)/g,/^\s*([A-Za-z_]\w*)\s*=/gm];
  for(const pattern of patterns){for(const match of source.matchAll(pattern)){const name=match[1];if(!blocked.has(name)&&!found.includes(name))found.push(name);if(found.length>=5)return found;}}
  return found;
}
function gameGlyph(kind){
  const svg=svgNode("svg",{viewBox:"0 0 64 64","aria-hidden":"true",focusable:"false"});svg.classList.add("game-visual-svg");
  const stroke={fill:"none",stroke:"currentColor","stroke-width":"3","stroke-linecap":"round","stroke-linejoin":"round"};
  if(kind==="bug"){
    svg.append(svgNode("circle",{cx:32,cy:32,r:12,...stroke}),svgNode("path",{d:"M25 20 21 14M39 20 43 14M20 27H11M20 36H11M44 27H53M44 36H53M24 44 18 50M40 44 46 50M32 20V44",...stroke}));
  }else if(kind==="builder"){
    svg.append(svgNode("rect",{x:10,y:13,width:24,height:12,rx:3,...stroke}),svgNode("rect",{x:30,y:27,width:24,height:12,rx:3,...stroke}),svgNode("rect",{x:15,y:41,width:24,height:12,rx:3,...stroke}),svgNode("path",{d:"M34 19H45V27M30 33H22V41",...stroke}));
  }else if(kind==="match"){
    svg.append(svgNode("circle",{cx:16,cy:20,r:7,...stroke}),svgNode("circle",{cx:48,cy:20,r:7,...stroke}),svgNode("circle",{cx:16,cy:45,r:7,...stroke}),svgNode("circle",{cx:48,cy:45,r:7,...stroke}),svgNode("path",{d:"M23 20H41M23 45H41",...stroke}));
  }else if(kind==="trace"){
    svg.append(svgNode("circle",{cx:14,cy:45,r:5,...stroke}),svgNode("circle",{cx:32,cy:30,r:5,...stroke}),svgNode("circle",{cx:50,cy:17,r:5,...stroke}),svgNode("path",{d:"M18 42 28 33M36 27 46 20M47 29 52 17 40 18",...stroke}));
  }else if(kind==="interface"){
    svg.append(svgNode("rect",{x:7,y:10,width:50,height:42,rx:5,...stroke}),svgNode("path",{d:"M7 21H57M14 16H15M21 16H22M28 16H29M15 31H32V43H15ZM38 31H50M38 37H50M38 43H46",...stroke}));
  }else if(kind==="data"){
    svg.append(svgNode("rect",{x:8,y:10,width:34,height:38,rx:4,...stroke}),svgNode("path",{d:"M8 22H42M19 10V48M30 10V48",...stroke}),svgNode("circle",{cx:43,cy:43,r:10,...stroke}),svgNode("path",{d:"M50 50 57 57",...stroke}));
  }else if(kind==="sprint"){
    svg.append(svgNode("path",{d:"M35 6 16 34H30L26 58 49 26H35Z",...stroke}),svgNode("path",{d:"M11 17H23M8 26H20M7 44H19",...stroke}));
  }else if(kind==="challenge"){
    svg.append(
      svgNode("path",{d:"M32 7 39 21 55 23 43 34 46 50 32 42 18 50 21 34 9 23 25 21Z",...stroke}),
      svgNode("path",{d:"M24 31 29 36 40 25",...stroke})
    );
  }else{
    svg.append(svgNode("rect",{x:20,y:7,width:24,height:13,rx:3,...stroke}),svgNode("rect",{x:5,y:43,width:22,height:13,rx:3,...stroke}),svgNode("rect",{x:37,y:43,width:22,height:13,rx:3,...stroke}),svgNode("path",{d:"M32 20V32M16 43V32H48V43",...stroke}));
  }
  return svg;
}
function gameVisualHeader(kind,title,subtitle){
  const wrap=node("div",undefined,"game-visual-header game-visual-"+kind),icon=node("span",undefined,"game-visual-glyph"),copy=node("div",undefined,"game-visual-copy"),lines=node("span",undefined,"game-visual-lines");
  icon.append(gameGlyph(kind));copy.append(node("strong",title),node("small",subtitle));wrap.append(icon,copy,lines);return wrap;
}
function playGameFx(type,target){
  if(!target||guestPage)return;
  const className="game-fx-"+type;target.classList.remove(className);void target.offsetWidth;target.classList.add(className);
  if(!reducedGameMotion())setTimeout(()=>target.classList.remove(className),type==="success"?720:420);else target.classList.remove(className);
}
function setGameStatus(target,text,tone="info",icon="◆"){
  if(!target)return;
  let badge=target.querySelector(":scope > .game-status-badge");if(!badge){badge=node("span",undefined,"game-status-badge");target.append(badge);}
  badge.dataset.tone=tone;badge.replaceChildren(node("span",icon),node("span",text));
}
function hintMessages(question){
  const hints=[],concept=String(mission?.concept||"").trim();
  if(question.type==="debugging"){
    if(question.caseHint)hints.push(question.caseHint);
    if(concept)hints.push("Concept: "+concept);
    else if(Number.isInteger(question.focusLine))hints.push("Focus on line "+question.focusLine+". Compare what it does with the exact goal in the prompt.");
  }else if(question.type==="output"){
    if(concept)hints.push("Concept: "+concept);
    hints.push(mission?.oop===true?"Track the runtime object, field changes, and overridden calls before reading the final output.":"Track only values or state that can affect the final output.");
  }else if(question.type==="ordering"){
    if(concept)hints.push("Concept: "+concept);
    hints.push("Find the block that must happen first because later blocks depend on it.");
  }else if(question.type==="matching"){
    if(concept)hints.push("Concept: "+concept);
    hints.push("Match the most distinctive pair first; each right-side option can be used only once.");
  }else{
    if(concept)hints.push("Concept: "+concept);
    if(mission?.oop===true){
      const oopHints={"oop-classes":"Separate the class definition from the object or reference created from it.","oop-encapsulation":"Look for who is allowed to read or change object state.","oop-inheritance":"Look for extends, super, inherited members, or an override.","oop-polymorphism":"Compare the reference type with the runtime object and the implementation selected at runtime.","oop-real":"Decide whether the relationship is has-a, class-wide, overloaded, or collection-based."};
      hints.push(oopHints[mission.oopModule]||"Identify the object-oriented relationship before choosing.");
    }else hints.push("Eliminate choices that contradict the code before choosing between the remaining options.");
  }
  return [...new Set(hints.filter(Boolean))].slice(0,2);
}
function renderHintControl(){
  const tray=field("labHintTray"),button=field("labHintBtn"),text=field("labHintText");if(!tray||!button||!text)return;
  const hints=attempt?.question?hintMessages(attempt.question):[];
  tray.hidden=guestPage||!hints.length;button.hidden=guestPage||!hints.length;button.disabled=busy||hintLevel>=hints.length;
  button.textContent=hintLevel>=hints.length?"Hints used":"Hint "+(hintLevel+1)+" / "+hints.length;
  text.hidden=hintLevel===0;text.textContent=hintLevel?hints.slice(0,hintLevel).join(" · "):"";
}
function revealHint(){
  if(guestPage||!attempt?.question)return;
  const hints=hintMessages(attempt.question);if(!hints.length)return;
  hintLevel=Math.min(hints.length,hintLevel+1);renderHintControl();
}
function codeBlockKind(text){
  const value=String(text).trim();
  if(/^(if|else|for|while|switch|case|try|catch)|\b(if|for|while)\s*\(/.test(value))return "control";
  if(/print|println|textContent|role="status"/i.test(value))return "output";
  if(/^(<|<\/)|^[.#a-z][^{]*\{$|display:|flex-|padding:|border:|box-sizing:/i.test(value))return "interface";
  if(/\b(new|int|double|boolean|String|const|let|var|=\s*\[)/.test(value))return "data";
  return "action";
}
function moveOrder(from,to,swap=false){
  if(!Array.isArray(answer)||from===to||from<0||to<0||from>=answer.length||to>=answer.length)return;
  if(swap)[answer[from],answer[to]]=[answer[to],answer[from]];
  else{const [item]=answer.splice(from,1);answer.splice(to,0,item);}
  builderSelection=null;saveDraft();renderAnswer();const list=field("practiceChoices").querySelector(".lab-order-list");playGameFx("snap",list);
}
function renderAnswer(){
  const question=attempt.question,container=field("practiceChoices");container.replaceChildren();container.hidden=!guestPage&&question.type==="debugging"&&!bugLineFound;
  if(["choice","debugging"].includes(question.type))question.choices.forEach((value,index)=>{const label=node("label",undefined,"lab-answer-choice"),radio=document.createElement("input");radio.type="radio";radio.name="practiceAnswer";radio.value=String(index);radio.checked=answer===index;radio.addEventListener("change",()=>{answer=index;saveDraft();});label.append(radio,node("span",value));container.append(label);});
  else if(question.type==="output"){const label=node("label","Your exact answer","lab-answer-label"),input=document.createElement("input");input.id="labOutputAnswer";input.type="text";input.maxLength=500;input.autocomplete="off";input.spellcheck=false;input.value=typeof answer==="string"?answer:"";input.placeholder="Type the result or requested element…";input.addEventListener("input",()=>{answer=input.value;saveDraft();});label.htmlFor=input.id;container.append(label,input);}
  else if(question.type==="ordering"){
    if(!Array.isArray(answer)||answer.length!==question.items.length)answer=question.items.map((item,index)=>index);
    const list=node("ol",undefined,"lab-order-list");answer.forEach((itemIndex,position)=>{
      const blockText=question.items[itemIndex],row=node("li",undefined,!guestPage&&builderSelection===position?"is-picked":""),code=node("code",blockText),actions=node("div",undefined,"lab-order-actions");row.dataset.blockKind=codeBlockKind(blockText);
      if(!guestPage){
        row.draggable=!coarsePointer()&&!busy&&!pending;row.tabIndex=0;row.dataset.position=String(position);
        const choose=()=>{if(busy||pending)return;if(builderSelection===null){builderSelection=position;renderAnswer();}else if(builderSelection===position){builderSelection=null;renderAnswer();}else moveOrder(builderSelection,position,true);};
        row.addEventListener("click",event=>{if(event.target.closest("button"))return;choose();});
        row.addEventListener("keydown",event=>{if(["Enter"," "].includes(event.key)){event.preventDefault();choose();}});
        row.addEventListener("dragstart",event=>{event.dataTransfer?.setData("text/plain",String(position));row.classList.add("is-dragging");});
        row.addEventListener("dragend",()=>row.classList.remove("is-dragging"));
        row.addEventListener("dragover",event=>{event.preventDefault();row.classList.add("is-drag-target");});
        row.addEventListener("dragleave",()=>row.classList.remove("is-drag-target"));
        row.addEventListener("drop",event=>{event.preventDefault();row.classList.remove("is-drag-target");const from=Number(event.dataTransfer?.getData("text/plain"));if(Number.isInteger(from))moveOrder(from,position,false);});
      }
      for(const [delta,symbol,label] of [[-1,"↑","Move statement up"],[1,"↓","Move statement down"]]){const button=node("button",symbol);button.type="button";button.setAttribute("aria-label",label);button.dataset.boundary=String(position+delta<0||position+delta>=answer.length);button.disabled=button.dataset.boundary==="true";button.addEventListener("click",()=>{if(busy||pending||button.dataset.boundary==="true")return;moveOrder(position,position+delta,false);});actions.append(button);}
      row.append(node("span",String(position+1),"lab-order-position"),code,actions);list.append(row);
    });container.append(list);
    if(!guestPage)container.append(node("small",builderSelection===null?(coarsePointer()?"Tap two blocks to swap, or use the arrows.":"Drag blocks, use arrows, or tap two blocks to swap."):"Choose another block to swap positions.","games-builder-help"));
  }else{
    if(!Array.isArray(answer)||answer.length!==question.left.length)answer=question.left.map(()=>null);
    question.left.forEach((value,index)=>{
      if(guestPage){
        const label=node("label",undefined,"lab-match-row"),select=document.createElement("select");label.append(node("strong",value));select.setAttribute("aria-label","Match "+value);select.add(new Option("Choose a match…",""));question.right.forEach((right,rightIndex)=>select.add(new Option(right,String(rightIndex))));select.value=answer[index]===null?"":String(answer[index]);select.addEventListener("change",()=>{answer[index]=select.value===""?null:Number(select.value);saveDraft();});label.append(select);container.append(label);return;
      }
      const row=node("div",undefined,"games-match-row"+(answer[index]!==null?" has-match":"")),label=node("strong",value),connector=node("span",undefined,"games-match-connector"),choices=node("div",undefined,"games-match-choices");row.append(label,connector,choices);
      question.right.forEach((right,rightIndex)=>{const button=node("button",right,"games-match-choice"+(answer[index]===rightIndex?" is-selected":""));button.type="button";button.setAttribute("aria-pressed",String(answer[index]===rightIndex));button.addEventListener("click",()=>{if(busy||pending)return;const prior=answer.indexOf(rightIndex);if(prior>=0&&prior!==index)answer[prior]=null;answer[index]=answer[index]===rightIndex?null:rightIndex;saveDraft();renderAnswer();const updated=[...field("practiceChoices").querySelectorAll(".games-match-row")][index];if(answer[index]!==null){updated?.classList.add("has-match");playGameFx("link",updated);}});choices.append(button);});
      container.append(row);
    });
  }
  if(!guestPage){
    const visual=field("labMechanicPanel")?.querySelector(".game-visual-header");
    if(question.type==="matching"){
      const linked=Array.isArray(answer)?answer.filter(Number.isInteger).length:0;setGameStatus(visual,linked+" / "+question.left.length+" linked",linked===question.left.length?"success":"info",linked===question.left.length?"✓":"↔");
    }else if(question.type==="ordering"){
      setGameStatus(visual,(Array.isArray(answer)?answer.length:0)+" blocks ready","info","▦");
    }
  }
  for(const control of container.querySelectorAll("input,select,button"))if(busy||pending)control.disabled=true;
}
function renderMechanicAid(question){
  const panel=field("labMechanicPanel");panel.replaceChildren();panel.hidden=true;panel.dataset.kind="";panel.classList.remove("is-trace","is-debug","is-interface","is-data");
  field("practiceCode").hidden=!question.code;
  const gameId=field("practiceMissionPanel")?.dataset.game||missionGameId(course,mission);
  if(!guestPage&&gameId==="interface-repair"){
    const visual=gameVisualHeader("interface","Interface Repair","Inspect → compare → repair"),preview=node("section",undefined,"games-interface-preview"),bar=node("div",undefined,"games-interface-bar"),dots=node("span","●  ●  ●"),label=node("strong","Interface Preview"),tools=node("div",undefined,"games-interface-tools");
    label.append(node("small",question.interfaceScenario||"UI repair"));
    [["desktop","▰","Desktop preview"],["mobile","▯","Mobile preview"]].forEach(([mode,icon,aria],index)=>{const button=node("button",icon);button.type="button";button.dataset.mode=mode;button.setAttribute("aria-label",aria);button.setAttribute("aria-pressed",String(index===0));button.addEventListener("click",()=>{preview.dataset.viewport=mode;for(const item of tools.querySelectorAll("button"))item.setAttribute("aria-pressed",String(item===button));playGameFx("snap",preview);});tools.append(button);});
    bar.append(dots,label,tools);preview.dataset.viewport="desktop";preview.append(bar);setGameStatus(visual,question.interfaceScenario||"Live preview","info","▤");
    const source=String(question.code||""),hasMarkup=/<[a-z][\s\S]*>/i.test(source);
    if(hasMarkup){
      const stage=node("div",undefined,"games-interface-stage"),frame=document.createElement("iframe");frame.className="games-interface-frame";frame.title="Interface Repair mission preview";frame.sandbox="allow-scripts";frame.srcdoc=/<!doctype|<html/i.test(source)?source:"<!doctype html><html><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><style>body{font:14px system-ui;margin:16px;color:#172033}*{box-sizing:border-box}</style><body>"+source+"</body></html>";stage.append(frame);preview.append(stage);
    }else{
      const empty=node("div",undefined,"games-interface-empty");empty.append(node("span","▤"),node("span","Use the code and prompt to identify the interface repair."));preview.append(empty);
    }
    panel.append(visual,preview);panel.hidden=false;panel.classList.add("is-interface");
  }
  if(!guestPage&&gameId==="data-detective"){
    const visual=gameVisualHeader("data","Data Detective","Mark the evidence that matters"),board=node("section",undefined,"games-data-board"),head=node("div",undefined,"games-data-head");head.append(node("span","DATA DETECTIVE","lab-mechanic-kicker"),node("strong","Evidence board"));board.append(head);
    const source=String(question.code||""),caseTerms=Array.isArray(question.left)?question.left.slice(0,5).map(value=>String(value)):[],tokens=[...new Set((source.match(/-?\d+(?:\.\d+)?/g)||[]))].slice(0,6),signals=[];
    if(/\[[^\]]*\]|values\[|list\[|array/i.test(source))signals.push("INDEX");
    if(/length|len\s*\(/i.test(source))signals.push("LENGTH");
    if(/min\s*\(|max\s*\(|Math\.(?:min|max)/i.test(source))signals.push("BOUND");
    if(/>=|<=|==|!=|>|</.test(source))signals.push("CHECK");
    if(/\+|-|\*|\/|%/.test(source))signals.push("OPERATION");
    const evidence=node("div",undefined,"games-data-evidence");
    const items=[...caseTerms,...tokens.map(value=>"VALUE "+value),...signals].filter(Boolean).slice(0,8);
    (items.length?items:["READ","TRACE","VERIFY"]).forEach(value=>{const chip=node("button",value,"games-data-chip");chip.type="button";chip.setAttribute("aria-pressed","false");chip.addEventListener("click",()=>{const marked=chip.getAttribute("aria-pressed")!=="true";chip.setAttribute("aria-pressed",String(marked));chip.classList.toggle("is-marked",marked);const count=[...evidence.querySelectorAll(".games-data-chip.is-marked")].length;setGameStatus(visual,count?count+" clue"+(count===1?"":"s")+" marked":"Evidence board","info",count?"●":"⌕");playGameFx("link",chip);});evidence.append(chip);});
    const note=node("p","Mark the evidence you think matters, then solve the case from the code.","games-data-note");board.append(evidence,note);setGameStatus(visual,"Evidence board","info","⌕");panel.append(visual,board);panel.hidden=false;panel.classList.add("is-data");
  }
  if(!guestPage&&mission?.oop===true&&gameId==="oop-builder"){
    const visual=gameVisualHeader("oop","OOP Builder","Model structure and runtime relationships");visual.dataset.module=mission.oopModule||"oop";panel.append(visual);
    const moduleBlueprints={
      "oop-classes":["CLASS","creates","OBJECT"],
      "oop-encapsulation":["PRIVATE STATE","controlled by","METHODS"],
      "oop-inheritance":["PARENT","extends to","CHILD"],
      "oop-polymorphism":["REFERENCE","dispatches to","RUNTIME TYPE"],
      "oop-real":["OBJECT","works with","OBJECT"]
    },topicBlueprints={
      "object-identity":["OBJECT A","different from","OBJECT B"],
      "validated-setter":["INPUT","validated by","SETTER","protects","PRIVATE STATE"],
      "super-method":["CHILD OVERRIDE","calls","super","reuses","PARENT BEHAVIOR"],
      "interface-list":["INTERFACE","holds","IMPLEMENTATIONS","dispatch to","OWN METHODS"],
      "collection-polymorphism":["LIST<ANIMAL>","contains","DOG + CAT","dispatch to","OVERRIDES"],
      "dynamic-dispatch":["REFERENCE","points to","RUNTIME OBJECT","selects","OVERRIDE"],
      "composition":["OWNER","has-a","COMPONENT"],
      "private-field":["PRIVATE FIELD","accessed through","METHODS"]
    },parts=topicBlueprints[mission.oopTopic]||moduleBlueprints[mission.oopModule]||["OOP","connects","BEHAVIOR"],blueprint=node("div",undefined,"games-oop-blueprint"),head=node("div",undefined,"games-oop-blueprint-head");
    head.append(node("span","OOP BLUEPRINT","lab-mechanic-kicker"),node("strong",mission.title.replace(/ · (Guided|Apply|Challenge)$/,"")));
    const flow=node("div",undefined,"games-oop-flow");flow.dataset.steps=String(parts.length);
    parts.forEach((part,index)=>{const isNode=index%2===0,item=node("span",part,isNode?"games-oop-node":"games-oop-link");if(isNode)item.dataset.role=index===0?"source":index===parts.length-1?"target":"bridge";flow.append(item);});
    blueprint.append(head,flow);panel.append(blueprint);panel.hidden=false;panel.dataset.kind="oop";setGameStatus(visual,{ "oop-classes":"Classes & objects","oop-encapsulation":"Encapsulation","oop-inheritance":"Inheritance","oop-polymorphism":"Polymorphism","oop-real":"Real programs"}[mission.oopModule]||"OOP concept","info","◇");
  }
  const hasTraceGuide=Array.isArray(question.traceGuide)&&question.traceGuide.length;
  if(question.type==="output"&&(!guestPage||hasTraceGuide)){
    panel.hidden=false;panel.dataset.kind="trace";
    const visual=!guestPage&&gameId==="trace-quest"?gameVisualHeader("trace","Code Trace","Follow the execution path"):null,head=node("div",undefined,"lab-mechanic-head");head.append(node("span",guestPage?"TRACE QUEST":"CODE TRACE","lab-mechanic-kicker"),node("strong","Trace board"));
    if(visual){setGameStatus(visual,"0 steps traced","info","→");panel.append(visual);}
    const guide=hasTraceGuide?question.traceGuide:["Read the starting values.","Follow each call or update in order.","Write the exact final output."];
    const list=node("ol",undefined,"lab-trace-steps");guide.forEach(step=>{const item=node("li",step);if(!guestPage){item.tabIndex=0;item.setAttribute("role","checkbox");item.setAttribute("aria-checked","false");const toggle=()=>{const checked=item.getAttribute("aria-checked")==="true";item.setAttribute("aria-checked",String(!checked));item.classList.toggle("is-checked",!checked);const traced=[...list.querySelectorAll(".is-checked")].length;if(visual){setGameStatus(visual,traced+" / "+guide.length+" traced",traced===guide.length?"success":"info",traced===guide.length?"✓":"→");if(traced===guide.length)playGameFx("success",visual);}};item.addEventListener("click",toggle);item.addEventListener("keydown",event=>{if(["Enter"," "].includes(event.key)){event.preventDefault();toggle();}});}list.append(item);});
    panel.append(head,list);
    if(!guestPage){
      const variables=traceVariables(question.code),scratch=node("div",undefined,"games-trace-state");
      if(variables.length){
        const saved=localGet(traceScratchKey())||{};scratch.append(node("span","TRACE STATE","games-trace-state-label"));
        variables.forEach(name=>{const item=node("label",undefined,"games-trace-variable"),key=node("span",name),input=document.createElement("input");input.type="text";input.maxLength=24;input.autocomplete="off";input.spellcheck=false;input.placeholder="?";input.value=String(saved[name]??"");input.setAttribute("aria-label","Scratch value for "+name);input.addEventListener("input",()=>{const next=localGet(traceScratchKey())||{};next[name]=input.value;localSet(traceScratchKey(),next);});item.append(key,input);scratch.append(item);});
        panel.append(scratch);
      }
    }
  }
  if(question.type==="debugging"&&Number.isInteger(question.focusLine)&&question.code){
    panel.hidden=false;panel.dataset.kind="debug";field("practiceCode").hidden=true;
    if(!guestPage&&(attempt?.completed||answer!==null))bugLineFound=true;
    const head=node("div",undefined,"lab-mechanic-head");head.append(node("span","BUG HUNT","lab-mechanic-kicker"),node("strong",guestPage?"Case file":bugLineFound?"Defect located":"Find the defect"));const visual=!guestPage&&gameId==="bug-detective"?gameVisualHeader("bug","Bug Hunt","Scan → isolate → repair"):null;
    const hint=node("p",question.caseHint||"Inspect the highlighted line and compare it with the stated goal.","lab-case-hint");
    const viewer=node("div",undefined,"lab-code-case"),status=node("p",guestPage?"":bugLineFound?"Defect located. Choose the repair.":"Select the line you think contains the defect. No points are lost while hunting.","games-bug-status");
    question.code.split("\n").forEach((text,index)=>{
      const lineNumber=index+1,row=node("div",undefined,"lab-code-line"+((guestPage||bugLineFound)&&lineNumber===question.focusLine?" is-focus":""));row.append(node("span",String(lineNumber),"lab-code-line-number"),node("code",text||" "));
      if(!guestPage&&!bugLineFound){
        row.tabIndex=0;row.setAttribute("role","button");row.setAttribute("aria-label","Mark line "+lineNumber+" as the suspected defect");
        const choose=()=>{
          if(busy||bugLineFound)return;
          if(lineNumber===question.focusLine){
            bugLineFound=true;row.classList.add("is-focus");status.textContent="Defect located. Choose the repair.";head.querySelector("strong").textContent="Defect located";field("practicePrompt").textContent=question.prompt;playGameFx("success",viewer);if(visual)setGameStatus(visual,"Defect isolated","success","✓");renderAnswer();
          }else{
            row.classList.remove("is-wrong-suspect");void row.offsetWidth;row.classList.add("is-wrong-suspect");status.textContent="Not that line — no points lost. Keep hunting.";playGameFx("error",row);if(visual)setGameStatus(visual,"Keep scanning","warning","!");
          }
        };
        row.addEventListener("click",choose);row.addEventListener("keydown",event=>{if(["Enter"," "].includes(event.key)){event.preventDefault();choose();}});
      }
      viewer.append(row);
    });
    if(guestPage)panel.append(head,hint,viewer);else{if(!bugLineFound)field("practicePrompt").textContent="Find the defective line, then choose the repair.";if(visual&&bugLineFound)setGameStatus(visual,"Defect isolated","success","✓");panel.append(...(visual?[visual]:[]),head,viewer,status);}
  }
  if(!guestPage&&question.type==="ordering"){
    panel.hidden=false;if(!panel.dataset.kind)panel.dataset.kind="build";const visual=gameId==="algorithm-maze"?gameVisualHeader("builder","Code Builder","Assemble the execution path"):null,track=node("div",undefined,"games-builder-track"),head=node("div",undefined,"lab-mechanic-head");if(visual){for(let index=0;index<question.items.length;index++)track.append(node("span",String(index+1)));visual.append(track);setGameStatus(visual,question.items.length+" blocks","info","▦");}head.append(node("span","CODE BUILDER","lab-mechanic-kicker"),node("strong","Arrange the blocks"));panel.append(...(visual?[visual]:[]),head,node("p","Build the program in execution order.","games-mechanic-note"));
  }
  if(!guestPage&&question.type==="matching"){
    panel.hidden=false;if(!panel.dataset.kind)panel.dataset.kind="match";const visual=gameId==="logic-circuit"?gameVisualHeader("match","Logic Match","Connect each rule to its result"):null,head=node("div",undefined,"lab-mechanic-head");head.append(node("span","LOGIC MATCH","lab-mechanic-kicker"),node("strong","Complete the pairs"));panel.append(...(visual?[visual]:[]),head,node("p","Each match can be used once.","games-mechanic-note"));
  }
}
function pointsText(){const meta=attempt.question.difficulty;field("labMissionPoints").textContent=attempt.completed?attempt.earnedPoints+" pts earned":attempt.availablePoints+" pts available";field("labScoringHint").textContent=attempt.completed?"Completed · replays do not change XP.":meta.name+" · "+meta.maximum+" pts max · −"+meta.deduction+" per miss · "+meta.floor+" pt floor · experiments are free.";}
async function openMission(selectedCourse,selectedMission){
  if(busy)return;const end=window.beginLoading?.("Preparing practice mission…")||(()=>{});saveDraft();course=selectedCourse;mission=selectedMission;persistentSet(resumeKey(),{courseId:course.id,missionId:mission.id,gameId:activeGame,openedAt:Date.now()});attempt=null;hintLevel=0;builderSelection=null;bugLineFound=false;answer=localGet(draftKey())?.answer??null;const version=epoch,sequence=++loadSequence;
  field("labReopenMission").hidden=true;
  field("practiceCheckBtn").hidden=true;field("labSubmitSignin").hidden=true;
  const themeGame=["all","challenge-arena"].includes(activeGame)?missionGameId(course,mission):activeGame;field("labMapPanel").hidden=true;const missionPanel=field("practiceMissionPanel");missionPanel.hidden=false;missionPanel.classList.remove("is-complete");missionPanel.dataset.game=themeGame;renderSprintHud();field("practiceMissionTitle").textContent=mission.title.replace(/ · (Guided|Apply|Challenge)$/,"");field("practiceCourseName").textContent=course.name;field("labMissionType").textContent=typeNames[missionMeta(course,mission).type];field("practiceChoices").replaceChildren();field("practiceCode").textContent="";field("practicePrompt").textContent="Preparing your mission…";field("labExperimentLink").hidden=true;field("labNextMission").hidden=true;feedback("");setBusy(true);
  field("labGameName").textContent=activeGame==="challenge-arena"?"Challenge Arena · "+getProgrammingGame(themeGame).name:getProgrammingGame(themeGame).name;field("labDeviceHint").textContent=gameDeviceLabel(getProgrammingGame(themeGame));field("practiceMissionTitle").focus({preventScroll:true});field("practiceMissionPanel").scrollIntoView({behavior:"smooth",block:"start"});
  try{
    if(eligible&&user){if(!activePracticeSession()||activePracticeSession().expiresAt<Date.now())await connect();attempt=await practiceRequest("practiceMissionStart",{courseId:course.id,missionId:mission.id});}
    else{const preview=seasonActivity(course,mission,Math.abs(hashSeed(PRACTICE_SEASON+mission.id))),meta=missionMeta(course,mission);attempt={question:publicActivity(preview),availablePoints:meta.maximum,completed:false,previewWorkspace:preview.workspace};}
    if(version!==epoch||sequence!==loadSequence)return;
    if(pending?.missionId===mission.id){if(pending.attemptId===attempt.attemptId)answer=pending.answer;else{pending=null;localSet(pendingKey(),null);notice("The previous answer session ended. This mission shows your latest server score; no answer was submitted again.");}}
    field("practiceCode").textContent=attempt.question.code||"";field("practiceCode").hidden=!attempt.question.code;field("practicePrompt").textContent=attempt.question.prompt;renderMechanicAid(attempt.question);pointsText();renderAnswer();renderHintControl();
    field("labSubmitSignin").hidden=eligible||accountPreview;field("practiceCheckBtn").hidden=!eligible;
    field("labSubmitSignin").textContent=user?"Open my access request":"Sign in to submit";field("labSubmitSignin").href=user?"guest-home.html":"login.html";
    if(!eligible)feedback(accountPreview?"Staff preview · solve and explore freely. XP and scored submissions are intentionally disabled.":user?"Your account cannot submit yet. Check your active school enrollment, then refresh.":"Explore the mission freely. Sign in to submit answers and save season points.");
    if(attempt.completed){field("practiceMissionPanel").classList.add("is-complete");feedback("Mission complete · "+attempt.earnedPoints+" pts saved. "+(attempt.explanation||""),"success");field("labNextMission").hidden=false;prepareExperiment(attempt.workspace);}
    else if(attempt.previewWorkspace)prepareExperiment(attempt.previewWorkspace);
    if(pending&&pending.missionId!==mission.id){field("practiceCheckBtn").disabled=true;feedback("Confirm the earlier pending answer before submitting another mission. Use “Resume pending save” above.","warning");}
  }catch(error){if(version===epoch&&sequence===loadSequence){errorFeedback(error);field("practicePrompt").textContent="This mission needs to reconnect.";field("labReopenMission").hidden=false;}}
  finally{if(version===epoch&&sequence===loadSequence){setBusy(false);if(pending&&pending.missionId!==mission?.id)field("practiceCheckBtn").disabled=true;}end();}
}
function prepareExperiment(workspace){
  const link=field("labExperimentLink");link.hidden=!workspace;if(!workspace)return;
  link.onclick=event=>{const transfer={uid:owner(),courseId:course.id,missionId:mission.id,attempt:0,workspace,startedAt:Date.now(),runCount:0,observed:"",returnPage:guestPage?"guest-practice.html":"student-practice.html"};if(!localSet(practiceBridgeKey(owner()),transfer)){event.preventDefault();feedback("Browser storage is unavailable. Open Playground directly and copy the code above.","warning");}};
}
function pendingNotice(){field("labPendingResume").hidden=!pending;if(pending)notice("An answer is waiting for confirmation. Retry the same save before submitting another answer.","warning");}
async function submit(){
  if(busy||!eligible||!user||!attempt?.attemptId)return;
  if(pending&&pending.missionId!==mission.id){pendingNotice();return;}
  const responseAnswer=pending?pending.answer:readAnswer(),question=attempt.question;
  if(responseAnswer===null||responseAnswer===""||Array.isArray(responseAnswer)&&(responseAnswer.some(value=>value===null)||new Set(responseAnswer).size!==responseAnswer.length)){feedback("Complete the answer first. Match each option once; an incomplete answer does not cost points.","warning");return;}
  const uid=user.uid,version=epoch;
  if(!pending){pending={attemptId:attempt.attemptId,submissionId:[...crypto.getRandomValues(new Uint8Array(16))].map(part=>part.toString(16).padStart(2,"0")).join(""),answer:responseAnswer,courseId:course.id,missionId:mission.id};localSet(pendingKey(),pending);}
  const end=globalThis.beginLoading?.("Saving scored practice answer…")||(()=>{});
  saveDraft();setBusy(true);sync("Saving answer…","saving");feedback("");
  try{
    const result=await practiceRequest("practiceMissionSubmit",pending);
    if(version!==epoch||user?.uid!==uid)return;
    pending=null;localSet(pendingKey(),null);field("labPendingResume").hidden=true;notice("");
    if(result.correct){attempt.completed=true;attempt.earnedPoints=result.earnedPoints;field("practiceMissionPanel").classList.add("is-complete");if(!guestPage){const visual=field("labMechanicPanel")?.querySelector(".game-visual-header");setGameStatus(visual,"Mission solved","success","✓");playGameFx("success",field("labMechanicPanel"));}if(result.awarded&&field("practiceMissionPanel").dataset.game==="code-sprint")sprintCorrect();prepareExperiment(result.workspace);field("labNextMission").hidden=false;feedback((result.awarded?"Mission complete! +"+result.earnedPoints+" points. ":"Correct replay. Your original reward stays saved. ")+(result.explanation||""),"success");if(result.awarded)celebrateMission();await refreshHub();sync(result.awarded?"Saved · +"+result.earnedPoints+" points":"Replay checked");}
    else if(result.alreadyRecorded){feedback("Not quite. This is a replay, so your saved points are unchanged. "+(result.explanation||""),"warning");sync("Replay checked");}
    else{attempt.availablePoints=result.availablePoints;attempt.wrongSubmissions=result.wrongSubmissions;if(!guestPage){const visual=field("labMechanicPanel")?.querySelector(".game-visual-header");setGameStatus(visual,"Recheck your solution","warning","!");playGameFx("error",field("practiceChoices"));if(attempt.question.type==="debugging")bugLineFound=true;revealHint();if(field("practiceMissionPanel").dataset.game==="code-sprint")sprintMiss();}feedback(result.deduction?"Not quite. This scored submission used "+result.deduction+" points from this mission’s possible reward. "+result.availablePoints+" points remains available. Adjust your answer and try again.":"Not quite. You have reached this mission’s minimum reward; more attempts cannot reduce it further. Keep trying.","warning");sync("Attempt saved");}
    pointsText();renderAnswer();
  }catch(error){if(version===epoch){const reason=error.details?.reason;if(["answer-incomplete","practice-rate-limit","attempt-expired","enrollment","guest-registration","session-moved"].includes(reason)){pending=null;localSet(pendingKey(),null);if(reason==="attempt-expired")field("labReopenMission").hidden=false;}errorFeedback(error);pendingNotice();}}
  finally{if(version===epoch)setBusy(false);end();}
}
function markup(){return `
  <header class="lab-hero"><div><p class="lab-eyebrow">ADMINERVA GAMES · COMPUTER PROGRAMMING</p><h1>Choose a game.<br><span>Build the skill.</span></h1><p>Debug, trace, arrange, match, repair, and experiment across Java, Python, Web, Logic, and XML.</p><div class="lab-hero-links"><a href="${guestPage?"guest-playground.html":"student-playground.html"}">Open Code Playground ↗</a><a href="${guestPage?"guest-xml-lab.html":"student-xml-lab.html"}">Open XML Layout Lab ↗</a></div></div><div class="lab-hero-mark" aria-hidden="true">&lt;/&gt;<span>COMPUTER PROGRAMMING</span></div></header>
  <div class="lab-statusbar"><span id="labIdentity">Public visitor</span><span id="labSync" role="status">Connecting…</span><button id="practiceSyncBtn" type="button">↻ Refresh progress</button><a id="labAccountLink" href="login.html">Sign in</a></div>
  <div id="labNotice" class="lab-notice" role="status" hidden><span id="labNoticeText"></span><button id="practiceReconnectBtn" type="button" hidden>Reconnect account</button><button id="practiceTransferBtn" type="button" hidden>Continue practice here</button><button id="labPendingResume" type="button" hidden>Resume pending save</button></div>
  <div id="practiceOverview" class="lab-stats" aria-label="Your season progress"></div><p id="labPreviousProgress" class="lab-history"></p>
  <div class="lab-workspace"><div class="lab-main"><section id="labMapPanel"><div class="lab-section-heading"><div><p class="lab-eyebrow">COMPUTER PROGRAMMING</p><h2>Choose a game</h2></div><span class="lab-pill">${PROGRAMMING_GAMES.length} game modes · ${TOTAL_MISSIONS} missions</span></div><nav id="labGameCatalog" class="lab-game-grid" aria-label="Computer Programming games"></nav><div class="lab-section-heading lab-skill-heading"><div><p class="lab-eyebrow">FILTER THE GAME</p><h2>Choose a skill path</h2></div><span class="lab-pill">Java · Python · Web · Logic</span></div><nav id="labCourseTabs" class="lab-course-tabs" aria-label="Programming skill paths"></nav><div class="lab-map-heading"><div><h2 id="labCourseTitle"></h2><p id="labCourseSubtitle"></p></div><span class="lab-map-key">✓ completed · choose any mission</span></div><div id="practiceCourseList"></div></section>
  <section id="practiceMissionPanel" class="lab-mission-panel" aria-labelledby="practiceMissionTitle" aria-busy="false" hidden><button id="practiceBackBtn" type="button" class="lab-text-button">← Back to games</button><div class="lab-mission-meta"><span id="labGameName" class="lab-pill"></span><span id="practiceCourseName"></span><span id="labMissionType" class="lab-pill"></span><span id="labDeviceHint" class="lab-pill lab-device-pill"></span></div><div id="gamesSprintHud" class="games-sprint-hud" hidden><span id="gamesSprintGraphic" class="games-sprint-graphic" aria-hidden="true"></span><div><strong id="gamesSprintRound">Round 1 / 5</strong><span id="gamesSprintStreak">Streak 0</span></div><div id="gamesSprintPips" class="games-sprint-pips"><span>1</span><span>2</span><span>3</span><span>4</span><span>5</span></div><button id="gamesSprintReset" type="button" hidden>New sprint</button></div><h2 id="practiceMissionTitle" tabindex="-1"></h2><p id="labMissionPoints" class="lab-points-available"></p><pre id="practiceCode"></pre><div id="labMechanicPanel" class="lab-mechanic-panel" hidden></div><h3 id="practicePrompt"></h3><div id="practiceChoices" class="lab-answers"></div><p id="labScoringHint" class="lab-scoring-hint"></p><div id="labHintTray" class="games-hint-tray" hidden><button id="labHintBtn" type="button">Hint 1 / 2</button><p id="labHintText" hidden></p></div><div id="practiceFeedback" class="lab-feedback" role="status" aria-live="polite" hidden></div><div class="lab-mission-actions"><button id="practiceCheckBtn" type="button" class="lab-primary">Submit answer</button><a id="labSubmitSignin" href="login.html" class="lab-primary" hidden>Sign in to submit</a><button id="labReopenMission" type="button" hidden>Reconnect mission</button><button id="labNextMission" type="button" class="lab-secondary" hidden>Next mission →</button></div><a id="labExperimentLink" class="lab-experiment-link" href="${guestPage?"guest-playground.html":"student-playground.html"}?practice=1" hidden>Experiment with this code in Playground ↗</a></section>
  <details class="lab-rules"><summary>How scoring works</summary><div class="lab-rules-grid">${DIFFICULTIES.map(level=>`<div><strong>${level.name}</strong><span>${level.maximum} points to start</span><small>−${level.deduction} per incorrect scored answer · floor ${level.floor} points</small></div>`).join("")}</div><p>Only selecting Submit scored answer counts as a graded attempt. Opening a mission, changing an answer, running code, compiler errors, and connection failures do not deduct points. Each mission rewards you once per season. Replays cannot add points. Practice scores do not change school grades. Earlier completion history is preserved.</p><p>Guests and students share this mission pool. A verified signed-in account with an active or pending school access request can save points. Visitors can preview missions and use the public Playground.</p></details></div>
  <aside class="lab-sidebar"><section class="lab-board"><div class="lab-section-heading"><h2>Leaderboard</h2><span aria-hidden="true">🏆</span></div><div class="lab-board-tabs"><button id="labGlobalTab" type="button" aria-pressed="true">Global</button><button id="labClassTab" type="button" aria-pressed="false">My class</button></div><div id="labClassControls" hidden><select id="practiceClass" aria-label="Choose your practice class"></select><p id="labClassHint"></p></div><ol id="practiceStandings" aria-label="Practice rankings"></ol><p id="labBoardFootnote" class="lab-board-footnote">Current season · top 30 public aliases. Equal points share a rank.</p></section><details class="lab-public-preferences"><summary>Your public leaderboard alias</summary><p>Choose a nickname, never your real name, school or email. Public rows contain only aliases, season points and mission counts. Joining is optional.</p><form id="labPreferences" hidden><label for="labAlias">Nickname<input id="labAlias" maxlength="24" minlength="3" pattern="[A-Za-z0-9 _-]{3,24}" required autocomplete="off"></label><label class="lab-checkbox"><input id="labOptIn" type="checkbox"> Show my alias and points publicly</label><button id="labPreferencesSave" type="submit">Save leaderboard choice</button><p id="labPreferencesStatus" role="status"></p></form><a id="labPreferencesSignin" href="login.html">Sign in to join the season →</a></details><section class="lab-tip-card"><span aria-hidden="true">✦</span><h3>Try. Learn. Come back stronger.</h3><p>Incorrect answers are part of practice. Every difficulty has a minimum reward, so you can keep learning.</p></section></aside></div>`;}
field("practiceApp").innerHTML=markup();
const bindControl=(id,event,handler)=>{
  const control=field(id);
  if(!control){console.warn("[Adminerva Games] Missing control:",id);return null;}
  control.addEventListener(event,handler);
  return control;
};
window.__adminervaGamesReady={base:true,enhanced:false,backend:false,version:"3.3.0"};

bindControl("practiceSyncBtn","click",()=>{
  const action=async()=>{if(busy)return;connectBoard();await refreshHub();if(mission&&!attempt?.attemptId&&eligible)await openMission(course,mission);else setBusy(false);};
  if(typeof window.withLoading==="function")void window.withLoading("Refreshing practice progress…",action,{button:field("practiceSyncBtn")});
  else void action();
});
bindControl("practiceBackBtn","click",()=>{returnToGamesHub();});
bindControl("practiceCheckBtn","click",()=>{void submit();});
bindControl("labHintBtn","click",()=>{if(!busy)revealHint();});
bindControl("gamesSprintReset","click",()=>{if(!busy)resetSprint();});
bindControl("labReopenMission","click",()=>{if(!busy&&mission){field("labReopenMission").hidden=true;void openMission(course,mission);}});
bindControl("practiceReconnectBtn","click",async()=>{
  if(busy||!user)return;
  const button=field("practiceReconnectBtn"),end=window.beginLoading?.("Reconnecting Practice account…")||(()=>{});
  button.disabled=true;sync("Reconnecting…","saving");
  try{
    await resumePracticeSession({season:true,reauthenticate:true});
    await refreshHub();
    button.hidden=true;sync("Connected");
    if(mission)await openMission(course,mission);
  }catch(error){
    if(error.details?.reason==="transfer-required"){field("practiceTransferBtn").hidden=false;notice("Practice is active on another device. Continue here to transfer the scored session safely.","warning");}
    else notice(error.message||"Practice could not reconnect. Sign out and sign in again, then retry.","error");
    sync("Connection needed","error");
  }finally{button.disabled=false;end();}
});
bindControl("practiceTransferBtn","click",async()=>{if(busy||!user||!confirm("Move practice to this device? Other active practice sessions stop submitting; your saved points stay safe."))return;setBusy(true);try{await connect(true);setBusy(false);if(mission)await openMission(course,mission);}catch(error){errorFeedback(error);}finally{setBusy(false);}});
bindControl("labPendingResume","click",()=>{if(busy||!pending)return;const entry=COURSES.find(item=>item.id===pending.courseId),target=entry?.missions.find(item=>item.id===pending.missionId);if(target)void openMission(entry,target);});
bindControl("labNextMission","click",()=>{if(busy||!mission)return;const pool=gameMissions(course).length?gameMissions(course):course.missions,index=pool.findIndex(item=>item.id===mission.id),next=pool.slice(Math.max(0,index+1)).find(item=>!completed(item.id))||pool.find(item=>!completed(item.id))||pool[(Math.max(0,index)+1)%pool.length];if(next)void openMission(course,next);});
bindControl("labGlobalTab","click",()=>{boardMode="global";renderBoard();});
bindControl("labClassTab","click",()=>{boardMode="class";renderBoard();});
bindControl("practiceClass","change",()=>void refreshHub());
bindControl("labPreferences","submit",async event=>{event.preventDefault();if(busy||!eligible)return;const uid=user?.uid;field("labPreferencesSave").disabled=true;const end=window.beginLoading?.("Saving leaderboard choices…")||(()=>{});field("labPreferencesStatus").textContent="Saving choice…";try{const result=await call("practicePreferences",{alias:field("labAlias").value.trim(),optIn:field("labOptIn").checked});if(uid!==user?.uid)return;hub={...hub,...result};field("labPreferencesStatus").textContent=result.optIn?"Saved. Your alias is on the public leaderboard.":"Saved. Your alias is hidden from the public leaderboard.";await refreshHub();}catch(error){if(uid===user?.uid)field("labPreferencesStatus").textContent=error.message||"Choice could not save. Try again.";}finally{field("labPreferencesSave").disabled=false;end();}});

/* Render a usable mission browser before auth/network work completes. */
renderSummary();
renderCourses();
renderBoard();

if(!guestPage){
  try{
    enhanceGamesHub();
    window.__adminervaGamesReady.enhanced=true;
    bindControl("labHeroContinue","click",()=>{if(busy)return;const button=field("labHeroContinue"),targetCourse=COURSES.find(item=>item.id===button?.dataset.course),target=targetCourse?.missions.find(item=>item.id===button?.dataset.mission);if(target)void openMission(targetCourse,target);});
    renderSummary();
    renderCourses();
    renderChallenges();
  }catch(error){
    document.body.dataset.gamesUi="fallback";
    console.error("[Adminerva Games] Enhanced UI failed; base game browser remains active.",error);
    notice("Games are running in compatibility mode. Core missions remain available while the enhanced layout reconnects.","warning");
  }
}

let stopBoard=()=>{};
function connectBoard(){
  try{
    stopBoard();stopBoard=()=>{};publicBoardError=false;
    if(user){publicBoardReady=true;renderBoard();return;}
    stopBoard=onSnapshot(query(collection(db,"practice_public_rankings"),orderBy("points","desc"),limit(30)),snapshot=>{
      globalRows=snapshot.docs.map(row=>row.data()).filter(row=>row.season===PRACTICE_SEASON);
      publicBoardReady=true;publicBoardError=false;renderBoard();
    },()=>{publicBoardError=true;renderBoard();});
  }catch(error){
    publicBoardError=true;renderBoard();console.warn("[Adminerva Games] Rankings unavailable.",error);
    stopBoard=()=>{};
  }
}
connectBoard();

onAuthStateChanged(auth,async current=>{
  epoch++;loadSequence++;user=current;eligible=false;accountPreview=false;hub={};mission=null;attempt=null;answer=null;busy=false;resetPracticeSession();pending=localGet(pendingKey());
  connectBoard();
  try{
    field("practiceMissionPanel").hidden=true;field("labMapPanel").hidden=false;field("practiceTransferBtn").hidden=true;
    renderSummary();renderCourses();renderBoard();
    await refreshHub();
    window.__adminervaGamesReady.backend=true;
    pendingNotice();
    const params=new URLSearchParams(location.search),requested=COURSES.find(item=>item.id===params.get("course")),target=requested?.missions.find(item=>item.id===params.get("mission"));
    if(target)await openMission(requested,target);
  }catch(error){
    eligible=false;busy=false;setBusy(false);
    renderSummary();renderCourses();renderBoard();
    console.error("[Adminerva Games] Account initialization failed; browse mode remains active.",error);
    notice("Your saved progress could not reconnect, but the games and mission previews are still available. Refresh progress to retry.","warning");
  }
});
window.addEventListener("pagehide",()=>stopBoard());


