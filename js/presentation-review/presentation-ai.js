window.generateAI_SlideDeck = async function () {
  if (!window.selectedPlanData || !window.selectedSessionData) {
    alert("Please select a lesson plan and session first.");
    return;
  }

  const apiKey =
    localStorage.getItem("Adminerva_gemini_token") ||
    localStorage.getItem("repoReview_gemini_token");
  if (!apiKey) {
    alert("Gemini API Key missing. Please configure it in Global Settings.");
    return;
  }

  const genBtn = document.getElementById("btnGenerateSlides");
  if (genBtn) {
    genBtn.innerHTML = "⏳ Designing Slides...";
    genBtn.disabled = true;
  }

  if (typeof window.showSubtleLoader === "function") {
    window.showSubtleLoader("Architecting Presentation Slides...");
  }

  try {
    const aiModelName =
      localStorage.getItem("Adminerva_ai_model") || "gemini-2.5-flash";
    const prompt = `
            Act as an expert Masterclass Instructional Designer. Convert this lesson session into a highly engaging presentation slide deck.
            
            Subject: ${window.selectedPlanData.subject_title}
            Grade: ${window.selectedPlanData.grade_level}
            Topic: ${window.selectedPlanData.weekly_overview.topic}
            Session Context: ${JSON.stringify(window.selectedSessionData, null, 2)}
            
            YOUR MISSION:
            Generate a comprehensive presentation consisting of exactly 5 to 15 slides. 
            Do NOT just copy the lesson plan. Expand on it! Add real-world scenario examples, analogies, and detailed concept breakdowns that a teacher can use to explain the topic clearly.
            
            LAYOUT OPTIONS (You MUST mix and match these):
            1. "standard": 1 column of text. Good for titles, objectives, and simple explanations.
            2. "split": 2 columns of text (requires 'contentLeft' and 'contentRight'). Perfect for comparing Pros/Cons, "Before & After", or pairing a concept with a scenario.
            3. "media": A full-screen visual slide. Use this when a diagram, chart, or photo is needed. (For the 'content' field, write a brief prompt telling the teacher what image to upload).
            
            RULES:
            1. Return a pure JSON array of objects.
            2. Every object must have: "layout" (standard/split/media), "label" (Short slide title), and "content" (HTML string).
            3. If layout is "split", you MUST include "contentLeft" (HTML) and "contentRight" (HTML) instead of "content".
            4. Use native HTML (<h1>, <h2>, <p>, <ul>, <li>) for text. Keep bullets concise. Use KaTeX ($E=mc^2$) for math.
        `;

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${aiModelName}:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            responseMimeType: "application/json",
            temperature: 0.4,
          },
        }),
      },
    );

    if (!response.ok) throw new Error(`Google API Error (${response.status})`);

    const aiResult = await response.json();
    let rawJson = aiResult.candidates[0].content.parts[0].text
      .replace(/^```json\s*/i, "")
      .replace(/\s*```$/i, "")
      .trim();

    // Inject the generated deck and mark everything visible
    const parsedDeck = JSON.parse(rawJson);
    if(!Array.isArray(parsedDeck)||parsedDeck.length===0||parsedDeck.length>60)
      throw Error("The generated presentation has an invalid number of slides.");
    const sanitize=window.sanitizePresentationHtml;
    if(typeof sanitize!=="function")throw Error("Slide sanitizer failed to load.");
    window.adminervaPresentationDirty = true;
    window.currentPresentationDeck = parsedDeck.map(slide => ({
      layout:["standard","split","media"].includes(slide.layout)?slide.layout:"standard",
      label:String(slide.label||"Slide").slice(0,120),
      content:sanitize(slide.content),
      contentLeft:sanitize(slide.contentLeft),
      contentRight:sanitize(slide.contentRight),
      hidden:false,
      mediaUrl:""
    }));
    window.activeSlideIndex = 0;

    if (typeof window.renderSlideBlocks === "function") {
      window.renderSlideBlocks();
      window.selectSlide(0);
    }
  } catch (e) {
    console.error("AI Generation Failed:", e);
    alert(`Generation Failed: ${e.message}`);
  } finally {
    if (genBtn) {
      genBtn.innerHTML = "✨ Generate AI Slides";
      genBtn.disabled = false;
    }
    if (typeof window.hideSubtleLoader === "function") {
      window.hideSubtleLoader();
    }
  }
};
