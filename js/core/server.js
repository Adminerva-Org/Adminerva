/** Shared navigation, account access, reporting and release infrastructure: server. */
import express from "express";
import cors from "cors";

const app = express();
const PORT = 3000;
// Use 127.0.0.1 instead of localhost to prevent IPv6 binding issues in Node
const OLLAMA_URL = "https://localhost:11434/api/generate";

app.use(cors());
app.use(express.json({ limit: "10mb" }));

app.post("/api/generate-lesson", async (req, res) => {
  const { prompt, taskType } = req.body;

  if (!prompt) return res.status(400).json({ error: "Prompt is required." });

  // 🚀 DYNAMIC MODEL ROUTING
  let targetModel = "qwen2.5:3b";
  let isJsonRequired = false;

  if (taskType === "creative") {
    // Creative text/story logic (Pre-checks, standard chatting)
    targetModel = "llama3.2:3b";
    isJsonRequired = false;
  } else if (taskType === "structured") {
    // Rigid JSON logic (Curriculum mapping, lesson plans)
    targetModel = "qwen2.5:3b";
    isJsonRequired = true;
  }

  // 🚀 OLLAMA PAYLOAD CONFIGURATION
  const ollamaPayload = {
    model: targetModel,
    prompt: prompt,
    stream: false,
  };

  // 🚀 STRICT JSON ENFORCEMENT
  if (isJsonRequired) {
    ollamaPayload.format = "json";
  }

  try {
    console.log(
      `[SYS] Routing task '${taskType}' to model '${targetModel}'...`,
    );

    const ollamaResponse = await fetch(OLLAMA_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(ollamaPayload),
      // 🚀 NEW: Increase headers timeout to 10 minutes (600,000ms) for CPU-bound models
      signal: AbortSignal.timeout(600000),
    });

    if (!ollamaResponse.ok)
      throw new Error(`Ollama API failed with status ${ollamaResponse.status}`);

    const data = await ollamaResponse.json();
    const generatedText = data.response;

    // 🚀 DEBUG CONSOLE LOG (INSERTED HERE)
    console.log(
      "[DEBUG] Raw Ollama Output length:",
      generatedText ? generatedText.length : 0,
    );
    console.log("[DEBUG] Raw Ollama Output preview:", generatedText);

    if (!generatedText || generatedText.trim() === "") {
      return res.status(500).json({
        error:
          "Ollama returned an empty response. The model may have timed out or choked on the JSON format constraint.",
      });
    }

    // 🚀 DATABASE-READY PIPELINE
    // The data is fully generated and sitting in RAM right here.
    // TODO: Insert your database logic here to save 'generatedText'
    // to MongoDB, Firestore, or MySQL BEFORE sending it to the client.
    // e.g., await db.collection('logs').insertOne({ model: targetModel, output: generatedText });

    res.json({ result: generatedText });
  } catch (error) {
    console.error("[ERROR] Proxy Failure:", error);
    res.status(500).json({ error: "Failed to connect to local AI engine." });
  }
});

app.listen(PORT, () => {
  console.log(
    `🚀 Adminerva Backend Proxy running on https://localhost:${PORT}`,
  );
});
