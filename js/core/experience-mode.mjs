import {loadPublicChannel} from './public-content.mjs?v=20261122-1';
import {loadPublicReleases} from './patch-history.mjs?v=1.4.19';
import {bindDepth,mountExperienceMode,scrollToElement} from './experience-world.mjs?v=20261122-2';

const home=document.querySelector('main[data-home-experience]');
if(!home)throw new Error('Adminerva experience host not found');
const role=home.dataset.homeExperience;
const publicLike=role==='public'||role==='guest';
const el=(tag,cls,text)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=String(text);return n;};
const link=(href,label,cls)=>{const a=el('a',cls,label);a.href=href;return a;};
mountExperienceMode({key:role,firstEntry:publicLike,defaultMode:'full'});

const publicRoutes={
  public:[
    ['01','Create','Build in Studio','Make and run code in the public workspace.','guest-playground.html'],
    ['02','Discover','Opportunity Hunter','Follow source-checked opportunities beyond Adminerva.','opportunities.html'],
    ['03','Practice','Practice Lab','Try a guided mission and learn by doing.','guest-practice.html'],
    ['04','Follow','Pulse','Move through verified releases and public stories.','pulse.html']
  ],
  guest:[
    ['01','Build','Adminerva Studio','Start with code instead of a brochure.','guest-playground.html'],
    ['02','Practice','Practice Lab','Work through a short guided mission.','guest-practice.html'],
    ['03','Design','XML Layout Lab','Experiment with interface structure.','guest-xml-lab.html'],
    ['04','Discover','Opportunity Hunter','Follow a source-checked trail outward.','opportunities.html']
  ]
};
function makeBackdrop(){
  const backdrop=el('div','avx-world-backdrop');backdrop.setAttribute('aria-hidden','true');
  backdrop.innerHTML='<i class="avx-plane avx-plane-a"></i><i class="avx-plane avx-plane-b"></i><i class="avx-horizon"></i><i class="avx-glow"></i>';return backdrop;
}
function officialBrand(cls='avx-official-brand'){
  const img=document.createElement('img');img.className=cls;img.src='assets/New Adminerva logo.png';img.alt='';img.decoding='async';return img;
}
function guideCharacter(cls='avx-guide-character'){
  const img=document.createElement('img');img.className=cls;img.src='assets/immersive/guide.webp';img.alt='';img.loading='eager';img.decoding='async';return img;
}
function toolMotifs(){
  const group=el('div','avx-tool-motifs');group.setAttribute('aria-hidden','true');
  for(const name of ['portal','beacons','path','shards'])group.append(el('i','avx-tool-sprite avx-tool-'+name));
  return group;
}
function routeStop(entry){
  const [index,kicker,title,summary,href]=entry;const a=link(href,'','avx-route-stop');a.dataset.route=index;
  a.append(el('span','avx-route-index',index));
  const body=el('span','avx-route-body');body.append(el('small',null,kicker),el('strong',null,title),el('em',null,summary));
  a.append(body,el('span','avx-route-arrow','↗'));return a;
}
function signalRow(kicker,title,summary,href){
  const a=link(href,'','avx-current-row');a.append(el('small',null,kicker),el('strong',null,title),el('span',null,summary),el('b',null,'↗'));return a;
}
if(publicLike){
  const journey=el('div','avx-world-shell avx-world-shell--illustrated');journey.setAttribute('aria-label',role==='public'?'Explore Adminerva':'Explore public Adminerva tools');journey.append(makeBackdrop());
  const threshold=el('div','avx-threshold');const thresholdCopy=el('div','avx-threshold-copy');
  thresholdCopy.innerHTML=role==='public'
    ?'<p class="avx-kicker">ADMINERVA / SCHOOL OPERATING SYSTEM</p><h1>Enter a school day that <em>moves as one.</em></h1><p>Learning, teaching, evidence, records and operations connect through one school context. Discover the system by moving through it.</p>'
    :'<p class="avx-kicker">ADMINERVA / OPEN WORLD</p><h1>Start with an action, <em>not a menu.</em></h1><p>Build, practise, design and discover before signing in. Public work remains separate from school records.</p>';
  const actions=el('div','avx-threshold-actions');const begin=el('button','avx-text-action','Start moving ↓');begin.type='button';
  const enter=link(role==='public'?'login.html?continue=1':'guest-playground.html',role==='public'?'Open my workspace ↗':'Start building ↗','avx-text-link');
  actions.append(begin,enter);thresholdCopy.append(actions);
  const gate=el('div','avx-gate');gate.setAttribute('aria-hidden','true');
  const gateMark=el('div','avx-gate-mark');gateMark.append(officialBrand('avx-gate-logo'));
  gate.innerHTML='<i class="avx-gate-plane avx-gate-plane-left"></i><i class="avx-gate-plane avx-gate-plane-right"></i><i class="avx-gate-floor"></i>';gate.append(gateMark,guideCharacter(),toolMotifs());
  threshold.append(thresholdCopy,gate);
  const routeSection=el('div','avx-route-section');routeSection.id='adminerva-route';
  const routeIntro=el('header','avx-route-intro');routeIntro.innerHTML='<p class="avx-kicker">FOLLOW THE PATH</p><h2>Every turn leads somewhere real.</h2><p>Move by intent. Each stop opens an existing Adminerva destination.</p>';
  const route=el('nav','avx-route');route.setAttribute('aria-label','Adminerva destinations');route.append(el('i','avx-route-line'));publicRoutes[role].forEach(entry=>route.append(routeStop(entry)));routeSection.append(routeIntro,route);
  const current=el('div','avx-current-section');const currentIntro=el('header','avx-current-intro');
  currentIntro.innerHTML='<p class="avx-kicker">WHAT IS MOVING NOW</p><h2>Verified signals join the same world.</h2><p>Published releases, approved experiences and source-checked opportunities appear here only when their canonical sources provide them.</p>';
  const currentRows=el('div','avx-current-rows');currentRows.setAttribute('aria-live','polite');currentRows.append(signalRow('CONNECTING','Loading published signals','No simulated school activity is used.','pulse.html'));current.append(currentIntro,currentRows);
  const crossing=el('div','avx-crossing');const crossingCopy=el('div','avx-crossing-copy');
  crossingCopy.innerHTML=role==='public'?'<p class="avx-kicker">CROSS THE THRESHOLD</p><h2>Explore openly. Enter school work only when you are ready.</h2>':'<p class="avx-kicker">KEEP MOVING</p><h2>Public exploration ends where your school workspace begins.</h2>';
  const crossingLinks=el('div','avx-crossing-links');
  if(role==='public')crossingLinks.append(link('login.html?continue=1','Sign in ↗','avx-crossing-link'),link('enroll.html','Begin enrollment ↗','avx-crossing-link'),link('guest-home.html','Explore as guest ↗','avx-crossing-link'));
  else crossingLinks.append(link('guest-playground.html','Build ↗','avx-crossing-link'),link('opportunities.html','Discover ↗','avx-crossing-link'),link('login.html?continue=1','Sign in ↗','avx-crossing-link'));
  crossing.append(crossingCopy,crossingLinks);journey.append(threshold,routeSection,current,crossing);home.prepend(journey);bindDepth(journey);begin.addEventListener('click',()=>scrollToElement(routeSection));
  Promise.allSettled([loadPublicReleases(),loadPublicChannel('experiences',{role}),loadPublicChannel('opportunities',{role:'all'})]).then(([releases,experiences,opportunities])=>{
    const rows=[];
    if(releases.status==='fulfilled'&&releases.value[0]){const item=releases.value[0];rows.push(signalRow('RELEASE / '+item.version,item.title,item.summary,'patch-notes.html?version='+encodeURIComponent(item.version)));}
    if(experiences.status==='fulfilled'&&experiences.value[0]){const item=experiences.value[0];rows.push(signalRow('OPEN EXPERIENCE',item.title,item.summary,item.url));}
    if(opportunities.status==='fulfilled'&&opportunities.value[0]){const item=opportunities.value[0];rows.push(signalRow('OPPORTUNITY / '+item.category,item.title,item.provider+' · '+item.location,'opportunities.html'));}
    currentRows.replaceChildren(...(rows.length?rows:[signalRow('QUIET CHANNEL','No public signal is currently published','Adminerva does not invent releases, opportunities or activity.','pulse.html')]));
  });
}else{
  // Signed-in users stay on their one canonical role home. Full Experience
  // decorates that real page instead of inserting a second runway/home above it.
  const hero=home.querySelector('.av-home-hero')||home.querySelector(':scope > header');
  if(hero){
    home.classList.add('avx-canonical-home','avx-canonical-home--'+role);
    home.dataset.avxCanonicalHome='true';
    hero.classList.add('avx-canonical-home-hero--'+role);
    hero.dataset.avxCanonicalHome='true';

    const art=el('div','avx-canonical-art');art.setAttribute('aria-hidden','true');
    const brand=officialBrand('avx-canonical-logo');
    const guide=guideCharacter('avx-canonical-guide');
    art.append(brand,guide,toolMotifs());
    hero.prepend(art);
    const destinations=role==='student'?home.querySelector('.avx-world-destinations'):null;
    if(destinations){
      const origin=document.createComment('canonical student tool location');
      destinations.before(origin);
      hero.classList.add('avx-learning-world');
      // Keep the existing anchors, visibility flags, search listeners and DOM identity.
      // Full moves the real tools into the scene; Quick restores their original location.
      const sync=()=>{
        const full=document.documentElement.dataset.adminervaExperience==='full';
        hero.classList.toggle('avx-canonical-home-hero',full);
        if(full && destinations.parentElement!==hero)hero.append(destinations);
        if(!full && destinations.parentElement===hero)origin.after(destinations);
      };
      sync();
      document.addEventListener('adminerva:experience-mode-change',sync);
    }else{
      const sync=()=>hero.classList.toggle('avx-canonical-home-hero',document.documentElement.dataset.adminervaExperience==='full');
      sync();
      document.addEventListener('adminerva:experience-mode-change',sync);
    }
    bindDepth(hero);
  }
}
