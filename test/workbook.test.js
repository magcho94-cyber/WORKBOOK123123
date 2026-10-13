"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), vm = require("node:vm"), path = require("node:path");
const { parseSource, parseParagraphInputs, parseMockInputs, readingRanges, readingPanelRanges, validateParagraph, matchOnce, repairBlanks, maskSentence, grammarSentence, orderBlocks } = require("../workbook_core");

test("all source sentences remain in order and numbers are removed", () => {
  const source = parseSource("Test", "# Introduction\n1. Dr. Lee studied the painting.\n2. She saved it.\n\n# Rescue\n3. The team came later.");
  assert.deepEqual(source.paragraphs.map(p => p.sentences.map(s => s.en)), [
    ["Dr. Lee studied the painting.", "She saved it."], ["The team came later."],
  ]);
  assert.deepEqual(source.paragraphs.map(p => p.heading), ["Introduction", "Rescue"]);
});

test("reading pages use three sentences, folding a short final remainder into four or five", () => {
  const context = vm.createContext({});
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../public/workbook.js"), "utf8"), context);
  for (let count = 1; count <= 90; count++) {
    const ranges = readingRanges(count);
    assert.equal(JSON.stringify(vm.runInContext(`wbRanges(${count})`, context)), JSON.stringify(ranges));
    assert.deepEqual(ranges.flatMap(([a, b]) => Array.from({ length: b - a }, (_, j) => a + j)),
      Array.from({ length: count }, (_, j) => j));
    if (count <= 2) assert.equal(ranges[0][1] - ranges[0][0], count);
    else {
      for (const [a, b] of ranges.slice(0, -1)) assert.equal(b - a, 3);
      assert.ok([3, 4, 5].includes(ranges.at(-1)[1] - ranges.at(-1)[0]));
    }
  }
  assert.deepEqual([4, 5, 6, 7, 8, 10, 11].map(n => readingRanges(n).map(([a, b]) => b - a)),
    [[4], [5], [3, 3], [3, 4], [3, 5], [3, 3, 4], [3, 3, 5]]);
});

test("three panels cover every sentence group, with no unrelated reference setting", () => {
  const { imagePrompt } = require("../workbook_routes")._test;
  const sentences = ["One.", "Two.", "Three.", "Four.", "Five."];
  const three = imagePrompt({ sentences: sentences.slice(0, 3), scenes: ["one", "two", "three"] });
  const five = imagePrompt({ sentences, scenes: ["one", "two and three", "four and five"] });
  assert.deepEqual(readingPanelRanges(4), [[0, 1], [1, 2], [2, 4]]);
  assert.deepEqual(readingPanelRanges(5), [[0, 1], [1, 3], [3, 5]]);
  assert.match(three, /EXACTLY 3 equal-width panels/);
  assert.match(three, /Panel 3 — source sentence 3: three/);
  assert.match(five, /EXACTLY 3 equal-width panels/);
  assert.match(five, /Panel 3 — source sentences 4 and 5: four and five/);
  assert.match(five, /Do not add unrelated scenery/);
  for (const [i, sentence] of sentences.entries()) assert.ok(five.includes(`[${i + 1}] ${sentence}`) || five.includes(sentence));
});

test("explicit fields keep one mock-exam passage together and allow separate paragraphs", () => {
  const single = parseParagraphInputs("Mock exam", [{
    english: "The first idea is clear.\n\nThe next idea follows.", korean: "첫 생각은 분명하다. 다음 생각이 이어진다.",
  }, { english: "", korean: "" }]);
  assert.equal(single.paragraphs.length, 1);
  assert.equal(single.paragraphs[0].sentences.length, 2);
  const multiple = parseParagraphInputs("Article", [
    { heading: "Opening", english: "They gathered to help. They protected art.", korean: "" },
    { heading: "The rescue", english: "They found the paintings. They carried them away.", korean: "그들은 그림을 발견했다. 그들은 그것을 옮겼다." },
  ]);
  assert.deepEqual(multiple.paragraphs.map(p => p.heading), ["Opening", "The rescue"]);
  assert.equal(multiple.paragraphs[0].sentences[0].ko, "");
  assert.equal(multiple.paragraphs[1].sentences.length, 2);
  assert.throws(() => parseParagraphInputs("", [{ english: "", korean: "해석만 있음." }]), /영어 본문/);
});

test("mock-exam 18–45 keeps only filled numbers, independently and in numeric order", () => {
  const source = parseMockInputs("Mock exam", [
    { number: 45, english: "The last passage finishes here." },
    { number: 18, english: "The first passage begins here. However, it changes direction.\n\nThen it ends." },
    { number: 19, english: "", korean: "" },
    { number: 31, english: "An additional passage appears here.", korean: "다른 지문이 여기에 나온다." },
  ]);
  assert.equal(source.mode, "mock");
  assert.deepEqual(source.paragraphs.map(p => p.number), [18, 31, 45]);
  assert.equal(source.paragraphs[0].sentences.length, 3);
  assert.throws(() => parseMockInputs("", [{ number: 21, korean: "해석만" }]), /21번에 영어 본문/);
  assert.throws(() => parseMockInputs("", [{ number: 18, english: "One." }, { number: 18, english: "Two." }]), /중복/);
  assert.throws(() => parseMockInputs("", [{ number: 46, english: "No." }]), /18~45/);
  assert.throws(() => parseMockInputs("", [{ number: 18, english: "" }]), /영어 본문/);
});

test("a lower-case model choice matches source capitalization without changing the source", () => {
  assert.equal(matchOnce("However, the result changed.", "however", "________"), "________, the result changed.");
  assert.deepEqual(repairBlanks("However, the result changed.", ["however", "missing"]), ["However", "changed"]);
  assert.deepEqual(repairBlanks("Sincerely,", ["sincerely", "other"]), ["Sincerely"]);
  const short = { en: "Sincerely,", blanks: ["Sincerely"], grammar_correct: "sincerely", grammar_wrong: "sincerity" };
  assert.equal(maskSentence(short), "________,");
  assert.equal(grammarSentence(short), "(Sincerely / sincerity),");
  const context = vm.createContext({ row: short });
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../public/workbook.js"), "utf8"), context);
  assert.equal(vm.runInContext("wbMask(row)", context), "________,");
  assert.equal(vm.runInContext("wbGrammar(row)", context), "(Sincerely / sincerity),");
});

test("sample draft covers every sentence with valid blanks and grammar", () => {
  const draft = require("./fixture.json");
  const par = draft.paragraphs[0];
  validateParagraph(par, par, 1);
  for (const row of par.sentences) {
    assert.equal((maskSentence(row).match(/________/g) || []).length, row.blanks.length);
    assert.ok(grammarSentence(row).includes(`(${row.grammar_correct} / ${row.grammar_wrong})`));
  }
  assert.equal(orderBlocks(draft.paragraphs).flatMap(x => x.sentences).length, par.sentences.length);
  const missing = JSON.parse(JSON.stringify(par));
  missing.reading_scenes[0].panels.pop();
  assert.throws(() => validateParagraph(missing, par, 1), /READING 컷 장면/);
});

test("web job returns a complete draft before the parallel reading images finish", async () => {
  const originalFetch = global.fetch, originalKey = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = "mock-key";
  const fixture = require("./fixture.json").paragraphs[0];
  const generated = {
    topic: fixture.topic, paragraph_title: fixture.paragraph_title,
    reading_captions: fixture.reading_captions, reading_scenes: fixture.reading_scenes,
    questions: fixture.questions, ox: fixture.ox,
    sentences: fixture.sentences.map(row => ({
      translation: row.ko, blanks: row.blanks,
      grammar_correct: row.grammar_correct, grammar_wrong: row.grammar_wrong,
      grammar_reason: row.grammar_reason, connection: row.connection,
    })),
  };
  const pngBytes = Buffer.alloc(24);
  Buffer.from("89504e470d0a1a0a", "hex").copy(pngBytes);
  pngBytes.writeUInt32BE(2016, 16);
  pngBytes.writeUInt32BE(672, 20);
  const png = pngBytes.toString("base64");
  let imagesStarted = 0;
  global.fetch = async (url, options) => {
    if (url.endsWith("/responses")) {
      const body = JSON.parse(options.body);
      const source = JSON.parse(body.input[1].content);
      assert.deepEqual(source.reading_pages[0].panel_sentence_numbers, [[1], [2], [3, 4]]);
      return { ok: true, json: async () => ({ status: "completed", output: [{ content: [{ type: "output_text", text: JSON.stringify(generated) }] }] }) };
    }
    assert.ok(url.endsWith("/images/edits"));
    const body = options.body;
    assert.ok(body instanceof FormData);
    assert.equal(body.get("size"), "2016x672");
    assert.equal(body.get("model"), "gpt-image-2.5-flare");
    assert.equal(body.get("image").type, "image/png");
    assert.ok(body.get("image").size > 1000);
    assert.match(body.get("prompt"), /EXACTLY 3 equal-width panels/);
    assert.match(body.get("prompt"), /source sentences 3 and 4/);
    assert.match(body.get("prompt"), /Professors, historians and architects/);
    assert.match(body.get("prompt"), /both recurring mascots/);
    imagesStarted++;
    await new Promise(resolve => setTimeout(resolve, 70));
    return { ok: true, json: async () => ({ data: [{ b64_json: png }] }) };
  };
  const routes = { post: {}, get: {} };
  const app = { post(path, fn) { routes.post[path] = fn; }, get(path, fn) { routes.get[path] = fn; } };
  const response = () => ({ status(code) { this.code = code; return this; }, json(value) { this.value = value; return this; } });
  try {
    require("../workbook_routes")(app);
    const started = response();
    routes.post["/api/workbook/jobs"]({ body: { title: "Sample", paragraphs: [{ english: fixture.sentences.map(x => x.en).join(" "), korean: "", heading: "" }] } }, started);
    assert.ok(started.value.id);
    const status = response(), id = started.value.id;
    for (let i = 0; i < 80; i++) {
      routes.get["/api/workbook/jobs/:id"]({ params: { id } }, status);
      if (status.value.draft && status.value.phase === "images") break;
      await new Promise(resolve => setTimeout(resolve, 5));
    }
    assert.equal(status.value.draft.paragraphs[0].sentences.length, fixture.sentences.length);
    assert.deepEqual(status.value.draft.paragraphs[0].reading_captions, fixture.reading_captions);
    assert.deepEqual(status.value.draft.paragraphs[0].reading_scenes, fixture.reading_scenes);
    assert.equal(status.value.imagesTotal, 1);
    assert.equal(status.value.phase, "images");
    for (let i = 0; i < 80 && status.value.phase !== "complete"; i++) {
      await new Promise(resolve => setTimeout(resolve, 5));
      routes.get["/api/workbook/jobs/:id"]({ params: { id } }, status);
    }
    assert.equal(status.value.phase, "complete");
    assert.equal(status.value.imagesDone, 1);
    assert.equal(imagesStarted, 1);
  } finally {
    global.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = originalKey;
  }
});

test("a failed mock number does not discard another number and retry fills only the missing item", async () => {
  const originalFetch = global.fetch, originalKey = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = "mock-key";
  const fixture = require("./fixture.json").paragraphs[0];
  const english = fixture.sentences.map(x => x.en).join(" ");
  const source = parseMockInputs("October", [
    { number: 18, english }, { number: 19, english: "" }, { number: 45, english },
  ]);
  const valid = {
    topic: fixture.topic, paragraph_title: fixture.paragraph_title,
    reading_captions: fixture.reading_captions, reading_scenes: fixture.reading_scenes,
    questions: fixture.questions, ox: fixture.ox,
    sentences: fixture.sentences.map(row => ({
      translation: row.ko, blanks: row.blanks,
      grammar_correct: row.grammar_correct, grammar_wrong: row.grammar_wrong,
      grammar_reason: row.grammar_reason, connection: row.connection,
    })),
  };
  const pngBytes = Buffer.alloc(24);
  Buffer.from("89504e470d0a1a0a", "hex").copy(pngBytes);
  pngBytes.writeUInt32BE(2016, 16); pngBytes.writeUInt32BE(672, 20);
  let fail18 = true, calls18 = 0, calls45 = 0, imageCalls = 0;
  global.fetch = async (url, options) => {
    if (url.endsWith("/responses")) {
      const input = JSON.parse(JSON.parse(options.body).input[1].content);
      assert.equal(input.previous_sentence, "");
      if (input.number === 18) calls18++; else if (input.number === 45) calls45++;
      const generated = JSON.parse(JSON.stringify(valid));
      if (input.number === 18 && fail18) generated.sentences[0].grammar_correct = "nonexistent";
      return { ok: true, json: async () => ({ status: "completed", output: [{ content: [{ type: "output_text", text: JSON.stringify(generated) }] }] }) };
    }
    assert.ok(url.endsWith("/images/edits"));
    assert.ok(options.body instanceof FormData);
    imageCalls++;
    return { ok: true, json: async () => ({ data: [{ b64_json: pngBytes.toString("base64") }] }) };
  };
  const job = { source, results: Array(2), phase: "text", textDone: 0, imagesDone: 0,
    imagesTotal: 0, draftVersion: 0, draft: null, images: new Map(), textErrors: [], imageErrors: [], error: "" };
  try {
    const { runJob } = require("../workbook_routes")._test;
    await runJob(job);
    assert.equal(job.phase, "partial");
    assert.deepEqual(job.draft.paragraphs.map(x => x.number), [45]);
    assert.deepEqual(job.textErrors.map(x => x.label), ["18번"]);
    assert.deepEqual([...job.images.keys()], ["p2g1"]);
    assert.equal(calls18, 3);
    assert.equal(calls45, 1);
    fail18 = false;
    await runJob(job);
    assert.equal(job.phase, "complete");
    assert.deepEqual(job.draft.paragraphs.map(x => x.number), [18, 45]);
    assert.deepEqual([...job.images.keys()].sort(), ["p1g1", "p2g1"]);
    assert.equal(calls18, 4);
    assert.equal(calls45, 1);
    assert.equal(imageCalls, 2);
    assert.equal(job.textDone, 2);
    assert.equal(job.draftVersion, 2);
  } finally {
    global.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = originalKey;
  }
});

test("printed student pages cover all steps; image slots exist only in READING", () => {
  const draft = require("./fixture.json");
  const context = vm.createContext({});
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../public/workbook.js"), "utf8"), context);
  context.draft = draft;
  const html = vm.runInContext("workbookDraft = draft; wbStudent(draft)", context);
  assert.equal((html.match(/class="wbReadingRow"/g) || []).length, draft.paragraphs[0].sentences.length);
  assert.equal((html.match(/class="wbIllustration hidden"/g) || []).length, 1);
  assert.equal((html.match(/class="wbTopicField"/g) || []).length, 2);
  assert.ok(html.includes("wbReadingFinal wbReadingFour"));
  assert.ok(html.includes("style=\"--wb-panels:3\""));
  assert.ok(html.includes("3컷 삽화 생성 중"));
  assert.ok(html.includes("class=\"wbPanelLines\" aria-hidden=\"true\"><i></i><i></i><i></i>"));
  assert.ok(!html.includes("READING · 2/2"));
  assert.ok(!html.includes("Paragraph 1"));
  assert.ok(html.includes("주제 (Topic)"));
  assert.ok(html.includes("제목 (Title)"));
  assert.ok(html.includes("wbReadingNum\">04"));
  assert.ok(html.includes(draft.paragraphs[0].reading_captions[0]));
  assert.equal((html.match(/class="wbSection">STEP/g) || []).length > 0, true);
  for (const name of ["STEP 1", "STEP 2", "STEP 3", "STEP 4", "STEP 5"]) assert.ok(html.includes(name));
  const reading = html.slice(0, html.indexOf("STEP 1"));
  assert.equal((reading.match(/class="wbIllustration hidden"/g) || []).length, 1);
  assert.equal((reading.match(/class="wbReadingBridge"/g) || []).length, 3);
  assert.ok(reading.includes(draft.paragraphs[0].sentences[1].connection));
  const step1 = html.slice(html.indexOf("STEP 1"), html.indexOf("STEP 2"));
  assert.ok(step1.includes("논리 관계"));
  assert.ok(!step1.includes(draft.paragraphs[0].sentences[1].connection));
  assert.equal((html.slice(html.indexOf("STEP 1")).match(/class="wbIllustration hidden"/g) || []).length, 0);
  const teacher = vm.runInContext("wbTeacher(draft)", context);
  assert.ok(teacher.includes("연결:"));
  assert.ok(teacher.includes("STEP 5"));
  assert.ok(!teacher.includes("STEP 2:"));
  const steps = [1, 2, 3, 4, 5].map(n => teacher.indexOf(`교사용 · STEP ${n}`));
  assert.ok(steps.every((at, i) => at >= 0 && (!i || steps[i - 1] < at)));
  assert.ok(!teacher.includes("Paragraph 1"));
});

test("each paragraph ends with its own full-width topic and title lines", () => {
  const first = require("./fixture.json").paragraphs[0];
  const second = JSON.parse(JSON.stringify(first));
  second.sentences = second.sentences.slice(0, 3);
  second.sentences[0].connection = "앞 문단에서 소개한 활동의 다음 단계를 설명한다.";
  second.reading_captions = ["두 번째 문단의 그림 설명이다."];
  second.reading_scenes = [{ panels: ["첫 장면", "둘째 장면", "셋째 장면"] }];
  const draft = { title: "Two paragraphs", paragraphs: [first, second] };
  const context = vm.createContext({});
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../public/workbook.js"), "utf8"), context);
  context.draft = draft;
  const html = vm.runInContext("workbookDraft = draft; wbStudent(draft)", context);
  const reading = html.slice(0, html.indexOf("STEP 1"));
  assert.equal((reading.match(/class="wbReadingTopics"/g) || []).length, 2);
  assert.equal((reading.match(/class="wbTopicField"/g) || []).length, 4);
  assert.equal((reading.match(/class="wbImageBox"/g) || []).length, 2);
  assert.equal((reading.match(/class="wbReadingRow"/g) || []).length, 7);
  assert.ok(reading.includes("READING · Paragraph 1"));
  assert.ok(reading.includes("READING · Paragraph 2"));
  assert.ok(reading.includes("이전 문단 → 문장 5"));
  assert.ok(reading.includes("style=\"--wb-panels:3\""));
  const teacher = vm.runInContext("wbTeacher(draft)", context);
  assert.ok(teacher.lastIndexOf("교사용 · STEP 1") < teacher.indexOf("교사용 · STEP 2"));
  assert.ok(teacher.lastIndexOf("교사용 · STEP 2") < teacher.indexOf("교사용 · STEP 3"));
  const css = fs.readFileSync(path.join(__dirname, "../public/style.css"), "utf8");
  assert.match(css, /\.wbReadingPage \.wbImageBox\{[^}]*aspect-ratio:3\/1/);
  assert.match(css, /grid-template-columns:repeat\(var\(--wb-panels\),1fr\)/);
  assert.match(css, /\.wbReadingPage \.wbReadingTopics\{display:block/);
});

test("two nonadjacent mock passages render as separate numbered workbooks with correct image keys", () => {
  const first = JSON.parse(JSON.stringify(require("./fixture.json").paragraphs[0]));
  const last = JSON.parse(JSON.stringify(first));
  const draft = { title: "October mock", mode: "mock", paragraphs: [
    { ...first, number: 18, sourceIndex: 0 }, { ...last, number: 45, sourceIndex: 1 },
  ] };
  const context = vm.createContext({ draft });
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../public/workbook.js"), "utf8"), context);
  const html = vm.runInContext("workbookDraft = draft; wbStudent(draft)", context);
  const teacher = vm.runInContext("wbTeacher(draft)", context);
  assert.match(html, /18번 · READING/);
  assert.match(html, /45번 · READING/);
  assert.match(html, /data-wb-image="p1g1"/);
  assert.match(html, /data-wb-image="p2g1"/);
  assert.ok(!html.includes("Paragraph 1") && !html.includes("Paragraph 2"));
  assert.equal((html.match(/class="wbSection">18번 · STEP 1/g) || []).length > 0, true);
  assert.equal((html.match(/class="wbSection">45번 · STEP 5/g) || []).length, 1);
  assert.match(teacher, /18번 · 교사용 · STEP 1/);
  assert.match(teacher, /45번 · 교사용 · STEP 5/);
  assert.equal((html.match(/class="wbReadingTopics"/g) || []).length, 2);
});

test("five sentences remain on one page and three panels cover them", () => {
  const draft = JSON.parse(JSON.stringify(require("./fixture.json")));
  draft.paragraphs[0].sentences.push({ ...draft.paragraphs[0].sentences[0],
    en: "The team then shared its findings with the public.", ko: "그 후 팀은 발견한 내용을 대중과 공유했다." });
  const context = vm.createContext({ draft });
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../public/workbook.js"), "utf8"), context);
  const html = vm.runInContext("workbookDraft = draft; wbStudent(draft)", context);
  const reading = html.slice(0, html.indexOf("STEP 1"));
  assert.equal((reading.match(/class="wbReadingRow"/g) || []).length, 5);
  assert.equal((reading.match(/class="wbImageBox"/g) || []).length, 1);
  assert.ok(reading.includes("wbReadingFinal wbReadingFive"));
  assert.ok(reading.includes("style=\"--wb-panels:3\""));
});

test("each ordering question keeps all prompts and its answer space on one page", () => {
  const draft = JSON.parse(JSON.stringify(require("./fixture.json")));
  draft.paragraphs[0].sentences = Array.from({ length: 24 }, (_, i) => ({ ...draft.paragraphs[0].sentences[i % 4],
    en: `Sentence ${i + 1} develops the account of a group of experts who protected priceless cultural objects during the war.` }));
  const context = vm.createContext({ draft });
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../public/workbook.js"), "utf8"), context);
  const html = vm.runInContext("workbookDraft = draft; wbStudent(draft)", context);
  const orderPages = [...html.matchAll(/<section class="wbPage wbStudent wbOrderPage">([\s\S]*?)<\/section>/g)].map(match => match[1]);
  const step4 = orderPages.filter(page => page.includes("STEP 4 · 문단 나열"));
  const step5 = orderPages.filter(page => page.includes("STEP 5 · 문장 나열"));
  assert.ok(step4.length >= 1 && step5.length >= 2);
  for (const page of orderPages) {
    assert.equal((page.match(/class="wbAnswerBox"/g) || []).length, 1);
    assert.ok((page.match(/class="wbOrderBlock"/g) || []).length >= 2);
  }
  assert.equal(step5.reduce((n, page) => n + (page.match(/class="wbOrderBlock"/g) || []).length, 0), 24);
  const teacher = vm.runInContext("wbTeacher(draft)", context);
  assert.equal((teacher.match(/교사용 · STEP 4/g) || []).length, 1);
  assert.equal((teacher.match(/교사용 · STEP 5/g) || []).length, 1);
});

test("a typical ten-sentence passage becomes one complete sentence-order question", () => {
  const draft = JSON.parse(JSON.stringify(require("./fixture.json")));
  draft.paragraphs[0].sentences = Array.from({ length: 10 }, (_, i) => ({ ...draft.paragraphs[0].sentences[i % 4],
    en: `Sentence ${i + 1} explains how people recovered valuable works of art during the war.` }));
  const context = vm.createContext({ draft });
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../public/workbook.js"), "utf8"), context);
  const questions = vm.runInContext("wbStep5Questions(draft.paragraphs)", context);
  assert.equal(questions.length, 1);
  assert.equal(questions[0].blocks.length, 10);
});

test("the input screen provides a paragraph list and add button", () => {
  const html = fs.readFileSync(path.join(__dirname, "../public/index.html"), "utf8");
  const script = fs.readFileSync(path.join(__dirname, "../public/workbook.js"), "utf8");
  assert.match(html, /id="wbParagraphs"/);
  assert.match(html, /onclick="addWorkbookParagraph\(\)"/);
  assert.match(html, /id="wbMockInputs"/);
  assert.match(html, /id="wbMockSlots"/);
  assert.match(script, /number = 18; number <= 45/);
  assert.doesNotMatch(html, /id="wbEnglish"/);
  assert.match(script, /if \(typeof document !== "undefined"\) \{\s*addWorkbookParagraph\(\);\s*addWorkbookParagraph\(\);/);
});

test("the mock form submits only numbered passages with English text", () => {
  const context = vm.createContext({});
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../public/workbook.js"), "utf8"), context);
  const card = (number, english, korean) => ({ dataset: { number: String(number) }, querySelector(selector) {
    return { value: selector === ".wbEnglish" ? english : korean };
  } });
  context.document = { querySelectorAll() { return [card(18, " First. ", ""), card(19, "", ""), card(45, "Last.", "마지막.")]; } };
  const result = vm.runInContext("wbCollectMockPassages()", context);
  assert.equal(JSON.stringify(result), JSON.stringify([
    { number: 18, english: "First.", korean: "" }, { number: 45, english: "Last.", korean: "마지막." },
  ]));
  context.document = { querySelectorAll() { return [card(25, "", "해석만")]; } };
  assert.throws(() => vm.runInContext("wbCollectMockPassages()", context), /25번에 영어 본문/);
});

test("the mock input mode actually creates all 28 numbered fields", () => {
  const context = vm.createContext({});
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../public/workbook.js"), "utf8"), context);
  const slots = [];
  context.document = {
    createElement() { return { dataset: {}, className: "", innerHTML: "", open: false }; },
    getElementById() { return { append(card) { slots.push(card); } }; },
  };
  vm.runInContext("addWorkbookMockSlots()", context);
  assert.equal(slots.length, 28);
  assert.deepEqual(slots.map(x => Number(x.dataset.number)), Array.from({ length: 28 }, (_, i) => i + 18));
  assert.equal(slots[0].open, true);
  assert.equal(slots.at(-1).open, false);
});

test("one passage with no supplied heading does not reveal the generated title", () => {
  const draft = JSON.parse(JSON.stringify(require("./fixture.json")));
  draft.paragraphs[0].heading = "";
  const context = vm.createContext({ draft });
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../public/workbook.js"), "utf8"), context);
  const html = vm.runInContext("workbookDraft = draft; wbStudent(draft)", context);
  const reading = html.slice(0, html.indexOf("STEP 1"));
  assert.ok(!reading.includes("Paragraph 1"));
  assert.ok(!reading.includes(draft.paragraphs[0].paragraph_title));
  assert.ok(reading.includes("주제 (Topic)"));
});

test("the form sends only filled paragraph fields in their displayed order", () => {
  const context = vm.createContext({});
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../public/workbook.js"), "utf8"), context);
  const card = (heading, english, korean) => ({ querySelector(selector) {
    return { value: ({ ".wbHeading": heading, ".wbEnglish": english, ".wbKorean": korean })[selector] };
  } });
  context.document = { querySelectorAll() { return [
    card("", "The whole passage goes here. It ends here.", ""), card("", "", ""),
  ]; } };
  const entries = vm.runInContext("wbCollectParagraphs()", context);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].english, "The whole passage goes here. It ends here.");
});
