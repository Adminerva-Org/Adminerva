"use strict";
/**
 * Read-only System Admin user directory.
 * Exposes bounded account identity/status plus explicit platform and school membership metadata.
 * It never reads grades, submissions, assessments, source code, prompts, or school-private content.
 */
const {platformAuthority,TenantAccessError}=require("./tenant-access.js");

function deny(code,message){throw new TenantAccessError(code,message)}
function checkedUid(value){
  const uid=String(value||"").trim();
  if(!/^[A-Za-z0-9_-]{1,128}$/.test(uid))deny("invalid-argument","User account ID is invalid.");
  return uid;
}
function checkedPageToken(value){
  if(value===undefined||value===null||value==="")return undefined;
  const token=String(value);
  if(token.length>2048)deny("invalid-argument","User-directory page token is invalid.");
  return token;
}
function cleanRoles(value){
  return Array.isArray(value)?[...new Set(value.filter(role=>["student","teacher","school_admin"].includes(role)))]:[];
}
function accountSummary(user,platformAdmin=false){
  return {
    uid:user.uid,
    email:user.email||"",
    displayName:user.displayName||"",
    emailVerified:user.emailVerified===true,
    disabled:user.disabled===true,
    platformAdmin,
    createdAt:user.metadata?.creationTime||null,
    lastSignInAt:user.metadata?.lastSignInTime||null,
    providers:[...new Set((user.providerData||[]).map(row=>String(row.providerId||"")).filter(Boolean))]
  };
}

function createPlatformUserService({db,auth}){
  return async request=>{
    const authority=await platformAuthority({db,request});
    if(!authority.platformAdmin)deny("permission-denied","System Administrator access is required.");
    const input=request.data||{},action=String(input.action||"").trim();

    if(action==="list"){
      const pageSize=Math.min(50,Math.max(10,Number.isInteger(input.pageSize)?input.pageSize:25));
      const pageToken=checkedPageToken(input.pageToken);
      let page;
      try{page=await auth.listUsers(pageSize,pageToken);}
      catch(error){
        console.warn("Platform user directory list failed",{code:error?.code||"unknown"});
        deny("unavailable","User accounts could not be listed. Retry the current page.");
      }
      const grants=await Promise.all(page.users.map(user=>db.doc("platform_admins/"+user.uid).get()));
      return {
        items:page.users.map((user,index)=>accountSummary(user,
          grants[index].exists&&grants[index].data()?.status==="active"&&grants[index].data()?.role==="platform_admin")),
        nextPageToken:page.pageToken||null
      };
    }

    if(action==="lookup"){
      const query=String(input.query||"").trim();
      if(!query||query.length>254)deny("invalid-argument","Enter an exact verified email or account ID.");
      let user;
      try{
        user=query.includes("@")?await auth.getUserByEmail(query.toLowerCase()):await auth.getUser(checkedUid(query));
      }catch(error){
        if(error?.code==="auth/user-not-found")deny("not-found","No account matches that exact email or account ID.");
        console.warn("Platform user exact lookup failed",{code:error?.code||"unknown"});
        deny("unavailable","The account lookup could not finish. Retry the exact search.");
      }
      const platform=await db.doc("platform_admins/"+user.uid).get();
      return {account:accountSummary(user,
        platform.exists&&platform.data()?.status==="active"&&platform.data()?.role==="platform_admin")};
    }

    if(action==="get"){
      const uid=checkedUid(input.uid);
      let user;
      try{user=await auth.getUser(uid);}
      catch(error){
        if(error?.code==="auth/user-not-found")deny("not-found","The user account no longer exists.");
        console.warn("Platform user lookup failed",{code:error?.code||"unknown"});
        deny("unavailable","The user account could not be loaded.");
      }
      const [platform,memberships]=await Promise.all([
        db.doc("platform_admins/"+uid).get(),
        db.collection("platform_users/"+uid+"/memberships").limit(51).get()
      ]);
      if(memberships.size===51)
        deny("resource-exhausted","This account has more than 50 school memberships. Paginated membership review is required.");
      const rows=memberships.docs.map(doc=>({schoolId:doc.id,...doc.data()}))
        .filter(row=>/^[a-z][a-z0-9-]{1,63}$/.test(row.schoolId));
      const schoolDocs=rows.length?await db.getAll(...rows.map(row=>db.doc("platform_schools/"+row.schoolId))):[];
      const schools=new Map(schoolDocs.filter(doc=>doc.exists).map(doc=>[doc.id,doc.data()]));
      const membershipsOut=rows.map(row=>({
        schoolId:row.schoolId,
        schoolName:String(schools.get(row.schoolId)?.displayName||row.schoolId).slice(0,120),
        schoolState:schools.get(row.schoolId)?.state||"unknown",
        status:String(row.status||"unknown").slice(0,40),
        roles:cleanRoles(row.roles),
        revision:Number(row.revision)||1
      })).sort((a,b)=>a.schoolName.localeCompare(b.schoolName)||a.schoolId.localeCompare(b.schoolId));
      return {
        account:accountSummary(user,
          platform.exists&&platform.data()?.status==="active"&&platform.data()?.role==="platform_admin"),
        memberships:membershipsOut
      };
    }

    deny("invalid-argument","Unknown System Admin user-directory operation.");
  };
}

module.exports={createPlatformUserService};
