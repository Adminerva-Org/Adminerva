import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";

const require=createRequire(import.meta.url);
const {invitationIsActivePending}=require("../functions/people-directory.js");

test("only unexpired pending invitations block person archival",()=>{
  const now=1_000_000;
  assert.equal(invitationIsActivePending({status:"pending",expiresAt:{toMillis:()=>now+60_000}},now),true);
  assert.equal(invitationIsActivePending({status:"pending",expiresAt:{toMillis:()=>now-1}},now),false);
  assert.equal(invitationIsActivePending({status:"revoked",expiresAt:{toMillis:()=>now+60_000}},now),false);
  assert.equal(invitationIsActivePending({status:"accepted",expiresAt:{toMillis:()=>now+60_000}},now),false);
});

test("pending invitation without a readable expiry fails closed as active",()=>{
  assert.equal(invitationIsActivePending({status:"pending"},1_000_000),true);
});
