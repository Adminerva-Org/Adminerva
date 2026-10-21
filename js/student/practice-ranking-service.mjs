/** Compatibility read only: ranking awards are created by the practice backend. */
import {db} from "../core/firebase-core.js";
import {doc,getDoc} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
export async function syncPracticeRanking(_user,profile){return getDoc(doc(db,"practice_rankings",profile.id));}
