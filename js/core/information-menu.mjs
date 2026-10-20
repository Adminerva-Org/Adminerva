export function mountInformationMenu(button, root) {
  const menu = document.createElement("div");
  menu.id = "av-information-panel";
  menu.className = "av-information-panel";
  menu.hidden = true;
  menu.setAttribute("aria-label", "Help and website information");
  menu.innerHTML = '<strong>Help & updates</strong><a href="patch-notes.html">What’s new</a><button type="button" data-information-report>Report a problem</button><a href="issues.html">My reports & support</a><a href="wiki.html">Website Wiki & tutorials</a><a href="wiki.html#privacy">Privacy</a><a data-information-settings>Account & activity settings</a>';
  menu.querySelector("[data-information-settings]").href = root.dataset.module?.startsWith("student") ? "student-settings.html" : "settings.html";
  root.append(menu);
  button.title = "Help and updates";
  button.setAttribute("aria-label", "Help and updates");
  button.setAttribute("aria-controls", menu.id);
  button.setAttribute("aria-expanded", "false");
  button.removeAttribute("onclick");
  button.textContent = "?";
  button.id = "av-information-toggle";
  function close(focus = false) {
    menu.hidden = true;
    button.setAttribute("aria-expanded", "false");
    if (focus) button.focus();
  }
  button.addEventListener("click", () => {
    const opening = menu.hidden;
    document.dispatchEvent(new CustomEvent("adminerva-menu-open", {detail:menu.id}));
    menu.hidden = !opening;
    button.setAttribute("aria-expanded", String(opening));
  });
  menu.querySelector("[data-information-report]").addEventListener("click", () => {
    close();
    document.getElementById("bug-modal")?.classList.remove("hidden");
    document.getElementById("bug-title")?.focus();
  });
  document.addEventListener("adminerva-menu-open", event => { if (event.detail !== menu.id) close(); });
  document.addEventListener("click", event => { if (!menu.contains(event.target) && !button.contains(event.target)) close(); });
  document.addEventListener("keydown", event => { if (event.key === "Escape" && !menu.hidden) { close(true); event.preventDefault(); } });
  root.addEventListener("toggle", event => {
    if (event.target.tagName === "DETAILS" && event.target.open) {
      document.dispatchEvent(new CustomEvent("adminerva-menu-open", {detail:"navigation"}));
    }
  }, true);
  document.addEventListener("adminerva-menu-open", event => {
    if (event.detail === "navigation") return;
    root.querySelectorAll("details[open]").forEach(details => { details.open = false; });
  });
}
