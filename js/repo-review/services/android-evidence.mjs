/** Android/XML evidence classification and deterministic checks for Review & Grade. */
import {compileAndroidLayout} from "../../student/xml-layout.mjs?v=1.3.0";

const TEXT_SUPPORT=/\.(?:xml|java|kt|kts|gradle|toml|properties|json)$/i;
const IMAGE_SUPPORT=/\.(?:png|jpe?g|webp)$/i;
const FONT_SUPPORT=/\.(?:ttf|otf)$/i;
const GENERIC_ID=/^(?:textView|imageView|button|editText|view)\d+$/i;

export function isAndroidUiAssessment(assessment={}){
  const extensions=(Array.isArray(assessment.expectedExtensions)?assessment.expectedExtensions:[])
    .map(value=>String(value||"").toLowerCase().replace(/^\./,""));
  const text=(String(assessment.taskContext||"")+" "+String(assessment.evalCriteria||"")).toLowerCase();
  return (extensions.includes("xml")||/android[^\n]{0,80}xml|xml[^\n]{0,80}(?:ui|layout|screen)/i.test(text)) &&
    /(?:screen|layout|interface|\bui\b)/i.test(text);
}

export function androidSupportKind(path){
  const value=String(path||"");
  const androidPath=/^(?:app\/src\/main\/|app\/build\.gradle|build\.gradle|settings\.gradle|gradle\/libs\.versions\.toml|gradle\.properties)/i.test(value);
  if(!androidPath)return null;
  if(IMAGE_SUPPORT.test(value)&&/\/res\/(?:drawable|mipmap)[^/]*\//i.test(value))return "image";
  if(FONT_SUPPORT.test(value)&&/\/res\/font[^/]*\//i.test(value))return "font";
  if(TEXT_SUPPORT.test(value))return "text";
  return null;
}

export function responsibilityBasis({assessment={},contributionScope="",patches=[]}={}){
  const explicit=String(contributionScope||"").trim();
  if(!isAndroidUiAssessment(assessment))return explicit;
  const xml=patches.filter(item=>item.primary&&item.substantive===true&&/\/res\/layout[^/]*\/.*\.xml$/i.test(item.path));
  const fallback=xml.length
    ?"Classroom rule for this XML UI assessment: each student is responsible for at least one individually assigned screen. Treat the student's verified substantive XML layout change"+(xml.length===1?"":"s")+" ("+xml.map(item=>item.path).join(", ")+") as that student's assigned screen work. Do not assign teammate screens to this student."
    :"Classroom rule for this XML UI assessment: each student is expected to contribute at least one individually assigned XML screen. No verified substantive XML layout was found in the supplied student evidence, so do not infer individual screen completion.";
  return explicit?explicit+"\n"+fallback:fallback;
}

function resourceRefs(source){
  const refs=[];const regex=/@(drawable|mipmap|font|color|string)\/([A-Za-z0-9_]+)/g;let match;
  while((match=regex.exec(String(source||""))))refs.push({type:match[1],name:match[2]});
  return refs;
}
function resourceName(path){
  const name=String(path||"").split("/").pop()||"";
  return name.replace(/\.[^.]+$/,"");
}
function valuesNames(files){
  const names=new Set();
  for(const file of files.filter(item=>/\/res\/values[^/]*\/.*\.xml$/i.test(item.path))){
    const regex=/<(string|color|dimen|style|integer|bool|array|string-array)\b[^>]*\bname=["']([A-Za-z0-9_]+)["']/g;let match;
    while((match=regex.exec(file.text)))names.add(match[1]+"/"+match[2]);
  }
  return names;
}
function numericDp(value){
  const match=String(value||"").match(/^(\d+(?:\.\d+)?)dp$/i);
  return match?Number(match[1]):null;
}

export function analyzeAndroidEvidence({assessment={},files=[],patches=[],assets=[]}={}){
  if(!isAndroidUiAssessment(assessment))return {applicable:false,checks:[],summary:"No Android XML-specific deterministic checks were applied."};
  const primaryStudent=new Set(patches.filter(item=>item.primary&&item.substantive===true).map(item=>item.path));
  const supportStudent=[...new Set(patches.filter(item=>!item.primary&&item.substantive===true).map(item=>item.path))];
  const primaryFiles=files.filter(item=>item.primary);
  const studentPrimary=primaryFiles.filter(item=>primaryStudent.has(item.path));
  const supportFiles=files.filter(item=>!item.primary);
  const allPaths=new Set([...files.map(item=>item.path),...assets.map(item=>item.path)]);
  const valueNames=valuesNames(files);
  const checks=[];
  let totalViews=0,genericIds=0,placeholders=0,hardcodedText=0,interactive=0,touchSized=0,
    constrainedChildren=0,constraintChildren=0;
  const references=[];

  for(const file of studentPrimary){
    try{
      const preview=compileAndroidLayout(file.text,globalThis.DOMParser,{});
      totalViews+=preview.viewCount;
      const root=preview.views[0];
      for(const view of preview.views){
        const raw=view.rawAttributes||{};
        const id=String(raw.id||"").replace(/^@\+?id\//,"");
        if(id&&GENERIC_ID.test(id))genericIds++;
        const text=String(raw.text||"");
        if(/^TextView$/i.test(text.trim()))placeholders++;
        if(text&&!text.startsWith("@")&&!/^[+\-<>]$/.test(text.trim()))hardcodedText++;
        if(["Button","MaterialButton","ImageButton"].includes(view.kind)){
          interactive++;
          const w=numericDp(raw.layout_width),h=numericDp(raw.layout_height);
          if((w===null||w>=48)&&(h===null||h>=48))touchSized++;
        }
        if(root?.kind==="ConstraintLayout"&&view.parent===root.id){
          constraintChildren++;
          const keys=Object.keys(raw);
          const horizontal=keys.some(key=>/^layout_constraint(?:Start|End|Left|Right)_to/.test(key));
          const vertical=keys.some(key=>/^layout_constraint(?:Top|Bottom)_to/.test(key));
          if(horizontal&&vertical)constrainedChildren++;
        }
      }
      references.push(...resourceRefs(file.text).map(ref=>({...ref,source:file.path})));
      for(const warning of preview.warnings||[])checks.push("Preview note for "+file.path+": "+warning);
    }catch(error){checks.push("XML preview parser could not inspect "+file.path+": "+error.message);}
  }

  const invalidResourceNames=[...allPaths].filter(path=>{
    if(!/\/res\/(?:layout|drawable|mipmap|font|values)[^/]*\//i.test(path))return false;
    const name=(path.split("/").pop()||"").replace(/\.[^.]+$/,"");
    return !/^[a-z0-9_]+$/.test(name);
  });
  const invalidReferences=references.filter(ref=>!/^[a-z0-9_]+$/.test(ref.name));
  const missing=[];
  for(const ref of references){
    const found=ref.type==="string"||ref.type==="color"
      ?valueNames.has(ref.type+"/"+ref.name)
      :[...allPaths].some(path=>resourceName(path).toLowerCase()===ref.name.toLowerCase() &&
        (ref.type==="font"?/\/res\/font/i.test(path):new RegExp("/res/"+ref.type,"i").test(path)));
    if(!found)missing.push("@"+ref.type+"/"+ref.name+" referenced by "+ref.source);
  }

  const stems=studentPrimary.map(file=>file.path.split("/").pop().replace(/\.xml$/i,""));
  let activityLinks=0,manifestLinks=0;
  for(const stem of stems){
    const escaped=stem.replace(/[.*+?^$()|[\]\\]/g,"\\$&");
    const linked=supportFiles.find(file=>new RegExp("setContentView\\s*\\(\\s*R\\.layout\\."+escaped+"\\s*\\)").test(file.text));
    if(linked){
      activityLinks++;
      const className=(linked.text.match(/\bclass\s+([A-Za-z_][A-Za-z0-9_]*)/)||[])[1];
      if(className&&supportFiles.some(file=>/AndroidManifest\.xml$/i.test(file.path)&&
        new RegExp("android:name=[\\\"'](?:\\.|[^\\\"']*\\.)?"+className+"[\\\"']").test(file.text)))manifestLinks++;
    }
  }
  const dependencyPresent=supportFiles.some(file=>/(?:androidx\.)?constraintlayout|libs\.constraintlayout/i.test(file.text));

  if(studentPrimary.length)checks.push("Verified individual XML screen evidence: "+studentPrimary.map(file=>file.path).join(", ")+".");
  if(supportStudent.length)checks.push("Verified supporting implementation/resources changed in the same approved evidence: "+supportStudent.join(", ")+".");
  if(totalViews)checks.push(totalViews+" Android view(s) parsed from the student's verified XML screen"+(studentPrimary.length===1?"":"s")+".");
  if(constraintChildren)checks.push(constrainedChildren+"/"+constraintChildren+" direct ConstraintLayout child views have both horizontal and vertical constraints.");
  if(interactive)checks.push(touchSized+"/"+interactive+" button-like controls meet or exceed a 48dp dimension when explicit fixed dimensions are used; wrap/match dimensions are not treated as failures.");
  if(genericIds)checks.push(genericIds+" component ID(s) appear generic/default-generated.");
  if(placeholders)checks.push(placeholders+" TextView value(s) still use the generic \"TextView\" placeholder; placeholders are allowed by the task but may reduce prototype clarity if visible.");
  if(hardcodedText)checks.push(hardcodedText+" user-facing text value(s) are hardcoded. Treat this as a development-practice recommendation unless the rubric explicitly requires string resources.");
  if(invalidResourceNames.length)checks.push("Android resource filename warning: "+invalidResourceNames.join(", ")+" contain uppercase or unsupported resource-name characters and may prevent Android resource compilation.");
  if(invalidReferences.length)checks.push("Android resource reference warning: "+invalidReferences.map(ref=>"@"+ref.type+"/"+ref.name).join(", ")+" use uppercase or unsupported resource-name characters.");
  checks.push(missing.length?"Unresolved resource references: "+missing.join("; ")+".":"All referenced drawable/font/color/string resources visible in the supplied evidence package were resolved.");
  if(stems.length)checks.push(activityLinks+"/"+stems.length+" verified screen layout(s) are loaded by a supplied Activity source file; "+manifestLinks+"/"+stems.length+" corresponding Activity registration(s) were observed in the supplied Manifest.");
  if(dependencyPresent)checks.push("ConstraintLayout support/dependency is present in the supplied supporting project files.");
  if(assets.length)checks.push("Referenced repository image asset(s) prepared for optional visual inspection: "+assets.map(asset=>asset.path).join(", ")+".");
  else if(references.some(ref=>["drawable","mipmap"].includes(ref.type)))checks.push("Image/drawable references exist, but no bounded repository image asset was available for visual inspection; do not claim labels or artwork are absent solely from XML text.");

  return {
    applicable:true,
    checks,
    primaryStudentPaths:[...primaryStudent],
    supportingStudentPaths:supportStudent,
    referencedAssets:assets.map(asset=>asset.path),
    summary:checks.map(item=>"• "+item).join("\n")
  };
}
