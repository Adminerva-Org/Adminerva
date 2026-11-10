/** Optional, verified account-specific home insights. No new backend endpoints. */
import {app,auth,db} from './firebase-core.js?v=1.3.0';
import {getFunctions,httpsCallable} from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-functions.js';
import {onAuthStateChanged} from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js';
import {collection,getDocs,orderBy,query,limit} from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js';

const home=document.querySelector('main[data-home-experience="student"],main[data-home-experience="teacher"]');
const nav=document.querySelector('#adminerva-nav');
const functions=getFunctions(app,"asia-southeast1");
const tenantSchools=httpsCallable(functions,"tenantSchools");
const schoolPracticeHub=httpsCallable(functions,"schoolPracticeHub");
const schoolTeacherAnalytics=httpsCallable(functions,"schoolTeacherAnalytics");
const schoolAssessments=httpsCallable(functions,"schoolAssessments");
async function v4SchoolId(user){
  let preferred=null;
  try{preferred=sessionStorage.getItem("Adminerva_last_verified_school_"+user.uid)||null;}catch{}
  const result=(await tenantSchools({preferredSchoolId:preferred})).data;
  return result.selection?.schoolId||null;
}
if(home&&nav){
  const role=home.dataset.homeExperience;
  const hero=home.querySelector('.av-home-hero');
  const summary=document.createElement('section');
  summary.className='av-home-pulse';
  summary.setAttribute('aria-label',role==='student'?'Verified learning progress':'Review inbox snapshot');
  summary.hidden=true;
  summary.innerHTML=`<div class="av-pulse-head"><div><h2></h2><p></p></div>
    <button type="button">Refresh summary</button></div>
    <div class="av-pulse-grid">
      <article class="av-pulse-metric"><span></span><strong>—</strong><p></p><div class="av-pulse-track" hidden><span></span></div></article>
      <article class="av-pulse-metric"><span></span><strong>—</strong><p></p></article>
    </div><p class="av-pulse-status" role="status" aria-live="polite">Checking your account…</p>`;
  hero?.after(summary);
  const metrics=[...summary.querySelectorAll('.av-pulse-metric')];
  const head=summary.querySelector('.av-pulse-head');
  const update=(index,label,value,description)=>{
    const element=metrics[index];
    element.querySelector('span').textContent=label;
    element.querySelector('strong').textContent=value;
    element.querySelector('p').textContent=description;
  };
  let loading=false,readyUid='',generation=0;
  const load=async(force=false)=>{
    const user=auth.currentUser;
    const actualRole=nav.dataset.verifiedRole;
    const correct=role==='student'?actualRole==='student':
      actualRole==='teacher'||actualRole==='superadmin';
    if(!user?.uid||!correct||loading||(!force&&readyUid===user.uid))return;
    readyUid=user.uid;loading=true;
    const token=++generation;
    summary.hidden=false;
    head.querySelector('h2').textContent=role==='student'?'Your verified practice progress':'Recent evidence snapshot';
    head.querySelector('p').textContent=role==='student'?
      'Based on missions saved to your student account.':'A quick view of recent inbox records, not a replacement for Review & Grade.';
    summary.querySelector('.av-pulse-status').textContent='Loading verified information…';
    summary.querySelector('button').disabled=true;
    summary.setAttribute('aria-busy','true');
    const track=metrics[0].querySelector('.av-pulse-track');
    track.hidden=role!=='student';
    update(0,role==='student'?'Missions completed':'Awaiting inspection','—','Reading verified records…');
    update(1,role==='student'?'Completed courses':'Approved evidence','—','Reading verified records…');
    try{
      const v4Cutover=nav.dataset.v4Cutover==="true";
      if(v4Cutover){
        const schoolId=await v4SchoolId(user);
        if(auth.currentUser?.uid!==user.uid||token!==generation)return;
        if(!schoolId){
          update(0,role==='student'?'Practice Points':'Active classes','—','Choose a verified school from the account menu.');
          update(1,role==='student'?'Missions completed':'Responsible deployments','—','A school must be selected before loading this summary.');
          summary.querySelector('.av-pulse-status').textContent='Choose a school from the account menu to load the verified summary.';
          return;
        }
        if(role==='student'){
          const result=(await schoolPracticeHub({schoolId})).data;
          if(auth.currentUser?.uid!==user.uid||token!==generation)return;
          update(0,'Practice Points',String(result.points||0),'Current school Practice season points. These do not change assessment grades.');
          update(1,'Missions completed',String(result.completedCount||0),'Server-checked current-season Practice missions.');
          const maximum=300;
          track.style.setProperty('--av-progress',Math.min(100,Math.round((Number(result.completedCount||0)/maximum)*100))+'%');
          summary.querySelector('.av-pulse-status').textContent='Verified school Practice summary loaded.';
        }else{
          const [scope,tasks]=await Promise.all([
            schoolTeacherAnalytics({schoolId,action:"scope"}),
            schoolAssessments({schoolId,action:"list_teacher"})
          ]);
          if(auth.currentUser?.uid!==user.uid||token!==generation)return;
          const offerings=scope.data?.offerings||[],deployments=tasks.data?.assessments||[],
            actionable=deployments.filter(item=>!["archived","cancelled"].includes(item.lifecycle||"active"));
          update(0,'Active classes',String(offerings.length),'Current canonical teaching assignments.');
          update(1,'Responsible deployments',String(actionable.length),'Active or closed assessment deployments assigned to you for review.');
          summary.querySelector('.av-pulse-status').textContent='Verified school teaching summary loaded.';
        }
      }else if(role==='student'){
        const [{COURSES},snapshot]=await Promise.all([
          import('../student/practice-courses.mjs?v=1.3.0'),
          getDocs(collection(db,'practice_verified_progress',user.uid,'courses'))
        ]);
        if(auth.currentUser?.uid!==user.uid||token!==generation)return;
        const courses=new Map(COURSES.map(course=>[course.id,course]));
        let done=0,finished=0;
        const total=COURSES.reduce((sum,course)=>sum+course.missions.length,0);
        snapshot.docs.forEach(record=>{
          const course=courses.get(record.id);
          if(!course)return;
          const valid=new Set(course.missions.map(mission=>mission.id));
          const completed=new Set((Array.isArray(record.data().completed)?record.data().completed:[])
            .filter(id=>valid.has(id)));
          done+=completed.size;
          if(course.missions.length>0&&completed.size===course.missions.length)finished++;
        });
        update(0,'Missions completed',done+' / '+total,'Saved practice progress across available missions.');
        update(1,'Completed courses',finished+' / '+COURSES.length,'Open Practice Lab to continue a course.');
        track.style.setProperty('--av-progress',(total?Math.min(100,Math.round(done*100/total)):0)+'%');
        summary.querySelector('.av-pulse-status').textContent='Verified account progress loaded. Continue in Practice Lab.';
      }else{
        // Legacy-compatible teacher pulse. V4-only staff use canonical callables above.

        const [v2,legacy]=await Promise.all([
          getDocs(query(collection(db,'assessment_evidence'),orderBy('updatedAt','desc'),limit(100))),
          getDocs(query(collection(db,'student_submissions'),orderBy('submittedAt','desc'),limit(100)))
        ]);
        if(auth.currentUser?.uid!==user.uid||token!==generation)return;
        const records=new Map();
        const key=(data,id)=>String(data.studentId||id)+'::'+String(data.assessmentId||data.taskId||id);
        // Prefer newer V2 evidence state if a legacy receipt also exists.
        for(const document of legacy.docs)records.set(key(document.data(),document.id),document.data());
        for(const document of v2.docs)records.set(key(document.data(),document.id),document.data());
        const values=[...records.values()];
        const pending=values.filter(data=>['submitted','needs_review'].includes(String(data.status||'submitted').toLowerCase())).length;
        const approved=values.filter(data=>String(data.status||'').toLowerCase()==='approved').length;
        const reopened=values.filter(data=>String(data.status||'').toLowerCase()==='reopened').length;
        update(0,'Awaiting inspection',String(pending),'Recent submitted or flagged evidence to inspect.');
        update(1,'Approved evidence',String(approved),'Recent approved items may be ready for grading.');
        summary.querySelector('.av-pulse-status').textContent=
          'Recent records only (up to 100 per source). '+reopened+' returned for revision. Open Review & Grade for authoritative status.';
      }
    }catch{
      if(auth.currentUser?.uid!==user.uid||token!==generation)return;
      update(0,role==='student'?'Missions completed':'Awaiting inspection','Unavailable','Could not access the saved records.');
      update(1,role==='student'?'Completed courses':'Approved evidence','Unavailable','Use the full workspace to retry.');
      summary.querySelector('.av-pulse-status').textContent='Summary is unavailable. Your projects, assessments and existing data are unchanged.';
    }finally{
      if(token===generation){
        loading=false;summary.removeAttribute('aria-busy');summary.querySelector('button').disabled=false;
      }
    }
  };
  summary.querySelector('button').addEventListener('click',()=>{void load(true);});
  document.addEventListener('adminerva:role-ready',()=>{void load();});
  document.addEventListener('adminerva:school-ready',()=>{
    if(nav.dataset.v4Cutover==="true"){readyUid='';void load(true);}
  });
  onAuthStateChanged(auth,user=>{
    if(!user||readyUid&&readyUid!==user.uid){generation++;loading=false;readyUid='';summary.hidden=true;}
    void load();
  });
  void load();
}
