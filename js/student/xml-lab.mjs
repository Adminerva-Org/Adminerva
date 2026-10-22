/** Editable component tree, device controls and private local XML drafts. */
import {auth} from '../core/firebase-core.js?v=1.3.0';
import {compileAndroidLayout,solveLayoutConstraints,XML_STARTER} from './xml-layout.mjs?v=1.3.0';
const el=id=>document.getElementById(id),guest=document.body.dataset.xmlAccess==='guest';
let owner=null,timer=null,rendered=null,renderedSource='',selected=0;
const defaultResources='<resources>\n  <color name="primary">#087E8B</color>\n  <string name="app_name">My project</string>\n</resources>';
const android='http://schemas.android.com/apk/res/android';
const templates={starter:XML_STARTER,profile:`<LinearLayout xmlns:android="http://schemas.android.com/apk/res/android" android:layout_width="match_parent" android:layout_height="match_parent" android:orientation="vertical" android:padding="24dp" android:background="#F3F6FB">
 <ImageView android:layout_width="96dp" android:layout_height="96dp" android:layout_gravity="center" android:contentDescription="Profile photo" />
 <TextView android:layout_width="match_parent" android:layout_height="wrap_content" android:text="Your learning profile" android:textSize="24sp" android:textStyle="bold" android:gravity="center" android:layout_marginTop="24dp" />
 <TextView android:layout_width="match_parent" android:layout_height="wrap_content" android:text="Keep building, one project at a time." android:gravity="center" android:layout_marginTop="8dp" />
 <Button android:layout_width="match_parent" android:layout_height="48dp" android:text="Continue learning" android:layout_marginTop="32dp" android:background="#087E8B" android:textColor="#FFFFFF" />
</LinearLayout>`,constraints:`<androidx.constraintlayout.widget.ConstraintLayout xmlns:android="http://schemas.android.com/apk/res/android" xmlns:app="http://schemas.android.com/apk/res-auto" android:layout_width="match_parent" android:layout_height="match_parent" android:background="#F4F7FB">
 <TextView android:id="@+id/title" android:layout_width="0dp" android:layout_height="wrap_content" android:text="Design with constraints" android:textSize="25sp" android:textStyle="bold" android:layout_margin="24dp" app:layout_constraintTop_toTopOf="parent" app:layout_constraintStart_toStartOf="parent" app:layout_constraintEnd_toEndOf="parent" />
 <EditText android:id="@+id/name" android:layout_width="0dp" android:layout_height="48dp" android:hint="Your project name" android:layout_margin="24dp" app:layout_constraintTop_toBottomOf="@id/title" app:layout_constraintStart_toStartOf="parent" app:layout_constraintEnd_toEndOf="parent" />
 <Button android:layout_width="0dp" android:layout_height="48dp" android:text="Let's build" android:layout_margin="24dp" android:background="#087E8B" android:textColor="#FFFFFF" app:layout_constraintTop_toBottomOf="@id/name" app:layout_constraintStart_toStartOf="parent" app:layout_constraintEnd_toEndOf="parent" />
</androidx.constraintlayout.widget.ConstraintLayout>`};
function resourceValues(){
 const source=el('xmlResources').value.trim();if(!source)return {};
 if(/<!\s*(?:DOCTYPE|ENTITY)/i.test(source))throw Error('External resource entities are not supported.');
 const doc=new DOMParser().parseFromString(source,'application/xml');if(doc.querySelector('parsererror'))throw Error('Check your resources XML.');
 const result={};for(const node of doc.querySelectorAll('color,string,dimen')){const name=node.getAttribute('name');if(/^[a-zA-Z0-9_]{1,80}$/.test(name||''))result['@'+node.localName+'/'+name]=node.textContent;}return result;
}
function save(){if(!owner)return;try{localStorage.setItem('Adminerva_XML_'+owner,el('xmlEditor').value);localStorage.setItem('Adminerva_XML_resources_'+owner,el('xmlResources').value);}catch{el('xmlStatus').textContent+=' · Device storage is unavailable; export your XML.';}}
function device(){
 const [w,h]=el('xmlDevice').value.split('x').map(Number),landscape=el('xmlLandscape').checked,zoom=Number(el('xmlZoom').value);
 const width=landscape?h:w,height=landscape?w:h,frame=el('xmlPreview');frame.style.width=width+'px';frame.style.height=height+'px';
 el('xmlPhone').style.transform='scale('+zoom+')';el('xmlPhone').style.transformOrigin='top left';el('xmlDeviceSpace').style.width=(width+20)*zoom+'px';el('xmlDeviceSpace').style.height=(height+50)*zoom+'px';
 if(rendered&&frame.contentDocument?.readyState==='complete'){const warnings=solveLayoutConstraints(frame.contentDocument,rendered.views);showWarnings([...rendered.warnings,...warnings]);}
}
function showWarnings(warnings){const box=el('xmlWarnings');box.replaceChildren();for(const text of [...new Set(warnings)]){const item=document.createElement('li');item.textContent=text;box.append(item);}el('xmlWarningCount').textContent=warnings.length?warnings.length+' preview notes':'No preview notes';}
function select(index){
 selected=index;const view=rendered?.views[index];if(!view)return;
 el('xmlSelectedView').textContent=view.kind+' · '+(view.attributes.id||view.id);
 const fields={xmlPropText:'text',xmlPropWidth:'layout_width',xmlPropHeight:'layout_height',xmlPropBackground:'background',xmlPropPadding:'padding'};
 for(const [id,key] of Object.entries(fields))el(id).value=(view.rawAttributes||view.attributes)[key]||'';
 for(const button of el('xmlTree').querySelectorAll('button'))button.setAttribute('aria-pressed',String(Number(button.dataset.index)===index));
 const frame=el('xmlPreview').contentDocument;if(frame){for(const node of frame.querySelectorAll('[data-view]'))node.style.outline='';const target=frame.getElementById(view.id);if(target)target.style.outline='2px dashed #06b6d4';}
}
function tree(){
 const box=el('xmlTree');box.replaceChildren();for(const view of rendered.views){const button=document.createElement('button');button.type='button';button.style.paddingLeft=(10+view.depth*12)+'px';button.dataset.index=view.index;button.textContent=view.kind+(view.attributes.id?' · '+view.attributes.id.replace(/^@\+?id\//,''):'');button.onclick=()=>select(view.index);box.append(button);}select(Math.min(selected,rendered.views.length-1));
}
function render(){
 if(!owner)return;
 try{const source=el('xmlEditor').value,result=compileAndroidLayout(source,DOMParser,resourceValues());rendered=result;renderedSource=source;el('xmlPreview').srcdoc=result.output;el('xmlGenerated').value=result.output;showWarnings(result.warnings);tree();el('xmlStatus').textContent=result.viewCount+' components · draft on this device';save();}
 catch(error){el('xmlStatus').textContent=error.message;save();}
}
el('xmlPreview').addEventListener('load',()=>{
 if(!rendered)return;try{const doc=el('xmlPreview').contentDocument;showWarnings([...rendered.warnings,...solveLayoutConstraints(doc,rendered.views)]);el('xmlGenerated').value='<!doctype html>\n'+doc.documentElement.outerHTML;for(const node of doc.querySelectorAll('[data-view]'))node.addEventListener('click',event=>{event.preventDefault();event.stopPropagation();select(rendered.views.findIndex(view=>view.id===node.dataset.view));});select(selected);device();}catch{el('xmlStatus').textContent='Preview could not be measured. Update preview to retry.';}
});
for(const id of ['xmlEditor','xmlResources'])el(id).addEventListener('input',()=>{clearTimeout(timer);timer=setTimeout(render,500);});
for(const id of ['xmlDevice','xmlLandscape','xmlZoom'])el(id).addEventListener('change',device);
el('xmlRender').onclick=render;
el('xmlTemplate').onchange=()=>{const source=templates[el('xmlTemplate').value];if(source&&confirm('Replace the current XML with this template? Export your current draft first if needed.')){el('xmlEditor').value=source;render();}el('xmlTemplate').value='';};
el('xmlExport').onclick=()=>{const url=URL.createObjectURL(new Blob([el('xmlEditor').value],{type:'application/xml'})),a=document.createElement('a');a.href=url;a.download='activity_main.xml';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
el('xmlApplyProperties').onclick=()=>{
 if(!rendered)return;
 if(el('xmlEditor').value!==renderedSource){el('xmlStatus').textContent='Update the preview and select the component again before applying properties.';return;}
 clearTimeout(timer);const doc=new DOMParser().parseFromString(el('xmlEditor').value,'application/xml');if(doc.querySelector('parsererror'))return;
 const node=[doc.documentElement,...doc.documentElement.querySelectorAll('*')][selected];if(!node)return;
 for(const [id,key] of Object.entries({xmlPropText:'text',xmlPropWidth:'layout_width',xmlPropHeight:'layout_height',xmlPropBackground:'background',xmlPropPadding:'padding'})){const value=el(id).value.trim();if(value)node.setAttributeNS(android,'android:'+key,value);else node.removeAttributeNS(android,key);}
 el('xmlEditor').value=new XMLSerializer().serializeToString(doc);render();
};
auth.onAuthStateChanged(user=>{
 const nextOwner=user?.uid||(guest?'public-visitor-v1':null);if(owner&&nextOwner===owner)return;
 clearTimeout(timer);if(owner)save();owner=nextOwner;rendered=null;renderedSource='';selected=0;
 el('xmlEditor').value='';el('xmlResources').value='';el('xmlPreview').srcdoc='';el('xmlGenerated').value='';el('xmlTree').replaceChildren();showWarnings([]);el('xmlSelectedView').textContent='Select a component';
 for(const id of ['xmlPropText','xmlPropWidth','xmlPropHeight','xmlPropBackground','xmlPropPadding'])el(id).value='';
 if(!owner){el('xmlStatus').textContent='Sign in to open your private XML draft.';return;}
 el('xmlEditor').value=XML_STARTER;el('xmlResources').value=defaultResources;
 try{el('xmlEditor').value=localStorage.getItem('Adminerva_XML_'+owner)||XML_STARTER;el('xmlResources').value=localStorage.getItem('Adminerva_XML_resources_'+owner)||defaultResources;}catch{}
 render();device();
});
