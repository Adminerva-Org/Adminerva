/** Student submissions, practice progress and isolated code workspaces: xml layout. */
export const XML_STARTER=`<LinearLayout xmlns:android="http://schemas.android.com/apk/res/android"
    android:layout_width="match_parent" android:layout_height="match_parent"
    android:orientation="vertical" android:padding="24dp" android:background="#EEF2FF">
    <TextView android:layout_width="match_parent" android:layout_height="wrap_content"
        android:text="Welcome to Adminerva" android:textSize="24sp" android:textColor="#312E81" />
    <EditText android:layout_width="match_parent" android:layout_height="48dp"
        android:hint="Your name" android:layout_marginTop="16dp" />
    <Button android:layout_width="match_parent" android:layout_height="48dp"
        android:text="Continue" android:layout_marginTop="16dp" />
</LinearLayout>`;
const escape=value=>String(value).replace(/[&<>"']/g,character=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[character]));
export function layoutDimension(value,fallback="auto"){
  if(value==="match_parent"||value==="fill_parent")return "100%";
  if(value==="wrap_content")return "auto";
  const match=String(value||"").match(/^(\d{1,4}(?:\.\d{1,2})?)(?:dp|sp|px)$/);
  return match?Math.min(2000,Number(match[1]))+"px":fallback;
}
export function layoutColor(value){
  const color=String(value||"");
  if(/^#[a-f\d]{8}$/i.test(color))return "#"+color.slice(3)+color.slice(1,3);
  return /^#(?:[a-f\d]{3}|[a-f\d]{6})$/i.test(color)?color:null;
}
export function compileAndroidLayout(source,Parser=globalThis.DOMParser){
  if(typeof source!=="string"||source.length>50000)throw Error("Use an XML layout of at most 50,000 characters.");
  if(/<!\s*(?:DOCTYPE|ENTITY)/i.test(source))throw Error("Document types and external entities are not supported.");
  if(!Parser)throw Error("XML parsing is unavailable in this browser.");
  const document=new Parser().parseFromString(source,"application/xml");
  if(document.querySelector("parsererror")||!document.documentElement)throw Error("Invalid XML. Check closed tags, quoted attributes and namespace declarations.");
  const warnings=new Set(),rules=[];
  let count=0;
  function render(element,depth=0,parent=""){
    if(++count>200||depth>24)throw Error("Preview limit: 200 views and 24 nested containers.");
    const kind=element.localName.split(".").at(-1),identifier="view-"+count;
    const attributes=Object.fromEntries([...element.attributes].map(attribute=>[attribute.localName,attribute.value]));
    const width=layoutDimension(attributes.layout_width),height=layoutDimension(attributes.layout_height);
    const style=["box-sizing:border-box","max-width:100%","width:"+width,"height:"+height];
    if(depth===0)style.push("min-height:100%","width:100%");
    if(kind==="LinearLayout")style.push("display:flex","flex-direction:"+(attributes.orientation==="horizontal"?"row":"column"));
    if(["FrameLayout","ConstraintLayout"].includes(kind))style.push("position:relative");
    if(kind==="ScrollView")style.push("overflow:auto");
    if(parent==="FrameLayout")style.push("position:absolute","left:0","top:0");
    for(const [attribute,property] of Object.entries({padding:"padding",layout_margin:"margin",layout_marginTop:"margin-top",layout_marginBottom:"margin-bottom",layout_marginStart:"margin-left",layout_marginEnd:"margin-right",textSize:"font-size"})){
      if(attributes[attribute])style.push(property+":"+layoutDimension(attributes[attribute],"0px"));
    }
    for(const [attribute,property] of [["background","background"],["textColor","color"]]){
      const color=layoutColor(attributes[attribute]);if(color)style.push(property+":"+color);
      else if(attributes[attribute])warnings.add("Resource and named colors are not resolved; use #RRGGBB or #AARRGGBB.");
    }
    if(attributes.layout_weight&&/^\d+(?:\.\d+)?$/.test(attributes.layout_weight))style.push("flex-grow:"+Math.min(100,Number(attributes.layout_weight)));
    if(attributes.gravity?.includes("center"))style.push("text-align:center","justify-content:center","align-items:center");
    if(attributes.visibility==="gone")style.push("display:none");
    if(attributes.visibility==="invisible")style.push("visibility:hidden");
    if(parent==="ConstraintLayout"){
      style.push("position:absolute");
      for(const [attribute,property] of [["layout_constraintStart_toStartOf","left"],["layout_constraintEnd_toEndOf","right"],["layout_constraintTop_toTopOf","top"],["layout_constraintBottom_toBottomOf","bottom"]]){
        if(attributes[attribute]==="parent")style.push(property+":0");
      }
      if(attributes.layout_constraintStart_toStartOf==="parent"&&attributes.layout_constraintEnd_toEndOf==="parent"){
        if(attributes.layout_width==="0dp")style.push("width:auto");else style.push("margin-left:auto","margin-right:auto");
      }
      if(attributes.layout_constraintTop_toTopOf==="parent"&&attributes.layout_constraintBottom_toBottomOf==="parent"){
        if(attributes.layout_height==="0dp")style.push("height:auto");else style.push("margin-top:auto","margin-bottom:auto");
      }
    }
    for(const [name,value] of Object.entries(attributes)){
      if(name.startsWith("layout_constraint")&&value!=="parent")warnings.add("Sibling constraints, chains, bias and guidelines need Android Studio; this preview supports parent-edge constraints only.");
      if(name.startsWith("on"))warnings.add("Event handlers and application behavior do not execute in the layout simulator.");
    }
    const tags={TextView:"p",Button:"button",EditText:"input",ImageView:"div",LinearLayout:"div",FrameLayout:"div",ConstraintLayout:"div",ScrollView:"div",CheckBox:"label",Switch:"label"};
    const tag=tags[kind]||"div";
    if(!tags[kind])warnings.add("Unsupported widget "+kind+" is shown as a generic container.");
    rules.push("#"+identifier+"{"+style.join(";")+"}");
    const content=escape(attributes.text||attributes.hint||"");
    if(tag==="input")return '<input id="'+identifier+'" placeholder="'+content+'" aria-label="'+content+'">';
    const children=[...element.children].map(child=>render(child,depth+1,kind)).join("");
    return '<'+tag+' id="'+identifier+'"'+(tag==="button"?' type="button"':"")+'>'+(kind==="ImageView"?"[Image resource preview]":content)+children+'</'+tag+'>';
  }
  const html=render(document.documentElement);
  const css="html,body{margin:0;height:100%;font-family:system-ui,sans-serif}p{margin:0}input,button{font:inherit;padding:8px;border:1px solid #94a3b8;border-radius:4px}"+rules.join("\n");
  const output='<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'; form-action \'none\'; base-uri \'none\'"><style>'+css+'</style></head><body>'+html+'</body></html>';
  return {html,css,output,warnings:[...warnings],viewCount:count};
}
