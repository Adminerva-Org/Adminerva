"use strict";
// Pure validators for original historical records. A receipt is a frozen
// checkpoint, NOT a modern student-selected contribution list.
const safeId=value=>typeof value==="string"&&value.length>0&&value.length<=330&&
  !/[\\/\u0000-\u001f\u007f]/.test(value)&&value!=="."&&value!==".."&&!/^__.*__$/.test(value);
const SHA=/^[a-f0-9]{40}$/i;
function originalReceipt(doc,assessmentId){
 const row=doc?.data?.();
 if(!safeId(assessmentId)||!safeId(row?.studentId)||row.assessmentId!==assessmentId||
    !safeId(row.submittedByUid)||!row.submittedAt||!SHA.test(row.revisionSha||"")||
    doc.id!==row.studentId+"_"+assessmentId+"_"+row.revisionSha)return null;
 let url;
 try{url=new URL(row.repoUrl);}catch{return null;}
 const parts=url.pathname.replace(/\/$/,"").replace(/\.git$/i,"").split("/").filter(Boolean);
 if(url.protocol!=="https:"||url.hostname!=="github.com"||parts.length!==2||
    url.username||url.password||url.port||url.search||url.hash||
    parts.some(p=>! /^[A-Za-z0-9_.-]+$/.test(p)||p==="."||p===".."))return null;
 const sourcePath=String(row.sourcePath||"");
 if(sourcePath.length>240||sourcePath.startsWith("/")||
    sourcePath.split("/").some(p=>p===".."||p===".")||/[\\\u0000-\u001f\u007f]/.test(sourcePath))return null;
 const submittedAt=row.submittedAt?.toMillis?.()??(typeof row.submittedAt==="string"?Date.parse(row.submittedAt):NaN);
 if(!Number.isFinite(submittedAt)||submittedAt<=0)return null;
 return {studentId:row.studentId,section:String(row.section||""),checkpointSha:row.revisionSha.toLowerCase(),
    sourcePath,submittedAt,repository:"https://github.com/"+parts.join("/"),
    receiptId:doc.id};
}
function originalActivityGrade(doc,assessmentId){
 const row=doc?.data?.();
 if(!safeId(row?.studentId)||row.taskId!==assessmentId||
    row.score==null||row.score===""||row.maxScore==null||row.maxScore==="")return null;
 const score=Number(row.score),maximum=Number(row.maxScore),pending=Number(row.pending??0);
 if(!Number.isFinite(score)||!Number.isFinite(maximum)||maximum<=0||score<0||score>maximum||
    !Number.isFinite(pending)||pending<0||score+pending>maximum)return null;
 return {...row,score,maxScore:maximum,pending};
}
module.exports={originalReceipt,originalActivityGrade};
