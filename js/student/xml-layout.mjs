/** Safe Android XML learning renderer. Layout solving is performed by the parent, with scripts disabled in the preview. */
export const XML_STARTER=`<LinearLayout xmlns:android="http://schemas.android.com/apk/res/android"
    android:layout_width="match_parent" android:layout_height="match_parent"
    android:orientation="vertical" android:padding="24dp" android:background="#F1F5F9">
    <TextView android:layout_width="match_parent" android:layout_height="wrap_content"
        android:text="Build something useful" android:textSize="26sp" android:textStyle="bold" android:textColor="#123047" />
    <TextView android:layout_width="match_parent" android:layout_height="wrap_content"
        android:text="Your ideas start with a well organized layout." android:textSize="15sp" android:layout_marginTop="12dp" />
    <EditText android:layout_width="match_parent" android:layout_height="48dp"
        android:hint="Project name" android:layout_marginTop="24dp" />
    <Button android:layout_width="match_parent" android:layout_height="48dp"
        android:text="Create project" android:layout_marginTop="16dp" android:background="#087E8B" android:textColor="#FFFFFF" />
</LinearLayout>`;
const escape=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function layoutDimension(value,fallback="auto"){
  if(value==="match_parent"||value==="fill_parent")return "100%";
  if(value==="wrap_content")return "auto";
  const match=String(value||"").match(/^(\d{1,4}(?:\.\d{1,2})?)(?:dp|sp|px)$/);
  return match?Math.max(-1000,Math.min(2000,Number(match[1])))+"px":fallback;
}
const COLORS={black:'#000000',white:'#ffffff',transparent:'#00000000',red:'#ef4444',blue:'#2563eb',green:'#16a34a',gray:'#6b7280','@android:color/white':'#ffffff','@android:color/black':'#000000','@android:color/transparent':'#00000000','@android:color/darker_gray':'#a3a3a3','@android:color/holo_blue_dark':'#0099cc','@android:color/holo_blue_light':'#33b5e5'};
export function layoutColor(value){
  const color=String(value||"");if(COLORS[color])return COLORS[color];
  if(/^#[a-f\d]{8}$/i.test(color))return '#'+color.slice(3)+color.slice(1,3);
  return /^#(?:[a-f\d]{3}|[a-f\d]{6})$/i.test(color)?color:null;
}
export function compileAndroidLayout(source,Parser=globalThis.DOMParser,resources={}){
  if(typeof source!=="string"||source.length>50000)throw Error("Use an XML layout of at most 50,000 characters.");
  if(/<!\s*(?:DOCTYPE|ENTITY)/i.test(source))throw Error("Document types and external entities are not supported.");
  if(!Parser)throw Error("XML parsing is unavailable in this browser.");
  const document=new Parser().parseFromString(source,'application/xml');
  if(document.querySelector('parsererror')||!document.documentElement)throw Error('Check the XML: close each tag, quote values, and declare namespaces. Your previous preview is retained.');
  const warnings=new Set(),rules=[],views=[];let count=0;
  const resolved=value=>typeof value==='string'&&value.startsWith('@')?(resources[value]??value):value;
  function render(element,depth=0,parent=null){
    if(++count>200||depth>24)throw Error('Preview supports 200 views and 24 levels of nesting.');
    const kind=element.localName.split('.').at(-1),identifier='view-'+count;
    const rawAttributes=Object.fromEntries([...element.attributes].map(attr=>[attr.localName,attr.value]));
    const attributes=Object.fromEntries(Object.entries(rawAttributes).map(([key,value])=>[key,resolved(value)]));
    const view={id:identifier,index:count-1,kind,depth,parent:parent?.id||null,attributes,rawAttributes};views.push(view);
    const isConstraint=parent?.kind==='ConstraintLayout',isFrame=parent?.kind==='FrameLayout';
    const width=layoutDimension(attributes.layout_width),height=layoutDimension(attributes.layout_height);
    const style=['box-sizing:border-box','min-width:0','max-width:100%','width:'+width,'height:'+height,'flex-shrink:0','white-space:pre-wrap'];
    if(depth===0){if(!attributes.layout_width)style.push('width:100%');if(!attributes.layout_height)style.push('min-height:100%');}
    if(attributes.layout_width==='0dp'&&(isConstraint||Number(attributes.layout_weight)>0))style.push(isConstraint?'width:auto':'flex-basis:0');
    if(attributes.layout_height==='0dp'&&isConstraint)style.push('height:auto');
    if(kind==='LinearLayout')style.push('display:flex','flex-direction:'+(attributes.orientation==='horizontal'?'row':'column'));
    if(['FrameLayout','ConstraintLayout','RelativeLayout'].includes(kind))style.push('position:relative');
    if(['ScrollView','NestedScrollView'].includes(kind))style.push('overflow-y:auto','overflow-x:hidden');
    if(kind==='HorizontalScrollView')style.push('overflow-x:auto','overflow-y:hidden','white-space:nowrap');
    if(kind==='CardView'||kind==='MaterialCardView')style.push('background:white','border-radius:'+layoutDimension(attributes.cardCornerRadius,'12px'),'box-shadow:0 3px 14px #0f172a16','overflow:hidden');
    if(isFrame)style.push('position:absolute','left:0','top:0');
    const dimensions={padding:'padding',paddingStart:'padding-left',paddingEnd:'padding-right',paddingLeft:'padding-left',paddingRight:'padding-right',paddingTop:'padding-top',paddingBottom:'padding-bottom',layout_margin:'margin',layout_marginTop:'margin-top',layout_marginBottom:'margin-bottom',layout_marginStart:'margin-left',layout_marginEnd:'margin-right',layout_marginLeft:'margin-left',layout_marginRight:'margin-right',textSize:'font-size',minHeight:'min-height',minWidth:'min-width'};
    for(const [attribute,property] of Object.entries(dimensions))if(attributes[attribute])style.push(property+':'+layoutDimension(attributes[attribute],'0px'));
    for(const [attribute,property] of [['background','background'],['textColor','color'],['backgroundTint','background']]){
      const value=attributes[attribute];if(!value)continue;const color=layoutColor(value);if(color)style.push(property+':'+color);else warnings.add('Add a color resource for '+value+', or use a hex color.');
    }
    if(Number(attributes.layout_weight)>0)style.push('flex-grow:'+Math.min(100,Number(attributes.layout_weight)));
    if(attributes.textStyle?.includes('bold'))style.push('font-weight:700');if(attributes.textStyle?.includes('italic'))style.push('font-style:italic');
    if(attributes.gravity?.includes('center'))style.push('text-align:center');
    if(kind==='LinearLayout'&&attributes.gravity){const horizontal=attributes.orientation==='horizontal';if(attributes.gravity.includes('center'))style.push('justify-content:center','align-items:center');if(attributes.gravity.includes('end')||attributes.gravity.includes('right'))style.push((horizontal?'justify-content':'align-items')+':flex-end');if(attributes.gravity.includes('bottom'))style.push((horizontal?'align-items':'justify-content')+':flex-end');}
    if(attributes.visibility==='gone')style.push('display:none');if(attributes.visibility==='invisible')style.push('visibility:hidden');
    if(attributes.elevation)style.push('box-shadow:0 3px 12px #0f172a25');
    if(attributes.layout_gravity?.includes('center'))style.push('align-self:center','margin-left:auto','margin-right:auto');
    if(kind==='Guideline')style.push('width:0','height:0','visibility:hidden');
    for(const name of Object.keys(attributes)){if(name.startsWith('on'))warnings.add('Application events do not run in this preview.');if(name.includes('chainStyle'))warnings.add('Constraint chains are approximated. Inspect the result in Android Studio.');}
    const containers=new Set(['LinearLayout','FrameLayout','ConstraintLayout','RelativeLayout','ScrollView','NestedScrollView','HorizontalScrollView','CardView','MaterialCardView','TextInputLayout','CoordinatorLayout','Guideline']);
    const known=new Set([...containers,'TextView','Button','MaterialButton','EditText','TextInputEditText','ImageView','ImageButton','CheckBox','Switch','SwitchCompat','ProgressBar','RecyclerView','BottomNavigationView','Toolbar']);
    if(!known.has(kind))warnings.add(kind+' is shown as a generic container.');
    if(kind==='RelativeLayout')warnings.add('RelativeLayout rules are approximated in reading order. Use ConstraintLayout for positioned previews.');
    rules.push('#'+identifier+'{'+style.join(';')+'}');
    const content=escape(String(attributes.text||attributes.hint||attributes.title||'').replace(/\\n/g,'\n'));
    const child=[...element.children].map(item=>render(item,depth+1,view)).join('');
    const common=' id="'+identifier+'" data-view="'+identifier+'"';
    if(['EditText','TextInputEditText'].includes(kind))return '<input'+common+' placeholder="'+content+'" aria-label="'+content+'">';
    if(['CheckBox','Switch','SwitchCompat'].includes(kind))return '<label'+common+'><input type="checkbox"'+(attributes.checked==='true'?' checked':'')+'> '+content+'</label>';
    if(['ImageView','ImageButton'].includes(kind))return '<div'+common+' class="image-placeholder" role="img" aria-label="Image placeholder">▧ '+escape(attributes.contentDescription||'Image')+'</div>';
    if(kind==='RecyclerView')return '<div'+common+' class="recycler-placeholder"><small>RecyclerView · sample items</small><div>Item one</div><div>Item two</div><div>Item three</div>'+child+'</div>';
    if(kind==='BottomNavigationView')return '<div'+common+' class="bottom-nav"><span>⌂ Home</span><span>◇ Explore</span><span>○ Profile</span></div>';
    if(kind==='ProgressBar')return '<progress'+common+' max="100" value="'+Math.max(0,Math.min(100,Number(attributes.progress)||40))+'"></progress>';
    const tag=['Button','MaterialButton'].includes(kind)?'button':kind==='TextView'?'p':'div';
    return '<'+tag+common+(tag==='button'?' type="button"':'')+'>'+content+child+'</'+tag+'>';
  }
  const html=render(document.documentElement),css='html,body{margin:0;min-height:100%;height:100%;font:14px/1.45 system-ui,sans-serif;color:#183149;background:#fff}p{margin:0}button,input{font:inherit;border:1px solid #b9c8da;border-radius:7px;padding:10px}button{background:#e8f2f6;font-weight:600}input{background:#fff;color:#183149}.image-placeholder{background:#dfe8f1;display:flex;align-items:center;justify-content:center;min-height:64px;color:#567}.recycler-placeholder>div{padding:12px;border-bottom:1px solid #cbd5e1}.recycler-placeholder small{padding:8px;display:block;color:#64748b}.bottom-nav{display:flex;justify-content:space-around;background:white;border-top:1px solid #dbe4ee;padding:14px;gap:8px}'+rules.join('\n');
  return {html,css,views,viewCount:count,warnings:[...warnings],output:'<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'; form-action \'none\'; base-uri \'none\'"><style>'+css+'</style></head><body>'+html+'</body></html>'};
}
/** Resolve common parent and sibling anchors after the browser has measured text. */
export function solveLayoutConstraints(document,views){
  const nodes=new Map(views.map(view=>[view.id,document.getElementById(view.id)])),warnings=[];
  for(const parent of views.filter(view=>view.kind==='ConstraintLayout')){
    const container=nodes.get(parent.id);if(!container)continue;
    const children=views.filter(view=>view.parent===parent.id),ids=new Map(children.map(view=>[String(view.attributes.id||'').replace(/^@\+?id\//,''),view]));
    const pending=new Set(children.filter(view=>Object.keys(view.attributes).some(key=>key.startsWith('layout_constraint'))||view.kind==='Guideline'));
    const resolved=new Set(children.filter(view=>!pending.has(view)).map(view=>view.id));
    const size=()=>({width:container.clientWidth,height:container.clientHeight});
    const target=(reference,axis,edge)=>{
      const bounds=size();if(reference==='parent')return edge==='start'?0:bounds[axis==='x'?'width':'height'];
      const sibling=ids.get(String(reference||'').replace(/^@\+?id\//,''));if(!sibling||!resolved.has(sibling.id))return null;
      const rect=nodes.get(sibling.id).getBoundingClientRect(),base=container.getBoundingClientRect();return axis==='x'?rect.left-base.left+(edge==='end'?rect.width:0):rect.top-base.top+(edge==='end'?rect.height:0);
    };
    for(let iteration=0;pending.size&&iteration<children.length+1;iteration++)for(const view of [...pending]){
      const a=view.attributes,node=nodes.get(view.id);if(!node)continue;
      if(view.kind==='Guideline'){
        const vertical=a.orientation==='vertical',available=size()[vertical?'width':'height'],position=a.layout_constraintGuide_percent?available*Math.max(0,Math.min(1,Number(a.layout_constraintGuide_percent))):a.layout_constraintGuide_end?available-parseFloat(a.layout_constraintGuide_end):parseFloat(a.layout_constraintGuide_begin)||0;
        Object.assign(node.style,{position:'absolute',left:(vertical?position:0)+'px',top:(vertical?0:position)+'px'});pending.delete(view);resolved.add(view.id);continue;
      }
      const edge=(names,axis)=>{for(const [key,end] of names)if(a[key])return target(a[key],axis,end);return undefined;};
      let left=edge([['layout_constraintStart_toStartOf','start'],['layout_constraintLeft_toLeftOf','start'],['layout_constraintStart_toEndOf','end'],['layout_constraintLeft_toRightOf','end']],'x'),right=edge([['layout_constraintEnd_toEndOf','end'],['layout_constraintRight_toRightOf','end'],['layout_constraintEnd_toStartOf','start'],['layout_constraintRight_toLeftOf','start']],'x');
      let top=edge([['layout_constraintTop_toTopOf','start'],['layout_constraintTop_toBottomOf','end']],'y'),bottom=edge([['layout_constraintBottom_toBottomOf','end'],['layout_constraintBottom_toTopOf','start']],'y');
      if([left,right,top,bottom].some(value=>value===null))continue;
      const margin=key=>parseFloat(a[key]||a.layout_margin||0)||0,ml=margin('layout_marginStart')||margin('layout_marginLeft'),mr=margin('layout_marginEnd')||margin('layout_marginRight'),mt=margin('layout_marginTop'),mb=margin('layout_marginBottom');
      if(left!==undefined)left+=ml;if(right!==undefined)right-=mr;if(top!==undefined)top+=mt;if(bottom!==undefined)bottom-=mb;
      const before=node.getBoundingClientRect(),base=container.getBoundingClientRect();
      const naturalX=before.left-base.left,naturalY=before.top-base.top;
      Object.assign(node.style,{position:'absolute',margin:'0'});
      if(a.layout_width==='0dp'&&left!==undefined&&right!==undefined)node.style.width=Math.max(0,right-left)+'px';
      if(a.layout_height==='0dp'&&top!==undefined&&bottom!==undefined)node.style.height=Math.max(0,bottom-top)+'px';
      const measured=node.getBoundingClientRect(),bias=key=>a[key]===undefined?.5:Math.max(0,Math.min(1,Number(a[key])||0));
      node.style.left=(left!==undefined&&right!==undefined?left+Math.max(0,right-left-measured.width)*bias('layout_constraintHorizontal_bias'):left!==undefined?left:right!==undefined?right-measured.width:naturalX)+'px';
      node.style.top=(top!==undefined&&bottom!==undefined?top+Math.max(0,bottom-top-measured.height)*bias('layout_constraintVertical_bias'):top!==undefined?top:bottom!==undefined?bottom-measured.height:naturalY)+'px';
      pending.delete(view);resolved.add(view.id);
    }
    if(pending.size)warnings.push(pending.size+' view(s) have unresolved or circular constraints and are shown in reading order.');
  }
  return warnings;
}
