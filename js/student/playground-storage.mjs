import {projectPath} from "./playground-project.mjs?v=1.3.0";
/** Student submissions, practice progress and isolated code workspaces: playground storage. */
// Per-student, per-language local workspaces. Avoid sharing code between
// students who sign in to the same computer and preserve each language's draft.
export const PLAYGROUND_LANGUAGES = ["java","python","web","csharp","cpp","dart"];
const PREFIX = "Adminerva_Playground_Workspace_v2_";
export function playgroundWorkspaceKey(uid, lang) {
  if (typeof uid !== "string" || !uid.trim() || !PLAYGROUND_LANGUAGES.includes(lang))
    throw Error("A signed-in student and supported language are required.");
  return PREFIX + uid + "_" + lang;
}
export function playgroundLanguageKey(uid) {
  if (typeof uid !== "string" || !uid.trim()) throw Error("Student sign-in required.");
  return "Adminerva_Playground_LastLanguage_" + uid;
}
export function playgroundUndoKey(uid,lang) {
  return playgroundWorkspaceKey(uid,lang) + "_before_restore";
}
export function validPlaygroundState(state) {
  if (!state || !PLAYGROUND_LANGUAGES.includes(state.lang) ||
      !state.files || typeof state.files !== "object" ||
      Array.isArray(state.files)) return false;
  const names = Object.keys(state.files);
  return names.length > 0 && names.length <= 100 &&
    names.every(name => {try{return projectPath(name)===name && typeof state.files[name] === "string";}catch{return false;}}) &&
    Array.isArray(state.fileOrder) &&
    state.fileOrder.length === names.length &&
    new Set(state.fileOrder).size === names.length &&
    state.fileOrder.every(name => Object.hasOwn(state.files,name));
}
export function readPlaygroundDraft(storage,uid,lang) {
  try {
    const raw=storage.getItem(playgroundWorkspaceKey(uid,lang));
    if (!raw) return null;
    const parsed=JSON.parse(raw);
    return validPlaygroundState(parsed) && parsed.lang === lang ? parsed : null;
  } catch { return null; }
}
