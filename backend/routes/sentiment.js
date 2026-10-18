const express = require("express");
const axios = require("axios");
const router = express.Router();

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const MODEL = process.env.GROQ_MODEL || "openai/gpt-oss-20b";
const CACHE_TTL_MS = 15 * 60 * 1000;
const BATCH_SIZE = 8;

const cache = new Map();

const SYSTEM_PROMPT = `You are a financial sentiment analysis engine.
Classify each headline's likely sentiment impact on investors.
Return ONLY valid JSON:
{"items":[{"sentiment":"positive","confidence":85,"reason":"brief explanation"}]}
Rules:
- One object per input headline, in the same order.
- sentiment must be exactly positive, negative, or neutral (lowercase).
- confidence must be an integer between 60 and 98.
- reason must be one short sentence under 20 words.`;

function cacheKey(headline) {
  return String(headline).replace(/\s+/g, " ").trim();
}

function getCached(headline) {
  const entry = cache.get(cacheKey(headline));
  if (!entry) return null;
  if (Date.now() > entry.expires) {
    cache.delete(cacheKey(headline));
    return null;
  }
  return entry.value;
}

function setCached(headline, value) {
  cache.set(cacheKey(headline), { value, expires: Date.now() + CACHE_TTL_MS });
}

function retryDelayMs(err) {
  const msg = err.response?.data?.error?.message || err.message || "";
  const match = msg.match(/try again in ([\d.]+)\s*(ms|s)/i);
  if (!match) return 1200;
  const amount = Number(match[1]);
  return match[2].toLowerCase() === "ms" ? amount : amount * 1000;
}

function parseBatchPayload(aiText, count) {
  const greedy = aiText.match(/\{[\s\S]*\}/);
  const parsed = JSON.parse(greedy ? greedy[0] : aiText);
  const items = Array.isArray(parsed.items) ? parsed.items : Array.isArray(parsed.sentiment) ? parsed.sentiment : null;
  if (!items || items.length === 0) throw new Error("No items in model JSON");
  if (items.length !== count) {
    console.warn(`  ! Model returned ${items.length} item(s) for ${count} headline(s)`);
  }
  return items;
}

function normalizeItem(headline, parsed) {
  return {
    headline,
    sentiment: String(parsed?.sentiment || "neutral").toLowerCase(),
    confidence: typeof parsed?.confidence === "number" ? parsed.confidence : 70,
    reason: parsed?.reason || "",
  };
}

function unavailable(headline) {
  return {
    headline,
    sentiment: "neutral",
    confidence: 70,
    reason: "Analysis unavailable.",
  };
}

async function groqChat(messages, maxCompletionTokens) {
  const response = await axios.post(
    GROQ_URL,
    {
      model: MODEL,
      messages,
      max_completion_tokens: maxCompletionTokens,
      temperature: 0.2,
      reasoning_effort: "low",
      response_format: { type: "json_object" },
    },
    {
      headers: {
        Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
        "Content-Type": "application/json",
      },
      timeout: 25000,
    }
  );
  const message = response.data.choices[0].message;
  const aiText = String(message.content || message.reasoning || "").trim();
  if (!aiText) throw new Error("Empty model response");
  return aiText;
}

async function withRetry(fn, attempts = 4) {
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const status = err.response?.status;
      const msg = err.response?.data?.error?.message || err.message;
      const retryable = status === 429 || /rate limit/i.test(msg);
      if (!retryable || i === attempts - 1) throw err;
      const wait = Math.min(retryDelayMs(err) + 150, 8000);
      console.warn(`  ! Rate limited, retry ${i + 1}/${attempts - 1} in ${Math.round(wait)}ms`);
      await new Promise((r) => setTimeout(r, wait));
    }
  }
  throw lastErr;
}

async function analyzeBatch(headlines) {
  const numbered = headlines.map((h, i) => `${i + 1}. ${h}`).join("\n");
  const aiText = await withRetry(() =>
    groqChat(
      [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: `Headlines:\n${numbered}` },
      ],
      1600
    )
  );
  console.log(`  -> batch of ${headlines.length}: ${aiText.slice(0, 180)}`);
  const items = parseBatchPayload(aiText, headlines.length);
  return headlines.map((headline, i) => normalizeItem(headline, items[i]));
}

router.post("/", async (req, res) => {
  const { headlines } = req.body;

  if (!headlines || !Array.isArray(headlines) || headlines.length === 0) {
    return res.status(400).json({ error: "Invalid input" });
  }

  const unique = [];
  const seen = new Set();
  for (const headline of headlines) {
    const key = cacheKey(headline);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    unique.push(headline);
  }

  console.log(`Sentiment: analyzing ${unique.length} headline(s)`);

  try {
    const pending = [];
    const resultsByKey = new Map();

    for (const headline of unique) {
      const cached = getCached(headline);
      if (cached) {
        resultsByKey.set(cacheKey(headline), cached);
      } else {
        pending.push(headline);
      }
    }

    if (pending.length) {
      console.log(`  ${resultsByKey.size} cached, ${pending.length} to fetch`);
    }

    for (let i = 0; i < pending.length; i += BATCH_SIZE) {
      const chunk = pending.slice(i, i + BATCH_SIZE);
      try {
        const analyzed = await analyzeBatch(chunk);
        analyzed.forEach((item) => {
          setCached(item.headline, item);
          resultsByKey.set(cacheKey(item.headline), item);
        });
      } catch (err) {
        const msg = err.response?.data?.error?.message || err.message;
        console.error(`  ! Batch failed: ${msg}`);
        chunk.forEach((headline) => {
          resultsByKey.set(cacheKey(headline), unavailable(headline));
        });
      }
    }

    const results = unique.map(
      (headline) => resultsByKey.get(cacheKey(headline)) || unavailable(headline)
    );

    res.json({ sentiment: results });
  } catch (error) {
    console.error("Sentiment route error:", error.message);
    res.status(500).json({ error: "Sentiment analysis failed" });
  }
});

module.exports = router;
