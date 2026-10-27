/** Student submissions, practice progress and isolated code workspaces: submission receipts. */
import {auth,db} from "../core/firebase-core.js?v=1.3.0";
import {doc,getDoc,setDoc,serverTimestamp} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

const el=id=>document.getElementById(id);
function repositoryUrl(value){
  let url;try{url=new URL(String(value||""))}catch{throw Error("Link a repository in Profile Settings first.")}
  const segments=url.pathname.replace(/\/$/,"").replace(/\.git$/i,"").split("/").filter(Boolean);
  if(url.protocol!=="https:"||url.hostname.toLowerCase()!=="github.com"||
     segments.length!==2||!segments.every(v=>/^[a-zA-Z0-9_.-]+$/.test(v)))
    throw Error("Enter a valid GitHub repository URL in Profile Settings.");
  return {owner:segments[0],repo:segments[1],url:"https://github.com/"+segments.join("/")};
}
async function githubJson(url){
  const res=await fetch(url,{headers:{Accept:"application/vnd.github+json"}});
  if(!res.ok)throw Error("GitHub returned HTTP "+res.status+
    ". Private repositories will need a future secure account connection.");
  return res.json();
}
async function submit(){
  const context=window.__adminervaSubmissionContext?.();
  const task=context?.task,profile=context?.profile,user=auth.currentUser;
  const button=el("submitAssessmentReview"),status=el("submissionReviewStatus");
  if(!task||!profile||!user){status.textContent="No student or assessment selected.";return;}
  if((profile.email||"").toLowerCase()!==(user.email||"").toLowerCase()){
    status.textContent="Submission is unavailable while viewing an impersonated profile.";return;
  }
  const relativePath=el("submissionSourcePath").value.trim().replaceAll("\\","/");
  if(relativePath.startsWith("/")||relativePath.split("/").includes("..")||relativePath.length>240){
    status.textContent="Use a repository-relative file or folder path.";return;
  }
  button.disabled=true;
  status.textContent="Verifying the latest repository commit…";
  try{
    const repository=repositoryUrl(profile.repoUrl);
    const api="https://api.github.com/repos/"+encodeURIComponent(repository.owner)+"/"+
      encodeURIComponent(repository.repo);
    const info=await githubJson(api);
    const commit=await githubJson(api+"/commits/"+encodeURIComponent(info.default_branch||"main"));
    if(!/^[a-f0-9]{40}$/i.test(commit.sha||""))throw Error("GitHub did not return a valid commit.");
    // A missing document is not readable under owner-only Firestore rules.
    // Create directly and handle the immutable existing receipt on rejection.
    // Using the full SHA also avoids collisions between short SHA prefixes.
    const id=profile.id+"_"+task.id+"_"+commit.sha;
    const ref=doc(db,"student_submissions",id);
    if(!confirm("Submit "+task.title+" for review at commit "+commit.sha.slice(0,12)+
      "? This creates a submission record, not a grade.")){
      status.textContent="Submission cancelled.";return;
    }
    try {
      await setDoc(ref,{
        studentId:profile.id,assessmentId:task.id,submittedByUid:user.uid,
        studentName:profile.name||"Student",assessmentTitle:task.title||"Assessment",
        repoUrl:repository.url,githubLogin:profile.githubUsername||"",
        revisionSha:commit.sha,sourcePath:relativePath,
        section:context.section,submittedAt:serverTimestamp()
      });
    } catch (writeError) {
      if (writeError?.code==="permission-denied") {
        // Existing receipt reads are permitted to the original student.
        // Other authorization failures must remain errors.
        try {
          const existing=await getDoc(ref);
          if(existing.exists() && existing.data().submittedByUid===user.uid &&
             existing.data().revisionSha===commit.sha) {
            status.textContent="This revision was already submitted. Commit: "+commit.sha.slice(0,12);
            button.textContent="Already submitted";
            return;
          }
        } catch (_) { /* Do not hide the original write failure. */ }
      }
      throw writeError;
    }
    window.dispatchEvent(new CustomEvent("adminerva:submission-recorded",{
      detail:{assessmentId:task.id,studentId:profile.id,revisionSha:commit.sha}
    }));
    status.textContent="Submitted successfully. Revision: "+commit.sha.slice(0,12)+
      ". Your teacher can review this exact commit.";
    button.textContent="Submission recorded";
  }catch(error){
    status.textContent="Unable to submit: "+error.message;
  }finally{button.disabled=false;}
}
el("submitAssessmentReview")?.addEventListener("click",()=>{void window.withLoading("Verifying and submitting repository revision…",submit,{button:el("submitAssessmentReview")});});
