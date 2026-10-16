// Sanitize only the subset of HTML used by the Quill slide editor.
// Does not permit embedded scripts, event handlers, SVG, forms, iframe, etc.
(function(){
  const allowed=new Set(["P","DIV","SPAN","B","STRONG","EM","I","U","S","H1","H2","H3",
    "OL","UL","LI","BR","BLOCKQUOTE","PRE","CODE","SUP","SUB","A","IMG"]);
  const unsafe=new Set(["SCRIPT","STYLE","SVG","MATH","IFRAME","OBJECT","EMBED",
    "FORM","INPUT","BUTTON","VIDEO","AUDIO","META","LINK"]);
  function sanitize(value){
    const doc=document.implementation.createHTMLDocument("Slide");
    const wrapper=doc.createElement("div");
    wrapper.innerHTML=String(value??"");
    function visit(node){
      for(const element of Array.from(node.children)){
        if(unsafe.has(element.tagName)){element.remove();continue;}
        visit(element);
        if(!allowed.has(element.tagName)){
          element.replaceWith(...Array.from(element.childNodes));
          continue;
        }
        for(const attr of Array.from(element.attributes)){
          const key=attr.name.toLowerCase(),val=attr.value.trim();
          if(key==="class"){
            const tokens=val.split(/\s+/).filter(x=>/^ql-[a-z0-9-]+$/i.test(x));
            if(tokens.length)element.setAttribute("class",tokens.join(" "));
            else element.removeAttribute(attr.name);
          }else if(key==="href"&&element.tagName==="A"){
            if(!/^https?:\/\//i.test(val))element.removeAttribute(attr.name);
            else{element.setAttribute("rel","noopener noreferrer");element.setAttribute("target","_blank");}
          }else if(key==="src"&&element.tagName==="IMG"){
            if(!/^https:\/\//i.test(val)&&!/^data:image\/(?:png|jpeg|webp|gif);base64,/i.test(val))
              element.removeAttribute(attr.name);
          }else if(key==="alt"&&element.tagName==="IMG"){
            continue;
          }else if(key==="data-value"&&element.classList.contains("ql-formula")){
            if(val.length>1024)element.removeAttribute(attr.name);
          }else if(key==="style"){
            // Only preserve safe Quill colors, not positioning or injected URLs.
            const declarations=val.split(";").map(x=>x.trim()).filter(Boolean);
            const safe=declarations.filter(x=>{
              const m=x.match(/^(color|background-color)\s*:\s*(#[0-9a-f]{3,8}|rgb[a]?\([0-9, %.]+\))$/i);
              return Boolean(m);
            });
            if(safe.length)element.setAttribute("style",safe.join(";"));
            else element.removeAttribute(attr.name);
          }else element.removeAttribute(attr.name);
        }
      }
    }
    visit(wrapper);
    return wrapper.innerHTML;
  }
  window.sanitizePresentationHtml=sanitize;
})();
