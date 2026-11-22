"use strict";
/**
 * System Admin global account directory and audited login-identity lifecycle.
 * This service owns Firebase/global login identity only. School person, membership,
 * enrollment, grades, submissions, Studio evidence, and other school-private
 * records remain in their canonical school-scoped services.
 */
const {FieldValue}=require("firebase-admin/firestore");
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
  return Array.isArray(value)?[...new Set(value.filter(role=>["student","teacher","registrar","school_admin"].includes(role)))]:[];
}
function requiredText(value,label,min=2,max=160){
  const out=typeof value==="string"?value.trim():"";
  if(out.length<min||out.length>max)deny("invalid-argument",label+" is missing or outside permitted length.");
  return out;
}
function optionalText(value,label,max=160){
  const out=typeof value==="string"?value.trim():"";
  if(out.length>max)deny("invalid-argument",label+" is too long.");
  return out;
}
function checkedEmail(value){
  const email=String(value||"").trim().toLowerCase();
  if(!email||email.length>254||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    deny("invalid-argument","Enter a valid account email.");
  return email;
}
function reason(value,label="Administrative reason"){
  return requiredText(value,label,12,500);
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
async function platformFlags({db,users}){
  const flags=new Map();
  for(let offset=0;offset<users.length;offset+=400){
    const chunk=users.slice(offset,offset+400);
    const docs=chunk.length?await db.getAll(...chunk.map(user=>db.doc("platform_admins/"+user.uid))):[];
    docs.forEach(doc=>flags.set(doc.id,doc.exists&&doc.data()?.status==="active"&&doc.data()?.role==="platform_admin"));
  }
  return flags;
}
async function writeAudit({db,authority,action,targetUid=null,details={}}){
  await db.collection("platform_audit").add({
    actorUid:authority.uid,
    authoritySource:authority.authoritySource||null,
    action,
    ...(targetUid?{targetUid}:{}),
    ...details,
    createdAt:FieldValue.serverTimestamp()
  });
}
async function getUserOrDeny(auth,uid){
  try{return await auth.getUser(checkedUid(uid));}
  catch(error){
    if(error?.code==="auth/user-not-found")deny("not-found","The user account no longer exists.");
    console.warn("Platform user lookup failed",{code:error?.code||"unknown"});
    deny("unavailable","The user account could not be loaded.");
  }
}
async function platformGrant({db,uid}){
  const doc=await db.doc("platform_admins/"+uid).get();
  return doc.exists&&doc.data()?.status==="active"&&doc.data()?.role==="platform_admin";
}

function createPlatformUserService({db,auth}){
  return async request=>{
    const authority=await platformAuthority({db,request});
    if(!authority.platformAdmin)deny("permission-denied","System Administrator access is required.");
    const input=request.data||{},action=String(input.action||"").trim();

    if(action==="list"){
      const pageSize=Math.min(1000,Math.max(10,Number.isInteger(input.pageSize)?input.pageSize:100));
      const pageToken=checkedPageToken(input.pageToken);
      let page;
      try{page=await auth.listUsers(pageSize,pageToken);}
      catch(error){
        console.warn("Platform user directory list failed",{code:error?.code||"unknown"});
        deny("unavailable","User accounts could not be listed. Retry the current page.");
      }
      const flags=await platformFlags({db,users:page.users});
      return {
        items:page.users.map(user=>accountSummary(user,flags.get(user.uid)===true)),
        nextPageToken:page.pageToken||null
      };
    }

    if(action==="list_all"){
      const users=[];
      let pageToken;
      try{
        do{
          const page=await auth.listUsers(1000,pageToken);
          users.push(...page.users);
          pageToken=page.pageToken||undefined;
          if(users.length>10000)
            deny("resource-exhausted","The platform directory exceeds the safe full-directory limit. Use a paginated administrative search.");
        }while(pageToken);
      }catch(error){
        if(error instanceof TenantAccessError)throw error;
        console.warn("Platform full user directory list failed",{code:error?.code||"unknown"});
        deny("unavailable","The complete user directory could not be loaded. Retry the directory.");
      }
      const flags=await platformFlags({db,users});
      const items=users.map(user=>accountSummary(user,flags.get(user.uid)===true))
        .sort((a,b)=>(a.displayName||a.email||a.uid).localeCompare(b.displayName||b.email||b.uid));
      return {items,total:items.length};
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
      return {account:accountSummary(user,await platformGrant({db,uid:user.uid}))};
    }

    if(action==="create"){
      const email=checkedEmail(input.email);
      const displayName=requiredText(input.displayName,"Display name",2,140);
      const auditReason=reason(input.reason);
      let user;
      try{
        user=await auth.createUser({email,displayName,emailVerified:false,disabled:false});
      }catch(error){
        if(error?.code==="auth/email-already-exists")deny("already-exists","An account already uses that email.");
        if(error?.code==="auth/invalid-email")deny("invalid-argument","Enter a valid account email.");
        console.warn("Platform account creation failed",{code:error?.code||"unknown"});
        deny("unavailable","The account could not be created.");
      }
      let setupLink=null;
      try{setupLink=await auth.generatePasswordResetLink(email);}
      catch(error){console.warn("Platform account setup-link generation failed",{uid:user.uid,code:error?.code||"unknown"});}
      await writeAudit({db,authority,action:"platform_account_created",targetUid:user.uid,
        details:{email,displayName,reason:auditReason}});
      return {account:accountSummary(user,false),setupLink};
    }

    if(action==="update_profile"){
      const uid=checkedUid(input.uid);
      const displayName=requiredText(input.displayName,"Display name",2,140);
      const auditReason=reason(input.reason);
      const before=await getUserOrDeny(auth,uid);
      let user;
      try{user=await auth.updateUser(uid,{displayName});}
      catch(error){
        console.warn("Platform account profile update failed",{uid,code:error?.code||"unknown"});
        deny("unavailable","The account profile could not be updated.");
      }
      await writeAudit({db,authority,action:"platform_account_profile_updated",targetUid:uid,
        details:{previousDisplayName:before.displayName||"",displayName,reason:auditReason}});
      return {account:accountSummary(user,await platformGrant({db,uid}))};
    }

    if(action==="disable"||action==="restore"){
      const uid=checkedUid(input.uid),auditReason=reason(input.reason),
        disabling=action==="disable";
      if(uid===authority.uid&&disabling)
        deny("failed-precondition","You cannot disable the System Administrator account currently performing this action.");
      if(disabling&&await platformGrant({db,uid}))
        deny("failed-precondition","Active Platform Administrator accounts must be removed from platform governance before they can be disabled.");
      const before=await getUserOrDeny(auth,uid);
      if(disabling&&before.disabled)deny("failed-precondition","This account is already disabled.");
      if(!disabling&&!before.disabled)deny("failed-precondition","This account is already enabled.");
      let user;
      try{user=await auth.updateUser(uid,{disabled:disabling});}
      catch(error){
        console.warn("Platform account lifecycle update failed",{uid,action,code:error?.code||"unknown"});
        deny("unavailable","The account lifecycle change could not be completed.");
      }
      await writeAudit({db,authority,
        action:disabling?"platform_account_disabled":"platform_account_restored",targetUid:uid,
        details:{reason:auditReason}});
      return {account:accountSummary(user,await platformGrant({db,uid}))};
    }

    if(action==="reset_password"){
      const uid=checkedUid(input.uid),auditReason=reason(input.reason);
      const user=await getUserOrDeny(auth,uid);
      if(user.disabled)deny("failed-precondition","Restore this account before generating a password reset link.");
      if(!user.email)deny("failed-precondition","This account has no email address for password recovery.");
      let resetLink;
      try{resetLink=await auth.generatePasswordResetLink(user.email);}
      catch(error){
        console.warn("Platform password reset link failed",{uid,code:error?.code||"unknown"});
        deny("unavailable","A password reset link could not be generated.");
      }
      await writeAudit({db,authority,action:"platform_account_password_reset_link_generated",targetUid:uid,
        details:{reason:auditReason}});
      return {account:accountSummary(user,await platformGrant({db,uid})),resetLink};
    }

    if(action==="get"){
      const uid=checkedUid(input.uid),user=await getUserOrDeny(auth,uid);
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
