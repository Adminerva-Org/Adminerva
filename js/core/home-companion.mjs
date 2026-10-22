const prompts=["One thing at a time. Try one short challenge.","Relax your shoulders and take one easy breath.","A small experiment is a useful next step.","Save your work, stretch your hands, and begin again."];
for(const root of document.querySelectorAll("[data-home-companion]")){
  const button=root.querySelector("[data-companion-tap]"),message=root.querySelector("[data-companion-message]");let index=0;
  button.addEventListener("click",()=>{message.textContent=prompts[index++%prompts.length];button.classList.remove("av-companion-stretch");requestAnimationFrame(()=>button.classList.add("av-companion-stretch"));});
}
