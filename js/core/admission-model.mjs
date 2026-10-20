export function registrationProfile(user,requestedRole="guest") {
  if(!user?.uid||!user.emailVerified||!user.email)throw Error("Use a verified email account to register.");
  if(!["guest","student","teacher"].includes(requestedRole))throw Error("Choose guest, student or teacher.");
  return {ownerUid:user.uid,email:user.email.trim().toLowerCase(),displayName:String(user.displayName||user.email).slice(0,120),requestedRole,status:"pending",revision:0};
}
export function admissionDestination(access) {
  if(access.role)return "teacher-home.html";
  if(access.students?.length)return "student-home.html";
  return "guest-home.html";
}
export function assertPendingRequest(current,opened) {
  if(!current||current.status!=="pending"||current.revision!==opened.revision||current.ownerUid!==opened.ownerUid||current.email!==opened.email)
    throw Error("This request changed. Reload before deciding; no access was changed.");
}
export function guestStorageKey(uid,module) {
  if(!uid||uid.includes("/")||!["playground","practice"].includes(module))throw Error("A signed-in guest workspace is required.");
  return "Adminerva_guest_"+encodeURIComponent(uid)+"_"+module;
}
