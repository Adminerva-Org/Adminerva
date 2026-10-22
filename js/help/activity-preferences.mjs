import {watchPreferences, savePreferences} from "../analytics/activity-client.mjs?v=1.3.0";

export function mountActivityPreferences() {
  if (document.getElementById("activity-preferences-dialog")) return;
  const home = /\/(student|teacher)-home\.html$/.test(location.pathname);
  const settings = /\/(student-)?settings\.html$/.test(location.pathname);
  const dialog = document.createElement("dialog");
  dialog.id = "activity-preferences-dialog";
  dialog.className = "av-preferences-dialog";
  dialog.setAttribute("aria-labelledby", "activity-preferences-heading");
  dialog.innerHTML = '<h2 id="activity-preferences-heading">Your activity preferences</h2><p>Sharing is optional and off by default. These choices never affect grades. No typed text, source code, credentials, full URLs or session recordings are collected.</p><label><input id="activity-share" type="checkbox"> Share module visits and approximate active time</label><label><input id="activity-diagnostics" type="checkbox"> Keep up to 20 diagnostic actions in memory on this page; attach only when I explicitly choose</label><p>Administrators see operational records; teachers receive only assigned students’ coarse snapshots. Stopping does not delete earlier records. <a href="wiki.html#privacy" class="underline">Privacy & retention details</a></p><label><input id="activity-never-show" type="checkbox"> Don’t show this on home visits again (saved for my account)</label><p>You can always change these choices in Account Settings. Hiding this message does not enable sharing.</p><button id="activity-save" type="button" disabled>Save preferences</button><button id="activity-dismiss" type="button">Not now</button><p id="activity-status" role="status">Loading your saved choices…</p>';
  document.body.append(dialog);
  const field = id => dialog.querySelector("#" + id);
  let snapshot = null, promptedUid = null, busy = false, dismissed = false;
  const buttons = document.querySelectorAll("[data-activity-preferences]");
  function open() {
    if (document.querySelector("dialog[open]")) return false;
    if (snapshot?.ready) {
      field("activity-share").checked = snapshot.enabled;
      field("activity-diagnostics").checked = snapshot.diagnostics;
      field("activity-never-show").checked = snapshot.promptDismissed;
    }
    dialog.showModal();
    return true;
  }
  if (settings) {
    const section = document.createElement("section");
    section.className = "av-preferences-settings";
    section.innerHTML = '<h2 class="font-bold text-lg">Activity & privacy</h2><p>Manage optional sharing, diagnostic actions and the home-page reminder.</p><button type="button" data-activity-preferences>Manage activity preferences</button>';
    document.querySelector("main, #pageBody > div.max-w-screen-2xl")?.prepend(section);
    section.querySelector("button").addEventListener("click", open);
  }
  for (const button of buttons) button.addEventListener("click", open);
  const stop = watchPreferences(value => {
    if (snapshot?.uid !== value.uid) { dialog.close(); promptedUid = null; dismissed = false; }
    snapshot = value;
    field("activity-save").disabled = !value.ready || busy;
    if (!value.ready) {
      field("activity-status").textContent = value.error ? "Preferences could not load. Sharing stays off; reload to retry." : "Loading your saved choices…";
      return;
    }
    for (const [id, checked] of [["activity-share",value.enabled],["activity-diagnostics",value.diagnostics],["activity-never-show",value.promptDismissed]]) field(id).checked = checked;
    field("activity-status").textContent = "Your saved choices are loaded. Nothing changes until you save.";
    maybePrompt();
  });
  function maybePrompt() {
    if (home && snapshot?.ready && !snapshot.promptDismissed && !dismissed && promptedUid !== snapshot.uid && open()) promptedUid = snapshot.uid;
  }
  document.addEventListener("close", maybePrompt, true);
  async function persist(dismissOnly = false) {
    if (busy || !snapshot?.ready) return;
    busy = true;
    field("activity-save").disabled = true;
    field("activity-dismiss").disabled = true;
    const uid = snapshot.uid;
    try {
      await savePreferences(dismissOnly ? snapshot.enabled : field("activity-share").checked,
        dismissOnly ? snapshot.diagnostics : field("activity-diagnostics").checked, field("activity-never-show").checked);
      if (snapshot.uid !== uid) return;
      field("activity-status").textContent = "Preferences saved. You can change them in Account Settings.";
      dismissed = true;
      if (home || dismissOnly) dialog.close();
    } catch {
      field("activity-status").textContent = "Could not save. Your previous choices remain unchanged. Check your connection and retry.";
    } finally {
      busy = false;
      field("activity-save").disabled = !snapshot?.ready;
      field("activity-dismiss").disabled = false;
    }
  }
  field("activity-save").addEventListener("click", () => { void persist(); });
  field("activity-dismiss").addEventListener("click", () => {
    if (busy) return;
    if (snapshot?.ready && field("activity-never-show").checked !== snapshot.promptDismissed) { void persist(true); return; }
    dismissed = true;
    dialog.close();
  });
  dialog.addEventListener("cancel", event => { if (busy) event.preventDefault(); else dismissed = true; });
  window.addEventListener("pagehide", stop, {once:true});
}
