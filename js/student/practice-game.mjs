/** One public mission map. Authenticated submissions and every point are checked by the server. */
import {app,auth,db} from "../core/firebase-core.js?v=1.3.0";
import {onAuthStateChanged} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import {getFunctions,httpsCallable} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-functions.js";
import {collection,query,orderBy,limit,onSnapshot} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import {COURSES,hashSeed} from "./practice-courses.mjs?v=1.4.1";
import {PROGRAMMING_GAMES,getProgrammingGame,programmingGameMatches} from "./practice-games.mjs?v=1.2.0";
import {PRACTICE_SEASON,DIFFICULTIES,missionMeta,seasonActivity,publicActivity} from "./practice-season.mjs?v=1.4.1";
import {resumePracticeSession,activePracticeSession,resetPracticeSession,practiceRequest} from "./practice-session.mjs?v=1.3.0";
import {practiceBridgeKey} from "./practice-playground-bridge.mjs?v=1.3.0";
const functions=getFunctions(app,"asia-southeast1"),field=id=>document.getElementById(id),guestPage=document.body.dataset.practiceAccess==="public";
const typeNames=guestPage?{choice:"Choose the answer",output:"Write the output",ordering:"Build the sequence",matching:"Match the pairs",debugging:"Fix the bug"}:{choice:"Quick Pick",output:"Code Trace",ordering:"Code Builder",matching:"Logic Match",debugging:"Bug Hunt"},typeIcons={choice:"◉",output:"⌨",ordering:"⇅",matching:"⇄",debugging:"⌁"};
const initialGame=getProgrammingGame(new URLSearchParams(location.search).get("game"));
const TOTAL_MISSIONS=COURSES.reduce((sum,entry)=>sum+entry.missions.length,0);
let user=null,eligible=false,hub={},course=COURSES[0],activeGame=initialGame.external?"all":initialGame.id,mission=null,attempt=null,answer=null,busy=false,epoch=0,loadSequence=0,pending=null,boardMode="global",globalRows=[],publicBoardReady=false,publicBoardError=false,assignedPacks=[];
function node(tag,text,className=""){const item=document.createElement(tag);if(text!==undefined)item.textContent=text;item.className=className;return item;}
function localGet(key){try{return JSON.parse(sessionStorage.getItem(key)||"null");}catch{return null;}}
function localSet(key,value){try{if(value===null)sessionStorage.removeItem(key);else sessionStorage.setItem(key,JSON.stringify(value));return true;}catch{return false;}}
const owner=()=>user?.uid||"public-visitor-v1",pendingKey=()=>"Adminerva_Season_Pending_"+owner(),draftKey=()=>"Adminerva_Season_Draft_"+owner()+"_"+(mission?.id||""),resumeKey=()=>"Adminerva_Games_Resume_"+owner();
function persistentGet(key){try{return JSON.parse(localStorage.getItem(key)||"null");}catch{return null;}}
function persistentSet(key,value){try{if(value===null)localStorage.removeItem(key);else localStorage.setItem(key,JSON.stringify(value));return true;}catch{return false;}}
function saveDraft(){if(mission)localSet(draftKey(),{answer});}
function sync(message,tone="ready"){field("labSync").textContent=message;field("labSync").dataset.tone=tone;}
function notice(message,tone="info"){field("labNoticeText").textContent=message;field("labNotice").hidden=!message;field("labNotice").dataset.tone=tone;}
function feedback(message,tone="info"){field("practiceFeedback").textContent=message;field("practiceFeedback").dataset.tone=tone;field("practiceFeedback").hidden=!message;}
function setBusy(value){busy=value;field("practiceMissionPanel").setAttribute("aria-busy",String(value));for(const id of ["practiceCheckBtn","practiceBackBtn","practiceTransferBtn","practiceSyncBtn","labPreferencesSave","labNextMission"])field(id).disabled=value;field("practiceClass").disabled=value||!(hub.classes||[]).length;for(const control of field("practiceChoices").querySelectorAll("input,select,button"))control.disabled=value||!!pending||control.dataset.boundary==="true";field("practiceCheckBtn").textContent=value?(pending?"Saving…":"Please wait…"):pending?"Retry save":attempt?.completed?"Check replay":"Submit answer";field("practiceCheckBtn").disabled=value||!eligible||!attempt?.attemptId;}
function completed(id){return (hub.courses||[]).some(row=>row.completed?.includes(id));}
function earned(id){for(const row of hub.courses||[])if(row.missionScores?.[id]!==undefined)return row.missionScores[id];return 0;}
function renderSummary(){
  const points=hub.points||0,count=hub.completedCount||0,level=1+Math.floor(points/250);
  field("practiceOverview").replaceChildren(...[[points.toLocaleString(),"Skill XP"],[count+" / "+TOTAL_MISSIONS,"Missions"],["Level "+level,"Season level"]].map(([value,label])=>{const item=node("div",undefined,"lab-stat");item.append(node("strong",value),node("span",label));return item;}));
  field("labPreviousProgress").textContent=hub.legacyCount?hub.legacyCount+" earlier missions are preserved.":"Practice XP stays separate from school grades.";
  field("labIdentity").textContent=user?user.displayName||hub.alias||"Signed-in learner":"Public visitor";
  field("labAccountLink").textContent=user?"My workspace":"Sign in";field("labAccountLink").href=user?(guestPage?"guest-home.html":"student-home.html"):"login.html";
  field("labPreferences").hidden=!eligible;field("labPreferencesSignin").hidden=eligible;
  if(document.activeElement!==field("labAlias"))field("labAlias").value=hub.alias||"";
  field("labOptIn").checked=hub.optIn===true;
  const select=field("practiceClass"),selected=hub.classId||"";select.replaceChildren();
  for(const profile of hub.classes||[])select.add(new Option(profile.section,profile.id));select.disabled=!(hub.classes||[]).length;select.hidden=!(hub.classes||[]).length;select.value=selected;
  field("labClassHint").textContent=(hub.classes||[]).length?"Only your class sees this private class board.":"Your class board appears when your school links a student section.";
  renderHubHero();
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
  const last=persistentGet(resumeKey());
  if(last?.courseId&&last?.missionId){
    const lastCourse=COURSES.find(entry=>entry.id===last.courseId),lastMission=lastCourse?.missions.find(item=>item.id===last.missionId);
    if(lastCourse&&lastMission&&!completed(lastMission.id)&&gameMissions(lastCourse).some(item=>item.id===lastMission.id))return {course:lastCourse,mission:lastMission,resume:true};
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
  const target=3;
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
  field("labHeroSub").textContent=target?(target.course.name+" · "+typeNames[missionMeta(target.course,target.mission).type]):"Choose a game and start a mission.";
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
    if(next){const button=node("button",done===total&&total?"Review":"Continue","games-challenge-button");button.type="button";button.addEventListener("click",()=>{if(busy)return;activeGame="all";course=next.course;renderCourses();void openMission(next.course,next.mission);});card.append(button);}
    list.append(card);
  }
}
window.addEventListener("adminerva:practice-packs",event=>{assignedPacks=Array.isArray(event.detail?.packs)?event.detail.packs:[];renderChallenges();renderHubHero();});
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
  const map=field("labMapPanel");map.classList.add("games-section");const headings=map.querySelectorAll(".lab-section-heading h2");if(headings[0])headings[0].textContent="Recommended games";if(headings[1])headings[1].textContent="Skill paths";
  const challenges=node("section",undefined,"games-challenges");challenges.id="gamesChallenges";const challengeHead=node("div",undefined,"games-challenge-section-head"),challengeTitle=node("div");challengeTitle.append(node("p","CHALLENGES","lab-eyebrow"),node("h2","Teacher missions"));const challengeCount=node("span","None assigned","lab-pill");challengeCount.id="gamesChallengeCount";challengeHead.append(challengeTitle,challengeCount);const challengeList=node("div",undefined,"games-challenge-list");challengeList.id="gamesChallengeList";challenges.append(challengeHead,challengeList);map.prepend(challenges);
  const sidebar=content.querySelector(".lab-sidebar"),dailyCard=node("section",undefined,"games-utility-card games-glass games-daily-card"),dailyTitle=node("div",undefined,"games-utility-title");dailyTitle.append(node("strong","Daily Quest"),node("span","◫"));const dailyRow=node("div",undefined,"games-daily-row"),dailyText=node("span","0 / 3 missions");dailyText.id="labDailyQuestText";const dailyPips=node("div",undefined,"games-daily-pips");dailyPips.id="labDailyQuestPips";for(let index=1;index<=3;index++)dailyPips.append(node("span",String(index)));dailyRow.append(dailyText,dailyPips);dailyCard.append(dailyTitle,dailyRow),levelCard=node("section",undefined,"games-utility-card games-glass"),levelTitle=node("div",undefined,"games-utility-title"),levelLabel=node("strong","Skill XP"),levelText=node("span","Lv. 1");levelText.id="labLevelText";levelTitle.append(levelLabel,levelText);const levelRow=node("div",undefined,"games-level-row"),nextLevel=node("strong","Next level"),levelPoints=node("small","0 / 250 XP");levelPoints.id="labLevelPoints";levelRow.append(nextLevel,levelPoints);const levelMeter=node("div",undefined,"games-meter"),levelFill=node("span");levelFill.id="labLevelProgress";levelMeter.append(levelFill);levelCard.append(levelTitle,levelRow,levelMeter);
  const achievementCard=node("section",undefined,"games-utility-card games-glass"),achievementTitle=node("div",undefined,"games-utility-title");achievementTitle.append(node("strong","Achievements"),node("span","◆"));const achievements=node("div",undefined,"games-achievements");[["labBadgeStarter","✦","First Win · complete 1 mission"],["labBadgeExplorer","⌁","Bug Hunter · complete 5 debugging missions"],["labBadgeMaster","◇","OOP Architect · complete 10 OOP missions"]].forEach(([id,icon,label])=>{const badge=node("span",icon,"games-badge");badge.id=id;badge.title=label;badge.setAttribute("aria-label",label);achievements.append(badge);});achievementCard.append(achievementTitle,achievements);
  const progressCard=node("section",undefined,"games-utility-card games-glass"),progressTitle=node("div",undefined,"games-utility-title");progressTitle.append(node("strong","Your progress"),node("span","▥"));const rings=node("div",undefined,"games-progress-rings");[["labProgressLogic","Logic"],["labProgressDebug","Debug"],["labProgressOop","OOP"]].forEach(([id,label])=>{const wrap=node("div",undefined,"games-progress-item"),ring=node("div",undefined,"games-progress-ring");ring.id=id;ring.style.setProperty("--value","0");ring.append(node("strong","0%"));wrap.append(ring,node("small",label));rings.append(wrap);});progressCard.id="gamesProgress";progressCard.append(progressTitle,rings,field("practiceOverview"),field("labPreviousProgress"));
  const preferences=sidebar.querySelector(".lab-public-preferences");if(preferences?.querySelector("summary"))preferences.querySelector("summary").textContent="Leaderboard profile";
  const legacyBoard=sidebar.querySelector(".lab-board"),rankings=document.createElement("details");rankings.className="lab-board games-ranking-card";const rankSummary=node("summary",undefined,"games-ranking-summary");rankSummary.append(node("span","Rankings"),node("span","🏆"));if(legacyBoard){rankings.append(rankSummary,...legacyBoard.children);legacyBoard.replaceWith(rankings);}sidebar.querySelector(".lab-tip-card")?.remove();
  sidebar.prepend(progressCard);sidebar.prepend(achievementCard);sidebar.prepend(levelCard);sidebar.prepend(dailyCard);
  assignedPacks=Array.isArray(window.__adminervaPracticePacks)?window.__adminervaPracticePacks:[];renderChallenges();
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
function gameMissions(entryCourse,gameId=activeGame){return entryCourse.missions.filter(entry=>programmingGameMatches(gameId,entryCourse,entry,missionMeta(entryCourse,entry),missionModule(entryCourse,entry)));}
function ensureCourseForGame(){if(gameMissions(course).length)return;course=COURSES.find(entry=>gameMissions(entry).length)||COURSES[0];}
function recommendedGameId(){
  if(!(hub.completedCount||0))return "code-sprint";
  const target=weakestSkillTarget();
  return target?.recommendation==="OOP"?"oop-builder":target?.recommendation==="Debugging"?"bug-detective":target?.recommendation==="Logic"?"logic-circuit":"code-sprint";
}
function renderGameCatalog(){
  const catalog=field("labGameCatalog");if(!catalog)return;catalog.replaceChildren();
  const recommended=guestPage?null:recommendedGameId(),ordered=guestPage?[...PROGRAMMING_GAMES]:[...PROGRAMMING_GAMES].sort((a,b)=>a.id===recommended?-1:b.id===recommended?1:a.id==="all"?-1:b.id==="all"?1:0);
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
    const top=node("div",undefined,"lab-game-card-top");
    top.append(node("span",game.icon,"lab-game-card-icon"),node("span",game.id===recommended?"FOR YOU":game.tag,"lab-game-card-tag"));
    item.append(top,node("strong",game.name),node("p",game.description));
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
    const visible=module.missions.filter(entry=>programmingGameMatches(activeGame,course,entry,missionMeta(course,entry),module));if(!visible.length)return;
    const section=node("section",undefined,"lab-map-module"),heading=node("div",undefined,"lab-module-heading"),count=visible.filter(item=>completed(item.id)).length;
    heading.append(node("span",String(moduleIndex+1).padStart(2,"0"),"lab-module-number"),node("h3",module.title),node("small",count+" / "+visible.length));section.append(heading);
    const path=node("div",undefined,"lab-mission-path");path.setAttribute("aria-label",module.title+" missions");
    visible.forEach(entry=>{
      const meta=missionMeta(course,entry),done=completed(entry.id),button=node("button",undefined,"lab-mission-node"+(done?" is-complete":""));button.type="button";button.dataset.difficulty=meta.name.toLowerCase();button.title=entry.title+" · "+typeNames[meta.type]+" · "+meta.name;button.setAttribute("aria-label",entry.title+", "+typeNames[meta.type]+", "+meta.name+", "+(done?earned(entry.id)+" points earned":meta.maximum+" points available"));
      button.append(node("span",done?"✓":typeIcons[meta.type],"lab-node-icon"),node("small",done?earned(entry.id)+" pts":meta.maximum+" pts"),node("span",String(course.missions.findIndex(item=>item.id===entry.id)+1),"lab-node-number"));button.addEventListener("click",()=>void openMission(course,entry));path.append(button);
    });section.append(path);map.append(section);
  });
}
function renderBoard(){
  field("labGlobalTab").setAttribute("aria-pressed",String(boardMode==="global"));field("labClassTab").setAttribute("aria-pressed",String(boardMode==="class"));field("labClassControls").hidden=boardMode!=="class";
  field("labBoardFootnote").textContent=boardMode==="global"?"Current season · top 30 public aliases. Equal points share a rank.":"Current season · private class aliases. Equal points share a rank.";
  const rows=boardMode==="global"?globalRows:hub.classRows||[],list=field("practiceStandings");list.replaceChildren();
  if(!rows.length){const message=boardMode==="global"?(publicBoardError?"Rankings could not connect. Refresh to try again.":publicBoardReady?"A new season is starting. Opt in and set the pace.":"Connecting to public rankings…"):(eligible?"No class scores yet. Finish a mission to begin.":"Sign in with a linked student account to see your class.");list.append(node("li",message,"lab-board-empty"));return;}
  let rank=0,prior=null;rows.forEach((row,index)=>{if(row.points!==prior)rank=index+1;prior=row.points;const item=node("li",undefined,"lab-rank-row"+(row.isCurrent?" is-you":""));item.append(node("span",rank<=3?["🥇","🥈","🥉"][rank-1]:String(rank),"lab-rank-number"),node("span",row.alias+(row.isCurrent?" · You":"")),node("strong",row.points.toLocaleString()+" points"));list.append(item);});
}
async function call(name,payload={}){const uid=auth.currentUser?.uid,result=await httpsCallable(functions,name)(payload);if(auth.currentUser?.uid!==uid)throw Error("Account changed. Reload practice before continuing.");return result.data;}
async function refreshHub(classId=field("practiceClass").value){const version=epoch,uid=user?.uid;try{const result=await call("practiceHub",{classId:classId||""});if(version!==epoch||uid!==user?.uid)return;hub=result;eligible=result.eligible===true;renderSummary();renderCourses();renderBoard();renderChallenges();sync(user?"Saved to your account":"Public preview");if(user&&!eligible)notice("Finish your access request to save practice. You can still browse every mission.");else if(!pending)notice("");}catch(error){if(version!==epoch)return;eligible=false;sync("Connection needed","error");notice(error.details?.reason==="guest-registration"?"Finish your access request from My workspace, then refresh practice.":"Practice could not connect. The map remains available. Refresh to reconnect before submitting an answer.","error");renderSummary();}}
function errorFeedback(error){const reason=error.details?.reason,transfer=["transfer-required","recent-sign-in","session-moved","revoked-sign-in"].includes(reason);field("practiceTransferBtn").hidden=!transfer;if(transfer)notice("Practice needs to reconnect. Continue on this device to resume safely.","warning");sync("Not saved yet","error");feedback(transfer?"Continue practice on this device to reconnect. Your saved points stay safe.":error.message||"The answer could not be confirmed. Retry the same answer to avoid counting it twice.","warning");}
async function connect(takeover=false){const result=await resumePracticeSession({season:true,takeover,reauthenticate:takeover});field("practiceTransferBtn").hidden=true;sync(result.transferred?"Practice moved here":"Connected");return result;}
function readAnswer(){
  if(["choice","debugging"].includes(attempt.question.type)){const selected=field("practiceChoices").querySelector("input:checked");return selected?Number(selected.value):null;}
  if(attempt.question.type==="output")return field("labOutputAnswer").value.trim();
  if(attempt.question.type==="ordering")return answer;
  return [...field("practiceChoices").querySelectorAll("select")].map(select=>select.value===""?null:Number(select.value));
}
function renderAnswer(){
  const question=attempt.question,container=field("practiceChoices");container.replaceChildren();
  if(["choice","debugging"].includes(question.type))question.choices.forEach((value,index)=>{const label=node("label",undefined,"lab-answer-choice"),radio=document.createElement("input");radio.type="radio";radio.name="practiceAnswer";radio.value=String(index);radio.checked=answer===index;radio.addEventListener("change",()=>{answer=index;saveDraft();});label.append(radio,node("span",value));container.append(label);});
  else if(question.type==="output"){const label=node("label","Your exact answer","lab-answer-label"),input=document.createElement("input");input.id="labOutputAnswer";input.type="text";input.maxLength=500;input.autocomplete="off";input.spellcheck=false;input.value=typeof answer==="string"?answer:"";input.placeholder="Type the result or requested element…";input.addEventListener("input",()=>{answer=input.value;saveDraft();});label.htmlFor=input.id;container.append(label,input);}
  else if(question.type==="ordering"){
    if(!Array.isArray(answer)||answer.length!==question.items.length)answer=question.items.map((item,index)=>index);
    const list=node("ol",undefined,"lab-order-list");answer.forEach((itemIndex,position)=>{const row=node("li"),code=node("code",question.items[itemIndex]),actions=node("div",undefined,"lab-order-actions");for(const [delta,symbol,label] of [[-1,"↑","Move statement up"],[1,"↓","Move statement down"]]){const button=node("button",symbol);button.type="button";button.setAttribute("aria-label",label);button.dataset.boundary=String(position+delta<0||position+delta>=answer.length);button.disabled=button.dataset.boundary==="true";button.addEventListener("click",()=>{if(busy||pending||button.dataset.boundary==="true")return;const next=position+delta;[answer[position],answer[next]]=[answer[next],answer[position]];saveDraft();renderAnswer();});actions.append(button);}row.append(node("span",String(position+1),"lab-order-position"),code,actions);list.append(row);});container.append(list);
  }else{
    if(!Array.isArray(answer)||answer.length!==question.left.length)answer=question.left.map(()=>null);
    question.left.forEach((value,index)=>{const label=node("label",undefined,"lab-match-row"),select=document.createElement("select");label.append(node("strong",value));select.setAttribute("aria-label","Match "+value);select.add(new Option("Choose a match…",""));question.right.forEach((right,rightIndex)=>select.add(new Option(right,String(rightIndex))));select.value=answer[index]===null?"":String(answer[index]);select.addEventListener("change",()=>{answer[index]=select.value===""?null:Number(select.value);saveDraft();});label.append(select);container.append(label);});
  }
  for(const control of container.querySelectorAll("input,select,button"))if(busy||pending)control.disabled=true;
}
function renderMechanicAid(question){
  const panel=field("labMechanicPanel");panel.replaceChildren();panel.hidden=true;panel.dataset.kind="";panel.classList.remove("is-trace","is-debug");
  field("practiceCode").hidden=!question.code;
  if(!guestPage&&mission?.oop===true){
    const blueprints={
      "oop-classes":["CLASS","creates","OBJECT"],
      "oop-encapsulation":["PRIVATE STATE","controlled by","METHODS"],
      "oop-inheritance":["PARENT","extends to","CHILD"],
      "oop-polymorphism":["REFERENCE","dispatches to","RUNTIME TYPE"],
      "oop-real":["OBJECT","works with","OBJECT"]
    },parts=blueprints[mission.oopModule]||["OOP","connects","BEHAVIOR"],blueprint=node("div",undefined,"games-oop-blueprint"),head=node("div",undefined,"games-oop-blueprint-head");
    head.append(node("span","OOP BLUEPRINT","lab-mechanic-kicker"),node("strong",mission.title.replace(/ · (Guided|Apply|Challenge)$/,"")));
    const flow=node("div",undefined,"games-oop-flow");flow.append(node("span",parts[0],"games-oop-node"),node("span",parts[1],"games-oop-link"),node("span",parts[2],"games-oop-node"));
    blueprint.append(head,flow);panel.append(blueprint);panel.hidden=false;panel.dataset.kind="oop";
  }
  const hasTraceGuide=Array.isArray(question.traceGuide)&&question.traceGuide.length;
  if(question.type==="output"&&(!guestPage||hasTraceGuide)){
    panel.hidden=false;panel.dataset.kind="trace";
    const head=node("div",undefined,"lab-mechanic-head");head.append(node("span",guestPage?"TRACE QUEST":"CODE TRACE","lab-mechanic-kicker"),node("strong","Trace board"));
    const guide=hasTraceGuide?question.traceGuide:["Read the starting values.","Follow each call or update in order.","Write the exact final output."];
    const list=node("ol",undefined,"lab-trace-steps");guide.forEach(step=>list.append(node("li",step)));
    panel.append(head,list);
  }
  if(question.type==="debugging"&&Number.isInteger(question.focusLine)&&question.code){
    panel.hidden=false;panel.dataset.kind="debug";field("practiceCode").hidden=true;
    const head=node("div",undefined,"lab-mechanic-head");head.append(node("span","BUG HUNT","lab-mechanic-kicker"),node("strong","Case file"));
    const hint=node("p",question.caseHint||"Inspect the highlighted line and compare it with the stated goal.","lab-case-hint");
    const viewer=node("div",undefined,"lab-code-case");
    question.code.split("\n").forEach((text,index)=>{const row=node("div",undefined,"lab-code-line"+(index+1===question.focusLine?" is-focus":""));row.append(node("span",String(index+1),"lab-code-line-number"),node("code",text||" "));viewer.append(row);});
    panel.append(head,hint,viewer);
  }
  if(!guestPage&&question.type==="ordering"){
    panel.hidden=false;if(!panel.dataset.kind)panel.dataset.kind="build";const head=node("div",undefined,"lab-mechanic-head");head.append(node("span","CODE BUILDER","lab-mechanic-kicker"),node("strong","Arrange the blocks"));panel.append(head);
  }
  if(!guestPage&&question.type==="matching"){
    panel.hidden=false;if(!panel.dataset.kind)panel.dataset.kind="match";const head=node("div",undefined,"lab-mechanic-head");head.append(node("span","LOGIC MATCH","lab-mechanic-kicker"),node("strong","Complete the pairs"));panel.append(head);
  }
}
function pointsText(){const meta=attempt.question.difficulty;field("labMissionPoints").textContent=attempt.completed?attempt.earnedPoints+" pts earned":attempt.availablePoints+" pts available";field("labScoringHint").textContent=attempt.completed?"Completed · replays do not change XP.":meta.name+" · "+meta.maximum+" pts max · −"+meta.deduction+" per miss · "+meta.floor+" pt floor · experiments are free.";}
async function openMission(selectedCourse,selectedMission){
  if(busy)return;const end=window.beginLoading?.("Preparing practice mission…")||(()=>{});saveDraft();course=selectedCourse;mission=selectedMission;persistentSet(resumeKey(),{courseId:course.id,missionId:mission.id,gameId:activeGame,openedAt:Date.now()});attempt=null;answer=localGet(draftKey())?.answer??null;const version=epoch,sequence=++loadSequence;
  field("labReopenMission").hidden=true;
  field("practiceCheckBtn").hidden=true;field("labSubmitSignin").hidden=true;
  const themeGame=activeGame==="all"?missionGameId(course,mission):activeGame;field("labMapPanel").hidden=true;const missionPanel=field("practiceMissionPanel");missionPanel.hidden=false;missionPanel.dataset.game=themeGame;field("practiceMissionTitle").textContent=mission.title.replace(/ · (Guided|Apply|Challenge)$/,"");field("practiceCourseName").textContent=course.name;field("labMissionType").textContent=typeNames[missionMeta(course,mission).type];field("practiceChoices").replaceChildren();field("practiceCode").textContent="";field("practicePrompt").textContent="Preparing your mission…";field("labExperimentLink").hidden=true;field("labNextMission").hidden=true;feedback("");setBusy(true);
  field("labGameName").textContent=getProgrammingGame(themeGame).name;field("practiceMissionTitle").focus({preventScroll:true});field("practiceMissionPanel").scrollIntoView({behavior:"smooth",block:"start"});
  try{
    if(eligible&&user){if(!activePracticeSession()||activePracticeSession().expiresAt<Date.now())await connect();attempt=await practiceRequest("practiceMissionStart",{courseId:course.id,missionId:mission.id});}
    else{const preview=seasonActivity(course,mission,Math.abs(hashSeed(PRACTICE_SEASON+mission.id))),meta=missionMeta(course,mission);attempt={question:publicActivity(preview),availablePoints:meta.maximum,completed:false,previewWorkspace:preview.workspace};}
    if(version!==epoch||sequence!==loadSequence)return;
    if(pending?.missionId===mission.id){if(pending.attemptId===attempt.attemptId)answer=pending.answer;else{pending=null;localSet(pendingKey(),null);notice("The previous answer session ended. This mission shows your latest server score; no answer was submitted again.");}}
    field("practiceCode").textContent=attempt.question.code||"";field("practiceCode").hidden=!attempt.question.code;field("practicePrompt").textContent=attempt.question.prompt;renderMechanicAid(attempt.question);pointsText();renderAnswer();
    field("labSubmitSignin").hidden=eligible;field("practiceCheckBtn").hidden=!eligible;
    field("labSubmitSignin").textContent=user?"Open my access request":"Sign in to submit";field("labSubmitSignin").href=user?"guest-home.html":"login.html";
    if(!eligible)feedback(user?"Your account cannot submit yet. Finish your access request or verify your email, then refresh.":"Explore the mission freely. Sign in to submit answers and save season points.");
    if(attempt.completed){feedback("Mission already completed: "+attempt.earnedPoints+" points saved. "+(attempt.explanation||""),"success");field("labNextMission").hidden=false;prepareExperiment(attempt.workspace);}
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
    if(result.correct){attempt.completed=true;attempt.earnedPoints=result.earnedPoints;prepareExperiment(result.workspace);field("labNextMission").hidden=false;feedback((result.awarded?"Mission complete! +"+result.earnedPoints+" points. ":"Correct replay. Your original reward stays saved. ")+(result.explanation||""),"success");if(result.awarded)celebrateMission();await refreshHub();sync(result.awarded?"Saved · +"+result.earnedPoints+" points":"Replay checked");}
    else if(result.alreadyRecorded){feedback("Not quite. This is a replay, so your saved points are unchanged. "+(result.explanation||""),"warning");sync("Replay checked");}
    else{attempt.availablePoints=result.availablePoints;attempt.wrongSubmissions=result.wrongSubmissions;feedback(result.deduction?"Not quite. This scored submission used "+result.deduction+" points from this mission’s possible reward. "+result.availablePoints+" points remains available. Adjust your answer and try again.":"Not quite. You have reached this mission’s minimum reward; more attempts cannot reduce it further. Keep trying.","warning");sync("Attempt saved");}
    pointsText();renderAnswer();
  }catch(error){if(version===epoch){const reason=error.details?.reason;if(["answer-incomplete","practice-rate-limit","attempt-expired","enrollment","guest-registration","session-moved"].includes(reason)){pending=null;localSet(pendingKey(),null);if(reason==="attempt-expired")field("labReopenMission").hidden=false;}errorFeedback(error);pendingNotice();}}
  finally{if(version===epoch)setBusy(false);end();}
}
function markup(){return `
  <header class="lab-hero"><div><p class="lab-eyebrow">ADMINERVA GAMES · COMPUTER PROGRAMMING</p><h1>Choose a game.<br><span>Build the skill.</span></h1><p>Debug, trace, arrange, match, repair, and experiment across Java, Python, Web, Logic, and XML.</p><div class="lab-hero-links"><a href="${guestPage?"guest-playground.html":"student-playground.html"}">Open Code Playground ↗</a><a href="${guestPage?"guest-xml-lab.html":"student-xml-lab.html"}">Open XML Layout Lab ↗</a></div></div><div class="lab-hero-mark" aria-hidden="true">&lt;/&gt;<span>COMPUTER PROGRAMMING</span></div></header>
  <div class="lab-statusbar"><span id="labIdentity">Public visitor</span><span id="labSync" role="status">Connecting…</span><button id="practiceSyncBtn" type="button">↻ Refresh progress</button><a id="labAccountLink" href="login.html">Sign in</a></div>
  <div id="labNotice" class="lab-notice" role="status" hidden><span id="labNoticeText"></span><button id="practiceTransferBtn" type="button" hidden>Continue practice here</button><button id="labPendingResume" type="button" hidden>Resume pending save</button></div>
  <div id="practiceOverview" class="lab-stats" aria-label="Your season progress"></div><p id="labPreviousProgress" class="lab-history"></p>
  <div class="lab-workspace"><div class="lab-main"><section id="labMapPanel"><div class="lab-section-heading"><div><p class="lab-eyebrow">COMPUTER PROGRAMMING</p><h2>Choose a game</h2></div><span class="lab-pill">${PROGRAMMING_GAMES.length} game modes · ${TOTAL_MISSIONS} missions</span></div><nav id="labGameCatalog" class="lab-game-grid" aria-label="Computer Programming games"></nav><div class="lab-section-heading lab-skill-heading"><div><p class="lab-eyebrow">FILTER THE GAME</p><h2>Choose a skill path</h2></div><span class="lab-pill">Java · Python · Web · Logic</span></div><nav id="labCourseTabs" class="lab-course-tabs" aria-label="Programming skill paths"></nav><div class="lab-map-heading"><div><h2 id="labCourseTitle"></h2><p id="labCourseSubtitle"></p></div><span class="lab-map-key">✓ completed · choose any mission</span></div><div id="practiceCourseList"></div></section>
  <section id="practiceMissionPanel" class="lab-mission-panel" aria-labelledby="practiceMissionTitle" aria-busy="false" hidden><button id="practiceBackBtn" type="button" class="lab-text-button">← Back to games</button><div class="lab-mission-meta"><span id="labGameName" class="lab-pill"></span><span id="practiceCourseName"></span><span id="labMissionType" class="lab-pill"></span></div><h2 id="practiceMissionTitle" tabindex="-1"></h2><p id="labMissionPoints" class="lab-points-available"></p><pre id="practiceCode"></pre><div id="labMechanicPanel" class="lab-mechanic-panel" hidden></div><h3 id="practicePrompt"></h3><div id="practiceChoices" class="lab-answers"></div><p id="labScoringHint" class="lab-scoring-hint"></p><div id="practiceFeedback" class="lab-feedback" role="status" aria-live="polite" hidden></div><div class="lab-mission-actions"><button id="practiceCheckBtn" type="button" class="lab-primary">Submit answer</button><a id="labSubmitSignin" href="login.html" class="lab-primary" hidden>Sign in to submit</a><button id="labReopenMission" type="button" hidden>Reconnect mission</button><button id="labNextMission" type="button" class="lab-secondary" hidden>Next mission →</button></div><a id="labExperimentLink" class="lab-experiment-link" href="${guestPage?"guest-playground.html":"student-playground.html"}?practice=1" hidden>Experiment with this code in Playground ↗</a></section>
  <details class="lab-rules"><summary>How scoring works</summary><div class="lab-rules-grid">${DIFFICULTIES.map(level=>`<div><strong>${level.name}</strong><span>${level.maximum} points to start</span><small>−${level.deduction} per incorrect scored answer · floor ${level.floor} points</small></div>`).join("")}</div><p>Only selecting Submit scored answer counts as a graded attempt. Opening a mission, changing an answer, running code, compiler errors, and connection failures do not deduct points. Each mission rewards you once per season. Replays cannot add points. Practice scores do not change school grades. Earlier completion history is preserved.</p><p>Guests and students share this mission pool. A verified signed-in account with an active or pending school access request can save points. Visitors can preview missions and use the public Playground.</p></details></div>
  <aside class="lab-sidebar"><section class="lab-board"><div class="lab-section-heading"><h2>Leaderboard</h2><span aria-hidden="true">🏆</span></div><div class="lab-board-tabs"><button id="labGlobalTab" type="button" aria-pressed="true">Global</button><button id="labClassTab" type="button" aria-pressed="false">My class</button></div><div id="labClassControls" hidden><select id="practiceClass" aria-label="Choose your practice class"></select><p id="labClassHint"></p></div><ol id="practiceStandings" aria-label="Practice rankings"></ol><p id="labBoardFootnote" class="lab-board-footnote">Current season · top 30 public aliases. Equal points share a rank.</p></section><details class="lab-public-preferences"><summary>Your public leaderboard alias</summary><p>Choose a nickname, never your real name, school or email. Public rows contain only aliases, season points and mission counts. Joining is optional.</p><form id="labPreferences" hidden><label for="labAlias">Nickname<input id="labAlias" maxlength="24" minlength="3" pattern="[A-Za-z0-9 _-]{3,24}" required autocomplete="off"></label><label class="lab-checkbox"><input id="labOptIn" type="checkbox"> Show my alias and points publicly</label><button id="labPreferencesSave" type="submit">Save leaderboard choice</button><p id="labPreferencesStatus" role="status"></p></form><a id="labPreferencesSignin" href="login.html">Sign in to join the season →</a></details><section class="lab-tip-card"><span aria-hidden="true">✦</span><h3>Try. Learn. Come back stronger.</h3><p>Incorrect answers are part of practice. Every difficulty has a minimum reward, so you can keep learning.</p></section></aside></div>`;}
field("practiceApp").innerHTML=markup();
if(!guestPage){
  enhanceGamesHub();
  field("labHeroContinue").addEventListener("click",()=>{if(busy)return;const button=field("labHeroContinue"),targetCourse=COURSES.find(item=>item.id===button.dataset.course),target=targetCourse?.missions.find(item=>item.id===button.dataset.mission);if(target)void openMission(targetCourse,target);});
}
field("practiceSyncBtn").addEventListener("click",()=>void window.withLoading("Refreshing practice progress…",async()=>{if(busy)return;connectBoard();await refreshHub();if(mission&&!attempt?.attemptId&&eligible)await openMission(course,mission);else setBusy(false);},{button:field("practiceSyncBtn")}));
field("practiceBackBtn").addEventListener("click",()=>{returnToGamesHub();});
field("practiceCheckBtn").addEventListener("click",()=>{void submit();});
field("labReopenMission").addEventListener("click",()=>{if(!busy&&mission){field("labReopenMission").hidden=true;void openMission(course,mission);}});
field("practiceTransferBtn").addEventListener("click",async()=>{if(busy||!user||!confirm("Move practice to this device? Other active practice sessions stop submitting; your saved points stay safe."))return;setBusy(true);try{await connect(true);setBusy(false);if(mission)await openMission(course,mission);}catch(error){errorFeedback(error);}finally{setBusy(false);}});
field("labPendingResume").addEventListener("click",()=>{if(busy||!pending)return;const entry=COURSES.find(item=>item.id===pending.courseId),target=entry?.missions.find(item=>item.id===pending.missionId);if(target)void openMission(entry,target);});
field("labNextMission").addEventListener("click",()=>{if(busy||!mission)return;const pool=gameMissions(course).length?gameMissions(course):course.missions,index=pool.findIndex(item=>item.id===mission.id),next=pool.slice(Math.max(0,index+1)).find(item=>!completed(item.id))||pool.find(item=>!completed(item.id))||pool[(Math.max(0,index)+1)%pool.length];void openMission(course,next);});
field("labGlobalTab").addEventListener("click",()=>{boardMode="global";renderBoard();});field("labClassTab").addEventListener("click",()=>{boardMode="class";renderBoard();});field("practiceClass").addEventListener("change",()=>void refreshHub());
field("labPreferences").addEventListener("submit",async event=>{event.preventDefault();if(busy||!eligible)return;const uid=user?.uid;field("labPreferencesSave").disabled=true;const end=window.beginLoading?.("Saving leaderboard choices…")||(()=>{});field("labPreferencesStatus").textContent="Saving choice…";try{const result=await call("practicePreferences",{alias:field("labAlias").value.trim(),optIn:field("labOptIn").checked});if(uid!==user?.uid)return;hub={...hub,...result};field("labPreferencesStatus").textContent=result.optIn?"Saved. Your alias is on the public leaderboard.":"Saved. Your alias is hidden from the public leaderboard.";await refreshHub();}catch(error){if(uid===user?.uid)field("labPreferencesStatus").textContent=error.message||"Choice could not save. Try again.";}finally{field("labPreferencesSave").disabled=false;end();}});
let stopBoard=()=>{};
function connectBoard(){stopBoard();publicBoardError=false;stopBoard=onSnapshot(query(collection(db,"practice_public_rankings"),orderBy("points","desc"),limit(30)),snapshot=>{globalRows=snapshot.docs.map(row=>row.data()).filter(row=>row.season===PRACTICE_SEASON);publicBoardReady=true;publicBoardError=false;renderBoard();},()=>{publicBoardError=true;renderBoard();});}
connectBoard();
onAuthStateChanged(auth,async current=>{epoch++;loadSequence++;user=current;eligible=false;hub={};mission=null;attempt=null;answer=null;busy=false;resetPracticeSession();pending=localGet(pendingKey());field("practiceMissionPanel").hidden=true;field("labMapPanel").hidden=false;field("practiceTransferBtn").hidden=true;renderSummary();renderCourses();renderBoard();await refreshHub();pendingNotice();const params=new URLSearchParams(location.search),requested=COURSES.find(item=>item.id===params.get("course")),target=requested?.missions.find(item=>item.id===params.get("mission"));if(target)await openMission(requested,target);});
window.addEventListener("pagehide",()=>stopBoard());


