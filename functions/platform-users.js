"use strict";
/**
 * System Admin global account directory and audited login-identity lifecycle.
 * This service owns Firebase/global login identity only. School person, membership,
 * enrollment, grades, submissions, Studio evidence, and other school-private
 * records remain in their canonical school-scoped services.
 */
const {FieldValue}=require("firebase-admin/firestore");
const {platformAuthority,TenantAccessError,checkedSchoolId,schoolEnrollmentMode}=require("./tenant-access.js");

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
function accountSummary(user,platformAdminStatus="none"){
  const platformAdmin=platformAdminStatus==="active";
  return {
    uid:user.uid,
    email:user.email||"",
    displayName:user.displayName||"",
    emailVerified:user.emailVerified===true,
    disabled:user.disabled===true,
    platformAdmin,
    platformAdminStatus,
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
    docs.forEach(doc=>flags.set(doc.id,
      doc.exists&&doc.data()?.role==="platform_admin"?String(doc.data()?.status||"archived"):"none"));
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
async function platformGrantRecord({db,uid}){
  const doc=await db.doc("platform_admins/"+uid).get(),data=doc.exists?doc.data():null;
  return {
    exists:doc.exists&&data?.role==="platform_admin",
    active:doc.exists&&data?.role==="platform_admin"&&data?.status==="active",
    status:doc.exists&&data?.role==="platform_admin"?String(data.status||"archived"):"none",
    revision:Number(data?.revision)||0
  };
}

function testStudentSummary(snapshot){
  const data=snapshot?.exists?snapshot.data():null;
  return {
    active:Boolean(snapshot?.exists&&data?.kind==="student"&&data?.status==="active"),
    status:snapshot?.exists&&data?.kind==="student"?String(data.status||"retired"):"none",
    revision:Number(data?.revision)||0
  };
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
        items:page.users.map(user=>accountSummary(user,flags.get(user.uid)||"none")),
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
      const items=users.map(user=>accountSummary(user,flags.get(user.uid)||"none"))
        .sort((a,b)=>(a.displayName||a.email||a.uid).localeCompare(b.displayName||b.email||b.uid));
      return {items,total:items.length};
    }

    if(action==="list_test_school_targets"){
      const schools=await db.collection("platform_schools").orderBy("displayName").limit(101).get();
      if(schools.size===101)
        deny("resource-exhausted","Test-student school selection requires paginated school registry support.");
      return {schools:schools.docs.filter(doc=>["active","pilot"].includes(doc.data().state)).map(doc=>{
        const data=doc.data()||{};
        return {
          schoolId:doc.id,
          name:String(data.displayName||doc.id).slice(0,120),
          state:String(data.state||"unknown").slice(0,30),
          compatibilityMode:data.compatibilityMode||"legacy_allowed",
          enrollmentMode:schoolEnrollmentMode(data),
          productionAuthorized:data.productionAuthorized===true
        };
      }).sort((a,b)=>a.name.localeCompare(b.name)||a.schoolId.localeCompare(b.schoolId))};
    }

    if(["mark_test_student","retire_test_student"].includes(action)){
      const uid=checkedUid(input.uid),auditReason=reason(input.reason),
        user=await getUserOrDeny(auth,uid),ref=db.doc("platform_test_accounts/"+uid),
        retiring=action==="retire_test_student";
      if((await platformGrantRecord({db,uid})).active)
        deny("failed-precondition","Platform Administrator accounts cannot be designated as test students.");
      if(!retiring&&(user.disabled||!user.emailVerified))
        deny("failed-precondition","Test-student controls require a verified, enabled login account.");
      if(retiring){
        const memberships=await db.collection("platform_users/"+uid+"/memberships").limit(51).get();
        if(memberships.size===51)
          deny("resource-exhausted","Review this account's school memberships before retiring its test designation.");
        if(memberships.docs.some(doc=>doc.data()?.status==="active"&&doc.data()?.testStudentAccess===true))
          deny("failed-precondition","Suspend the active test-student school memberships in People & Access before retiring the test designation.");
      }
      let nextRevision=1,nextStatus=retiring?"retired":"active";
      await db.runTransaction(async tx=>{
        const current=await tx.get(ref),data=current.exists?current.data():null,
          currentStatus=current.exists&&data?.kind==="student"?String(data.status||"retired"):"none",
          revision=Number(data?.revision)||0,now=FieldValue.serverTimestamp();
        if(retiring){
          if(currentStatus!=="active")deny("failed-precondition","Only an active test-student designation can be retired.");
          nextRevision=revision+1;
          tx.update(ref,{status:"retired",revision:nextRevision,retiredByUid:authority.uid,
            retiredAt:now,retireReason:auditReason,updatedByUid:authority.uid,updatedAt:now});
        }else if(currentStatus==="active"){
          deny("failed-precondition","This account is already designated as a test student.");
        }else if(current.exists){
          nextRevision=revision+1;
          tx.update(ref,{kind:"student",status:"active",revision:nextRevision,
            restoredByUid:authority.uid,restoredAt:now,restoreReason:auditReason,
            updatedByUid:authority.uid,updatedAt:now});
        }else{
          tx.create(ref,{uid,kind:"student",status:"active",revision:1,
            createdByUid:authority.uid,createdAt:now,updatedByUid:authority.uid,updatedAt:now});
        }
        tx.create(db.collection("platform_audit").doc(),{
          actorUid:authority.uid,authoritySource:authority.authoritySource||null,targetUid:uid,
          action:retiring?"platform_test_student_retired":"platform_test_student_designated",
          reason:auditReason,revision:nextRevision,createdAt:now
        });
      });
      return {account:accountSummary(user,(await platformGrantRecord({db,uid})).status),
        testAccount:{active:!retiring,status:nextStatus,revision:nextRevision}};
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
      const platform=await platformGrantRecord({db,uid:user.uid});
      return {account:accountSummary(user,platform.status)};
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
      return {account:accountSummary(user,"none"),setupLink};
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
      const platform=await platformGrantRecord({db,uid});
      return {account:accountSummary(user,platform.status)};
    }

    if(action==="disable"||action==="restore"){
      const uid=checkedUid(input.uid),auditReason=reason(input.reason),
        disabling=action==="disable";
      if(uid===authority.uid&&disabling)
        deny("failed-precondition","You cannot disable the System Administrator account currently performing this action.");
      if(disabling&&(await platformGrantRecord({db,uid})).active)
        deny("failed-precondition","Active Platform Administrator accounts must be retired from platform governance before they can be disabled.");
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
      const platform=await platformGrantRecord({db,uid});
      return {account:accountSummary(user,platform.status)};
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
      const platform=await platformGrantRecord({db,uid});
      return {account:accountSummary(user,platform.status),resetLink};
    }

    if(["grant_platform_admin","archive_platform_admin","restore_platform_admin"].includes(action)){
      const uid=checkedUid(input.uid),auditReason=reason(input.reason),
        target=await getUserOrDeny(auth,uid),ref=db.doc("platform_admins/"+uid),
        archiving=action==="archive_platform_admin",restoring=action==="restore_platform_admin";
      if(target.disabled||!target.emailVerified)
        deny("failed-precondition","Platform Administrator authority requires a verified, enabled login account.");
      if(archiving&&uid===authority.uid)
        deny("failed-precondition","You cannot retire your own Platform Administrator authority from the account you are currently using.");
      if(archiving){
        const grants=await db.collection("platform_admins").limit(101).get();
        if(grants.size===101)
          deny("resource-exhausted","Platform Administrator retirement requires paginated authority review.");
        const otherActive=grants.docs.filter(doc=>doc.id!==uid&&doc.data()?.role==="platform_admin"&&doc.data()?.status==="active");
        if(!otherActive.length)
          deny("failed-precondition","Designate another active Platform Administrator before retiring this authority.");
      }
      let nextStatus,nextRevision;
      await db.runTransaction(async tx=>{
        const current=await tx.get(ref),data=current.exists?current.data():null,
          isPlatform=current.exists&&data?.role==="platform_admin",
          status=isPlatform?String(data.status||"archived"):"none",
          revision=Number(data?.revision)||0,now=FieldValue.serverTimestamp();
        if(action==="grant_platform_admin"){
          if(isPlatform)deny("failed-precondition",status==="active"?
            "This account is already an active Platform Administrator.":"Use Restore Platform Administrator for this retired authority.");
          nextStatus="active";nextRevision=1;
          tx.set(ref,{role:"platform_admin",status:"active",revision:1,createdByUid:authority.uid,createdAt:now,
            updatedByUid:authority.uid,updatedAt:now});
        }else if(archiving){
          if(status!=="active")deny("failed-precondition","Only active Platform Administrator authority can be retired.");
          nextStatus="archived";nextRevision=revision+1;
          tx.update(ref,{status:"archived",archiveReason:auditReason,archivedByUid:authority.uid,archivedAt:now,
            revision:nextRevision,updatedByUid:authority.uid,updatedAt:now});
        }else{
          if(status!=="archived")deny("failed-precondition","Only retired Platform Administrator authority can be restored.");
          nextStatus="active";nextRevision=revision+1;
          tx.update(ref,{status:"active",restoreReason:auditReason,restoredByUid:authority.uid,restoredAt:now,
            revision:nextRevision,updatedByUid:authority.uid,updatedAt:now});
        }
        tx.create(db.collection("platform_audit").doc(),{actorUid:authority.uid,targetUid:uid,
          action:action==="grant_platform_admin"?"platform_admin_granted":archiving?
            "platform_admin_archived":"platform_admin_restored",
          reason:auditReason,revision:nextRevision,createdAt:now});
      });
      return {account:accountSummary(await auth.getUser(uid),nextStatus),revision:nextRevision};
    }

    if(action==="get"){
      const uid=checkedUid(input.uid),user=await getUserOrDeny(auth,uid);
      const [platform,memberships,testAccount]=await Promise.all([
        db.doc("platform_admins/"+uid).get(),
        db.collection("platform_users/"+uid+"/memberships").limit(51).get(),
        db.doc("platform_test_accounts/"+uid).get()
      ]);
      if(memberships.size===51)
        deny("resource-exhausted","This account has more than 50 school memberships. Paginated membership review is required.");
      const rows=memberships.docs.map(doc=>({schoolId:doc.id,...doc.data()}))
        .filter(row=>/^[a-z][a-z0-9-]{1,63}$/.test(row.schoolId));
      const [schoolDocs,memberDocs]=await Promise.all([
        rows.length?db.getAll(...rows.map(row=>db.doc("platform_schools/"+row.schoolId))):[],
        rows.length?db.getAll(...rows.map(row=>db.doc("schools/"+row.schoolId+"/memberships/"+uid))):[]
      ]);
      const schools=new Map(schoolDocs.filter(doc=>doc.exists).map(doc=>[doc.id,doc.data()])),
        members=new Map(memberDocs.filter(doc=>doc.exists).map(doc=>[doc.ref.parent.parent.id,doc.data()]));
      const membershipsOut=rows.map(row=>{
        const school=schools.get(row.schoolId)||{},member=members.get(row.schoolId)||{};
        return {
          schoolId:row.schoolId,
          schoolName:String(school.displayName||row.schoolId).slice(0,120),
          schoolState:school.state||"unknown",
          status:String(row.status||"unknown").slice(0,40),
          roles:cleanRoles(row.roles),
          revision:Number(row.revision)||1,
          personId:String(member.personId||"").slice(0,128),
          testStudentAccess:row.testStudentAccess===true||member.testStudentAccess===true,
          compatibilityMode:school.compatibilityMode||"legacy_allowed",
          enrollmentMode:schoolEnrollmentMode(school),
          productionAuthorized:school.productionAuthorized===true
        };
      }).sort((a,b)=>a.schoolName.localeCompare(b.schoolName)||a.schoolId.localeCompare(b.schoolId));
      return {
        account:accountSummary(user,
          platform.exists&&platform.data()?.role==="platform_admin"?String(platform.data()?.status||"archived"):"none"),
        testAccount:testStudentSummary(testAccount),
        memberships:membershipsOut
      };
    }

    deny("invalid-argument","Unknown System Admin user-directory operation.");
  };
}

module.exports={createPlatformUserService};
