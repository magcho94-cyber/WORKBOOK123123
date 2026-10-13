"use strict";
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { parseSource, parseParagraphInputs, parseMockInputs, readingRanges, readingPanelRanges, repairBlanks, validateParagraph } = require("./workbook_core");

const jobs = new Map();
const MAX_JOBS = 24;
const textModel = () => process.env.OPENAI_WORKBOOK_MODEL || "gpt-5-mini";
const imageModel = () => process.env.OPENAI_IMAGE_MODEL || "gpt-image-2.5-flare";
// A background-free character sheet prevents unrelated scenery in the old art from leaking into new passages.
const mascotPng = fs.readFileSync(path.join(__dirname, "assets", "mascot_reference.png"));
const object = properties => ({ type: "object", properties, required: Object.keys(properties), additionalProperties: false });
const str = { type: "string" };
const schema = object({
  sentences: { type: "array", items: object({
    translation: str, blanks: { type: "array", items: str },
    grammar_correct: str, grammar_wrong: str, grammar_reason: str, connection: str,
  }) },
  topic: str, paragraph_title: str,
  reading_captions: { type: "array", items: str },
  reading_scenes: { type: "array", items: object({ panels: { type: "array", items: str } }) },
  questions: { type: "array", items: object({ question: str, answer: str }) },
  ox: { type: "array", items: object({ statement: str, answer: { type: "string", enum: ["O", "X"] }, reason: str }) },
});

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function openai(endpoint, body, timeout) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const form = body instanceof FormData;
      const r = await fetch(`https://api.openai.com/v1/${endpoint}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, ...(!form && { "Content-Type": "application/json" }) },
        body: form ? body : JSON.stringify(body), signal: AbortSignal.timeout(timeout),
      });
      let data;
      try { data = await r.json(); } catch { throw Error(`OpenAI 응답을 읽지 못했습니다 (${r.status}).`); }
      if (r.ok) return data;
      const code = data.error?.code || "";
      const error = Error(`OpenAI 오류 (${r.status}${code ? `, ${code}` : ""}): ${data.error?.message || "요청 실패"}`);
      error.retryable = [408, 409, 429, 500, 502, 503, 504].includes(r.status) &&
        !/(quota|credit|spend|billing|usage_limit)/i.test(code);
      const retryAfter = Number(r.headers?.get?.("retry-after"));
      error.retryAfter = Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter * 1000, 30000) : 0;
      throw error;
    } catch (error) {
      const retryable = error.retryable || error.name === "TimeoutError" || error.name === "AbortError" || error instanceof TypeError;
      if (!retryable || attempt === 2) throw error;
      await delay(Math.max(error.retryAfter || 0, 1200 * 2 ** attempt));
    }
  }
}

async function generateParagraph(source, i, previous, feedback = "") {
  const target = Math.min(5, Math.max(4, source.sentences.length));
  const instruction = `You are a Korean high-school English workbook editor. Reply with the given strict JSON schema.
Use exactly one sentence object for every source sentence and preserve their order. Do not rewrite or omit any English sentence.
Provide natural Korean translation for each sentence; when provided, reproduce its Korean translation verbatim.
For EVERY English sentence choose 2 or 3 DIFFERENT, single-word blanks copied EXACTLY with case from the sentence. If a very short sentence has only one distinct word, choose that one word. No phrase blanks.
For EVERY English sentence choose a grammatically meaningful correct expression copied EXACTLY from its source and a clearly wrong alternative. Explain the choice in Korean. Avoid stylistic or ambiguous choices.
Connection: briefly explain in Korean WHY the immediately preceding sentence leads to this one, citing the actual logical move. For the first sentence use empty string when previous_sentence is empty; when prior-paragraph context is provided, explain the cross-paragraph connection for its first sentence.
Write ${target} Korean content questions, from overall idea to concrete details, with answers. Write ${target} fairly tricky Korean O/X statements including at least one O and one X; keep distinctions factual and give the reason/correction. Provide Korean topic and paragraph title. Write EXACTLY ${readingRanges(source.sentences.length).length} brief Korean reading_captions, one for each consecutive READING page specified by reading_pages, in the same order. Usually place three sentences on a page; the final page may contain four or five sentences to absorb one or two remaining sentences. A short paragraph of one or two sentences stays on one page. Each caption describes only the meaning of its page's sentences, in one short factual sentence.
Also write EXACTLY one reading_scenes object per reading page. Its panels array MUST match that page's panel_sentence_numbers groups, in order. For each panel, write one short concrete English visual description depicting ONLY the relevant source sentences. Name the people, actions, objects and setting explicitly stated or unambiguously implied there; for an abstract sentence, depict its core relationship using those same subjects. Never invent unrelated characters, buildings, flags, books, vehicles, tools, dates, emblems, or historical scenes. These descriptions will control the illustration, so factual fidelity takes priority over decoration. No invented source facts.${feedback ? ` Prior validation error: ${feedback.slice(0, 700)}` : ""}`;
  const response = await openai("responses", {
    model: textModel(), store: false, reasoning: { effort: "low" },
    input: [
      { role: "developer", content: instruction },
      { role: "user", content: JSON.stringify({ paragraph: source.number ? 1 : i + 1, previous_sentence: previous, ...source,
        reading_pages: readingRanges(source.sentences.length).map(([start, end]) => ({ from: start + 1, to: end,
          panel_sentence_numbers: readingPanelRanges(end - start).map(([a, b]) =>
            Array.from({ length: b - a }, (_, j) => start + a + j + 1)) })) }) },
    ],
    text: { format: { type: "json_schema", name: "workbook_paragraph", strict: true, schema } },
    max_output_tokens: Math.min(14000, Math.max(4000, source.sentences.length * 850 + 1400)),
  }, 240000);
  if (response.status !== "completed") throw Error(`모델 응답 미완료: ${response.status || "unknown"}`);
  const output = response.output?.flatMap(x => x.content || []).filter(x => x.type === "output_text").map(x => x.text).join("");
  if (!output) throw Error("워크북 응답이 비었습니다.");
  const generated = JSON.parse(output);
  if (generated.sentences.length !== source.sentences.length) throw Error("문장 수가 원문과 다릅니다.");
  if (generated.questions.length !== target || generated.ox.length !== target) throw Error("내용 확인 문항 수가 맞지 않습니다.");
  if (!Array.isArray(generated.reading_captions) || generated.reading_captions.length !== readingRanges(source.sentences.length).length || generated.reading_captions.some(x => !String(x).trim())) throw Error("READING 페이지별 그림 설명 수가 맞지 않습니다.");
  const par = {
    heading: source.heading, topic: generated.topic, paragraph_title: generated.paragraph_title,
    questions: generated.questions, ox: generated.ox, reading_captions: generated.reading_captions,
    reading_scenes: generated.reading_scenes,
    sentences: source.sentences.map((row, j) => ({
      en: row.en, ko: row.ko || generated.sentences[j].translation,
      blanks: repairBlanks(row.en, generated.sentences[j].blanks),
      grammar_correct: generated.sentences[j].grammar_correct,
      grammar_wrong: generated.sentences[j].grammar_wrong,
      grammar_reason: generated.sentences[j].grammar_reason,
      connection: generated.sentences[j].connection,
    })),
  };
  validateParagraph(par, source, source.number ? 1 : i + 1);
  return par;
}

async function parallel(items, limit, worker) {
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const current = cursor++;
      await worker(items[current], current);
    }
  }));
}

function imagePrompt(item) {
  const groups = readingPanelRanges(item.sentences.length);
  const panelDirections = groups.map(([a, b], i) =>
    `Panel ${i + 1} — source sentence${b - a > 1 ? "s" : ""} ${Array.from({ length: b - a }, (_, j) => a + j + 1).join(" and ")}: ${item.scenes?.[i] || "Depict the precise source meaning."} Source: ${item.sentences.slice(a, b).join(" ")}`);
  return `Create a NEW, factually accurate horizontal comic for a Korean English READING workbook.
REFERENCE IMAGE ROLE: It is a clean character sheet. Use it ONLY for the two recurring chibi mascots' faces, hairstyles, glasses, clothes, proportions, color palette and 2D drawing style. It is NOT a scene reference. Do not reuse any background or objects from an unrelated workbook.
SOURCE-ONLY RULE: The following panel directions and source sentences are the complete content authority. Draw exactly the named subjects, actions and objects. If a short scene description conflicts with its source sentence, follow the source sentence. Do not substitute a generic classroom or stock image. Do not introduce a different time period, place, person, object, uniform, artwork or icon merely because it makes a prettier comic. If a sentence is abstract, show its central relationship with only the relevant subjects; keep the setting simple. Include both recurring mascots in the strip as small guides or observers, but they must not replace a real actor named in the passage.
LAYOUT: exact extra-wide 3:1 strip; EXACTLY ${groups.length} equal-width panels from left to right with clear vertical dividers, no extra frames and no unused margins. Keep the characters and scenes clear within each panel. Warm muted colors, clean dark outlines and simple, expressive animation. Every source sentence must be visibly represented in its assigned panel, in order.
${panelDirections.join("\n")}
No printed words, letters, numbers, captions, speech bubbles, labels, flags, logos or watermarks unless a specific visual element is necessary and explicitly present in the source. Do not add unrelated scenery.`;
}

async function generateImage(job, item) {
  // The Images edits endpoint requires multipart form data and a singular image field.
  const form = new FormData();
  form.set("model", imageModel());
  form.set("image", new Blob([mascotPng], { type: "image/png" }), "mascot_reference.png");
  form.set("prompt", imagePrompt(item));
  form.set("size", "2016x672");
  form.set("quality", "medium");
  form.set("output_format", "png");
  const response = await openai("images/edits", form, 300000);
  const encoded = response.data?.[0]?.b64_json;
  if (!encoded) throw Error("삽화 응답에 이미지가 없습니다.");
  const buffer = Buffer.from(encoded, "base64");
  if (buffer.length < 24 || buffer.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a") throw Error("PNG 형식을 확인할 수 없습니다.");
  const width = buffer.readUInt32BE(16), height = buffer.readUInt32BE(20);
  if (!height || Math.abs(width / height - 3) > 0.01) throw Error(`삽화가 3:1 가로 비율이 아닙니다 (${width}×${height}).`);
  if (!job.images.has(item.key)) { job.images.set(item.key, buffer); job.imagesDone++; }
}

function imageGroupsForParagraph(par, p) {
  return readingRanges(par.sentences.length).map(([start, end], g) => ({
    key: `p${p + 1}g${g + 1}`,
    sentences: par.sentences.slice(start, end).map(s => s.en),
    scenes: par.reading_scenes[g].panels,
  }));
}

function limiter(limit) {
  let active = 0;
  const waiting = [];
  return task => new Promise((resolve, reject) => {
    const begin = () => {
      active++;
      Promise.resolve().then(task).then(resolve, reject).finally(() => {
        active--;
        waiting.shift()?.();
      });
    };
    if (active < limit) begin(); else waiting.push(begin);
  });
}

async function runJob(job) {
  try {
    const source = job.source, results = job.results;
    const items = source.paragraphs.map((p, i) => ({ p, i })).filter(({ i }) => !results[i]);
    const scheduleImage = limiter(2), imagePromises = [];
    job.phase = "text";
    job.textErrors = [];
    job.imageErrors = [];
    job.imagesTotal = source.paragraphs.reduce((total, par) => total + readingRanges(par.sentences.length).length, 0);
    const scheduleMissingImages = (par, i) => {
      for (const item of imageGroupsForParagraph(par, i)) {
        if (!job.images.has(item.key)) imagePromises.push(scheduleImage(() => generateImage(job, item))
          .catch(e => { job.imageErrors.push(`${item.key}: ${e.message}`); }));
      }
    };
    results.forEach((par, i) => { if (par) scheduleMissingImages(par, i); });
    await parallel(items, 2, async ({ p, i }) => {
      const previous = source.mode !== "mock" && i ? source.paragraphs[i - 1].sentences.at(-1).en : "";
      let error;
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          results[i] = { ...await generateParagraph(p, i, previous, error?.message),
            ...(source.mode === "mock" ? { number: p.number } : {}), sourceIndex: i };
          job.textDone++;
          scheduleMissingImages(results[i], i);
          break;
        } catch (e) {
          error = e;
          // Transport/API retries already happened in openai(); only regenerate
          // model output when a local content or schema check failed.
          if (e.retryable !== undefined || attempt === 2) break;
          await delay(350 * (attempt + 1));
        }
      }
      if (!results[i]) {
        job.textErrors.push({ index: i, label: source.mode === "mock" ? `${p.number}번` : `${i + 1}문단`,
          message: error?.message || "알 수 없는 생성 오류" });
      }
    });
    const completed = results.filter(Boolean);
    job.draft = completed.length ? { title: source.title, mode: source.mode || "textbook", paragraphs: completed } : null;
    job.draftVersion++;
    job.phase = "images";
    await Promise.all(imagePromises);
    job.phase = job.textErrors.length || job.imageErrors.length ? "partial" : "complete";
  } catch (e) {
    job.phase = "failed";
    job.error = e.message || String(e);
  }
  job.updated = Date.now();
}

module.exports = app => {
  app.post("/api/workbook/jobs", (req, res) => {
    try {
      if (!process.env.OPENAI_API_KEY) throw Error("Render 환경변수에 OPENAI_API_KEY를 설정해 주세요.");
      if (["gpt-image-1-mini", "gpt-image-1", "gpt-image-1.5"].includes(imageModel())) {
        throw Error("가로 만화에는 3:1 출력 지원 이미지 모델이 필요합니다. OPENAI_IMAGE_MODEL 설정을 제거하거나 gpt-image-2.5-flare로 변경해 주세요.");
      }
      const body = req.body || {};
      const source = body.mode === "mock" ? parseMockInputs(body.title, body.passages)
        : Array.isArray(body.paragraphs) ? parseParagraphInputs(body.title, body.paragraphs)
          : parseSource(body.title, body.english, body.korean);
      if (jobs.size >= MAX_JOBS) {
        for (const [id, job] of jobs) if (job.phase !== "text" && job.phase !== "images" && Date.now() - job.updated > 30 * 60000) jobs.delete(id);
        if (jobs.size >= MAX_JOBS) throw Error("작업이 많습니다. 잠시 후 다시 시도해 주세요.");
      }
      const id = crypto.randomUUID();
      const job = { id, source, results: Array(source.paragraphs.length), phase: "text", textDone: 0,
        imagesDone: 0, imagesTotal: 0, draftVersion: 0, draft: null, images: new Map(),
        textErrors: [], imageErrors: [], error: "", updated: Date.now() };
      jobs.set(id, job);
      res.json({ id, paragraphs: source.paragraphs.length, sentences: source.paragraphs.reduce((n, p) => n + p.sentences.length, 0) });
      void runJob(job);
    } catch (e) { res.status(400).json({ error: e.message }); }
  });

  app.get("/api/workbook/jobs/:id", (req, res) => {
    const job = jobs.get(req.params.id);
    if (!job) return res.status(404).json({ error: "작업을 찾을 수 없습니다. 새로 생성해 주세요." });
    res.json({ id: job.id, phase: job.phase, draftVersion: job.draftVersion, textDone: job.textDone,
      textTotal: job.source.paragraphs.length, imagesDone: job.imagesDone,
      imagesTotal: job.imagesTotal, imageKeys: [...job.images.keys()],
      textErrors: job.textErrors, imageErrors: job.imageErrors, error: job.error, draft: job.draft });
  });

  app.get("/api/workbook/jobs/:id/images/:key", (req, res) => {
    const buffer = jobs.get(req.params.id)?.images.get(req.params.key);
    if (!buffer) return res.sendStatus(404);
    res.type("png").set("Cache-Control", "private, max-age=3600").send(buffer);
  });

  const retryFailed = (req, res) => {
    const job = jobs.get(req.params.id);
    if (!job || job.phase !== "partial") return res.status(400).json({ error: "재시도할 작업이 없습니다." });
    res.json({ remaining: job.textErrors.length + job.imagesTotal - job.imagesDone });
    void runJob(job);
  };
  app.post("/api/workbook/jobs/:id/retry", retryFailed);
  app.post("/api/workbook/jobs/:id/retry-images", retryFailed);
};

module.exports._test = { parallel, generateParagraph, runJob, imagePrompt };
