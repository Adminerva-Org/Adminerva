/** Client-side route hint only; the canonical backend still enforces tenancy. */
export function eligibleNativeWorkspace(user,access){
 if(!user?.uid||user.emailVerified!==true||
    typeof user.email!=="string"||!user.email.trim()||
    !access||typeof access!=="object")return false;
 return Boolean(access.platformAdmin===true||access.schoolAdmin===true||
  access.schoolRegistrar===true||access.schoolTeacher===true||
  access.schoolStudent===true||["admin","teacher"].includes(access.role)||
  ["admin","teacher"].includes(access.legacyRole)||
  (Array.isArray(access.students)&&access.students.length>0));
}
