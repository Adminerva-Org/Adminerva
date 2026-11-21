"use strict";
/**
 * School student login continuity helpers.
 *
 * A school person is the durable learner identity. Firebase UIDs are login
 * identities and may change after a reviewed account recovery. Academic
 * records keep the UID that produced each immutable version, while current
 * authorization is always verified against people/{personId}.authUid.
 */
function studentAccountUids(person,currentUid){
  const valid=value=>typeof value==="string"&&/^[A-Za-z0-9_-]{1,128}$/.test(value);
  const values=[
    currentUid,
    ...(Array.isArray(person?.previousAuthUids)?person.previousAuthUids:[])
  ].filter(valid);
  return [...new Set(values)].slice(0,21);
}
function studentRecordUidAllowed(person,currentUid,recordUid){
  return studentAccountUids(person,currentUid).includes(recordUid);
}
module.exports={studentAccountUids,studentRecordUidAllowed};
