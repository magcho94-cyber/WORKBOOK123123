"use strict";

function normalize(text) {
  return String(text || "").replace(/\r/g, "").replace(/[ \t]+/g, " ").trim();
}

function blocks(text) {
  return normalize(text).split(/\n\s*\n+/).map(s => s.trim()).filter(Boolean);
}

function sentences(text, locale) {
  const source = normalize(text).replace(/(^|\n)\s*(?:\*\*)?\d+[.)](?:\*\*)?\s*/g, "$1").replace(/\n+/g, " ");
  const parts = [...new Intl.Segmenter(locale, { granularity: "sentence" }).segment(source)]
    .map(item => item.segment.trim()).filter(Boolean);
  const merged = [];
  for (const part of parts) {
    if (merged.length && /(?:\b(?:Mr|Mrs|Ms|Dr|Prof|St|e\.g|i\.e)\.)$/i.test(merged.at(-1))) merged[merged.length - 1] += " " + part;
    else merged.push(part);
  }
  return merged;
}

function parseSource(title, english, korean = "") {
  const enBlocks = blocks(english), koBlocks = blocks(korean);
  if (!enBlocks.length) throw Error("영어 지문을 입력해 주세요.");
  if (koBlocks.length && enBlocks.length !== koBlocks.length) {
    throw Error(`영어 ${enBlocks.length}문단과 해석 ${koBlocks.length}문단이 일치하지 않습니다.`);
  }
  const paragraphs = enBlocks.map((block, i) => {
    const lines = block.split("\n");
    const heading = /^#\s+/.test(lines[0]) ? lines.shift().replace(/^#\s+/, "").trim() : "";
    const en = sentences(lines.join("\n"), "en");
    if (!en.length) throw Error(`Paragraph ${i + 1}에 문장이 없습니다.`);
    let ko = [];
    if (koBlocks.length) {
      const kLines = koBlocks[i].split("\n");
      if (/^#\s+/.test(kLines[0])) kLines.shift();
      ko = sentences(kLines.join("\n"), "ko");
      if (ko.length !== en.length) {
        throw Error(`Paragraph ${i + 1}: 영어 ${en.length}문장, 해석 ${ko.length}문장입니다. 해석을 문장별로 정리하거나 빈칸으로 두세요.`);
      }
    }
    return { heading, sentences: en.map((sentence, j) => ({ en: sentence, ko: ko[j] || "" })) };
  });
  const total = paragraphs.reduce((n, p) => n + p.sentences.length, 0);
  if (total > 90) throw Error("한 번에 90문장 이하로 나누어 생성해 주세요.");
  return { title: String(title || "").trim() || "English Reading Workbook", paragraphs };
}

// A field is an explicit paragraph. Blank lines within its text are just spacing,
// which lets a single mock-exam passage stay one unit even after PDF paste.
function parseParagraphInputs(title, entries) {
  if (!Array.isArray(entries) || !entries.length) throw Error("영어 지문을 입력해 주세요.");
  const paragraphs = [];
  entries.forEach((item, index) => {
    const english = String(item?.english || "").trim();
    const korean = String(item?.korean || "").trim();
    const suppliedHeading = String(item?.heading || "").trim();
    if (!english) {
      if (korean || suppliedHeading) throw Error(`${index + 1}문단에 영어 본문이 없습니다.`);
      return;
    }
    const enLines = english.split("\n");
    const inlineHeading = /^#\s+/.test(enLines[0]) ? enLines.shift().replace(/^#\s+/, "").trim() : "";
    const heading = suppliedHeading || inlineHeading;
    const en = sentences(enLines.join("\n"), "en");
    if (!en.length) throw Error(`${index + 1}문단에 문장이 없습니다.`);
    let ko = [];
    if (korean) {
      const koLines = korean.split("\n");
      if (/^#\s+/.test(koLines[0])) koLines.shift();
      ko = sentences(koLines.join("\n"), "ko");
      if (ko.length !== en.length) throw Error(`${index + 1}문단: 영어 ${en.length}문장, 해석 ${ko.length}문장입니다. 해석을 문장별로 정리하거나 비워 주세요.`);
    }
    paragraphs.push({ heading, sentences: en.map((sentence, j) => ({ en: sentence, ko: ko[j] || "" })) });
  });
  if (!paragraphs.length) throw Error("영어 지문을 입력해 주세요.");
  const total = paragraphs.reduce((n, p) => n + p.sentences.length, 0);
  if (total > 90) throw Error("한 번에 90문장 이하로 나누어 생성해 주세요.");
  return { title: String(title || "").trim() || "English Reading Workbook", paragraphs };
}

// Each mock-exam number is a separate passage; blank numbered fields are omitted.
function parseMockInputs(title, entries) {
  if (!Array.isArray(entries)) throw Error("모의고사 18~45번 중 영어 본문을 입력해 주세요.");
  const seen = new Set(), paragraphs = [];
  for (const item of entries) {
    const number = Number(item?.number);
    if (!Number.isInteger(number) || number < 18 || number > 45) throw Error("모의고사 번호는 18~45번이어야 합니다.");
    if (seen.has(number)) throw Error(`${number}번이 중복 입력되었습니다.`);
    seen.add(number);
    const english = String(item?.english || "").trim(), korean = String(item?.korean || "").trim();
    if (!english) {
      if (korean) throw Error(`${number}번에 영어 본문이 없습니다.`);
      continue;
    }
    let parsed;
    try { parsed = parseParagraphInputs(title, [{ english, korean }]); }
    catch (error) { throw Error(`${number}번: ${error.message}`); }
    paragraphs.push({ ...parsed.paragraphs[0], number });
  }
  if (!paragraphs.length) throw Error("모의고사 18~45번 중 영어 본문을 입력해 주세요.");
  paragraphs.sort((a, b) => a.number - b.number);
  return { title: String(title || "").trim() || "English Reading Workbook", mode: "mock", paragraphs };
}

function readingRanges(count) {
  if (!Number.isInteger(count) || count < 1) throw Error("문장이 필요합니다.");
  const sizes = [];
  for (let left = count; left > 5; left -= 3) sizes.push(3);
  sizes.push(count - sizes.length * 3);
  let start = 0;
  return sizes.map(size => { const item = [start, start + size]; start += size; return item; });
}

function readingPanelRanges(count) {
  if (!Number.isInteger(count) || count < 1 || count > 5) throw Error("READING 페이지는 1~5문장이어야 합니다.");
  if (count <= 3) return Array.from({ length: count }, (_, i) => [i, i + 1]);
  return count === 4 ? [[0, 1], [1, 2], [2, 4]] : [[0, 1], [1, 3], [3, 5]];
}

function matchOnce(sentence, value, replacement) {
  if (!value || typeof value !== "string") throw Error("원문의 선택 표현이 비어 있습니다.");
  // The model may return "however" for the source's "However". Match the
  // source case-insensitively, then render the exact spelling from the source.
  const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const matcher = new RegExp(escaped, "giu");
  for (const found of sentence.matchAll(matcher)) {
    const at = found.index, original = found[0];
    const before = sentence.slice(0, at), after = sentence.slice(at + original.length);
    // Prevent matching the middle of a word (including a contraction).
    if (!/\p{L}$/u.test(before) && !/^\p{L}/u.test(after)) {
      return before + (typeof replacement === "function" ? replacement(original) : replacement) + after;
    }
  }
  throw Error(`원문에서 독립된 표현 ${JSON.stringify(value)}을 찾지 못했습니다.`);
}

function availableWords(sentence) {
  const seen = new Set();
  return [...sentence.matchAll(/[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu)]
    .map(found => found[0]).filter(word => {
      const key = word.toLocaleLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function repairBlanks(sentence, suggestions) {
  const words = availableWords(sentence), picked = [];
  const target = Math.min(words.length, Math.max(2, Math.min(3, Array.isArray(suggestions) ? suggestions.length : 2)));
  for (const choice of Array.isArray(suggestions) ? suggestions : []) {
    if (typeof choice !== "string" || /\s/.test(choice)) continue;
    const word = words.find(x => x.toLocaleLowerCase() === choice.toLocaleLowerCase());
    if (word && !picked.some(x => x.toLocaleLowerCase() === word.toLocaleLowerCase())) picked.push(word);
    if (picked.length === target) return picked;
  }
  for (const word of [...words].sort((a, b) => b.length - a.length)) {
    if (!picked.some(x => x.toLocaleLowerCase() === word.toLocaleLowerCase())) picked.push(word);
    if (picked.length === target) break;
  }
  return picked;
}

function validateParagraph(par, source, number) {
  const label = `Paragraph ${number}`;
  if (!Array.isArray(par.sentences) || par.sentences.length !== source.sentences.length) {
    throw Error(`${label}: 문장 수가 원문과 다릅니다.`);
  }
  for (let i = 0; i < par.sentences.length; i++) {
    const row = par.sentences[i], en = source.sentences[i].en;
    if (row.en !== en || !String(row.ko || "").trim()) throw Error(`${label} 문장 ${i + 1}: 원문 또는 해석을 확인하세요.`);
    const required = Math.min(2, availableWords(en).length);
    if (!Array.isArray(row.blanks) || row.blanks.length < required || row.blanks.length > 3 ||
        new Set(row.blanks.map(x => String(x).toLocaleLowerCase())).size !== row.blanks.length) {
      throw Error(`${label} 문장 ${i + 1}: 서로 다른 원문 빈칸 단어가 필요합니다.`);
    }
    let masked = en;
    for (const word of row.blanks) {
      if (typeof word !== "string" || /\s/.test(word)) throw Error(`${label} 문장 ${i + 1}: 빈칸은 단일 단어여야 합니다.`);
      masked = matchOnce(masked, word, "________");
    }
    if (!row.grammar_correct || !row.grammar_wrong || row.grammar_correct === row.grammar_wrong || !row.grammar_reason) {
      throw Error(`${label} 문장 ${i + 1}: 어법 선택 및 근거를 확인하세요.`);
    }
    matchOnce(en, row.grammar_correct, "____");
    if ((i > 0 || number > 1) && !String(row.connection || "").trim()) throw Error(`${label} 문장 ${i + 1}: 앞 문장과의 논리 관계가 빠졌습니다.`);
  }
  if (!par.topic || !par.paragraph_title || !Array.isArray(par.questions) || !par.questions.length || !Array.isArray(par.ox) || !par.ox.length) {
    throw Error(`${label}: 주제·제목·내용 문항을 확인하세요.`);
  }
  if (!Array.isArray(par.reading_captions) || par.reading_captions.length !== readingRanges(par.sentences.length).length || par.reading_captions.some(x => !String(x).trim())) {
    throw Error(`${label}: READING 페이지별 그림 설명을 확인하세요.`);
  }
  const pages = readingRanges(par.sentences.length);
  if (!Array.isArray(par.reading_scenes) || par.reading_scenes.length !== pages.length ||
      par.reading_scenes.some((page, i) => !Array.isArray(page.panels) ||
        page.panels.length !== readingPanelRanges(pages[i][1] - pages[i][0]).length ||
        page.panels.some(scene => typeof scene !== "string" || !scene.trim()))) {
    throw Error(`${label}: 문장별 근거에 맞춘 READING 컷 장면을 확인하세요.`);
  }
  for (const q of par.questions) if (!q.question || !q.answer) throw Error(`${label}: 내용 확인 문제에 답이 없습니다.`);
  for (const q of par.ox) if (!q.statement || !["O", "X"].includes(q.answer) || !q.reason) throw Error(`${label}: O/X 문제를 확인하세요.`);
  if (new Set(par.ox.map(q => q.answer)).size !== 2) throw Error(`${label}: O와 X가 모두 필요합니다.`);
}

function maskSentence(row) {
  return row.blanks.reduce((text, word) => matchOnce(text, word, "________"), row.en);
}

function grammarSentence(row) {
  return matchOnce(row.en, row.grammar_correct, original => `(${original} / ${row.grammar_wrong})`);
}

function shuffled(length, seed) {
  const order = Array.from({ length }, (_, i) => i);
  let x = (seed || 1) >>> 0;
  for (let i = length - 1; i > 0; i--) {
    x ^= x << 13; x ^= x >>> 17; x ^= x << 5;
    const j = (x >>> 0) % (i + 1);
    [order[i], order[j]] = [order[j], order[i]];
  }
  if (length > 1 && order.every((v, i) => v === i)) order.push(order.shift());
  return order;
}

function orderBlocks(paragraphs) {
  if (paragraphs.length > 1) return paragraphs.map((p, i) => ({ index: i, sentences: p.sentences.map(s => s.en) }));
  const rows = paragraphs[0].sentences;
  if (rows.length < 2) return [{ index: 0, sentences: rows.map(s => s.en) }];
  const count = Math.min(3, rows.length);
  return Array.from({ length: count }, (_, i) => ({
    index: i,
    sentences: rows.slice(Math.floor(i * rows.length / count), Math.floor((i + 1) * rows.length / count)).map(s => s.en),
  }));
}

module.exports = { parseSource, parseParagraphInputs, parseMockInputs, readingRanges, readingPanelRanges, matchOnce, repairBlanks, validateParagraph, maskSentence, grammarSentence, shuffled, orderBlocks };
