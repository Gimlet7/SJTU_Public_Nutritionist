const fs = require("fs");
const path = require("path");

// Adjust these paths when the repository layout changes.
const root = path.resolve(__dirname, "..");
const inputDir = path.join(root, "data", "source");
const outputDir = path.join(root, "data");
const reviewDir = path.join(outputDir, "review");
const files = ["Exercises_A.json", "Exercises_B.json", "Exercises_C.json", "Exercises_D.json"];
const letterPattern = "[A-E]";

function cleanText(value) {
  return String(value ?? "")
    .replace(/\r/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function reflowText(value) {
  return cleanText(value)
    .replace(/\s*\n\s*/g, " ")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\[\s*(?:单选题|多选题)\s*\]\s*/g, "")
    .replace(/[（(]\s*[）)]/g, "（ ）")
    .trim();
}

function normalizeForCompare(value) {
  return cleanText(value)
    .replace(/[\s，。！？?；;：:（）()【】\[\]、.．]/g, "")
    .toLowerCase();
}

function parseLetters(value) {
  const found = String(value ?? "").toUpperCase().match(/[A-E]/g) || [];
  return [...new Set(found)];
}

function extractEmbeddedAnswer(stem) {
  const match = String(stem).match(/答案\s*[：:]\s*([A-E]{1,5})\b/i);
  return match ? parseLetters(match[1]) : [];
}

function extractInlineAnswer(stem) {
  const text = String(stem);
  const match = text.match(/[（(]\s*([A-E](?:\s*[A-E]){0,4})\s*[）)]/) || text.match(/[）)]\s*([A-E]{1,5})(?=\s|$)/);
  return match ? parseLetters(match[1]) : [];
}

function extractExplanation(stem) {
  const match = String(stem).match(/解析\s*[：:][\s\S]*$/i);
  return match ? cleanText(match[0].replace(/^解析\s*[：:]\s*/i, "")) : null;
}

function stripEmbeddedTail(stem) {
  return cleanText(String(stem).replace(/\s*(?:答案|解析)\s*[：:][\s\S]*$/i, ""));
}

function parseInlineOptions(stem) {
  const text = String(stem).replace(/\r/g, "");
  const marker = new RegExp(`(?:^|\\n|\\r|[ \\t]{2,})([A-E])(?:[.．、:：）)]|[ \\t]+)`, "g");
  const matches = [...text.matchAll(marker)];
  if (matches.length < 2) return { stem: stripEmbeddedTail(text), options: {} };

  const first = matches[0].index + matches[0][0].length;
  const parsed = {};
  for (let i = 0; i < matches.length; i += 1) {
    const key = matches[i][1];
    const start = matches[i].index + matches[i][0].length;
    const end = i + 1 < matches.length ? matches[i + 1].index : text.length;
    const content = cleanText(text.slice(start, end).replace(/(?:答案|解析)\s*[：:][\s\S]*$/i, ""));
    if (content) parsed[key] = content;
  }
  return { stem: stripEmbeddedTail(text.slice(0, matches[0].index)), options: parsed };
}

function parseOptions(rawStem, rawOptions) {
  const objectOptions = rawOptions && typeof rawOptions === "object" ? rawOptions : {};
  const validObjectOptions = {};
  for (const [key, value] of Object.entries(objectOptions)) {
    if (/^[A-E]$/.test(key) && cleanText(value)) validObjectOptions[key] = cleanText(value);
  }
  const inline = parseInlineOptions(rawStem);
  if (Object.keys(validObjectOptions).length >= 4) {
    return {
      stem: stripEmbeddedTail(rawStem),
      options: Object.fromEntries(Object.entries(validObjectOptions).map(([key, value]) => [key, cleanText(value.replace(/\s*(?:答案|解析)\s*[：:][\s\S]*$/i, ""))])),
    };
  }
  if (Object.keys(inline.options).length >= 2) return inline;
  const reconstructed = Object.entries(validObjectOptions).map(([key, value]) => `${key}.${value}`).join("\n");
  const repaired = parseInlineOptions(reconstructed);
  return { stem: stripEmbeddedTail(rawStem), options: Object.keys(repaired.options).length > Object.keys(validObjectOptions).length ? repaired.options : validObjectOptions };
}

function qualityIssues(question) {
  const issues = [];
  const keys = Object.keys(question.options);
  const answers = question.answers;
  if (!question.stem) issues.push("missing_stem");
  if (keys.length < 4) issues.push("incomplete_options");
  if (keys.some((key, index) => key !== String.fromCharCode(65 + index))) issues.push("non_contiguous_options");
  if (!answers.length) issues.push("missing_answer");
  if (answers.some((answer) => !keys.includes(answer))) issues.push("answer_not_in_options");
  if (question.type === "single" && answers.length !== 1) issues.push("single_answer_count_error");
  if (question.type === "multiple" && answers.length < 1) issues.push("multiple_answer_count_error");
  if (/答案\s*[：:]/i.test(question.rawStem) && question.answerSource === "source") issues.push("embedded_answer_present");
  if (question.sharedStem) issues.push("shared_stem_needs_review");
  if (question.reviewStatus !== "已核对") issues.push("source_not_reviewed");
  return [...new Set(issues)];
}

function buildQuestion(file, item, sourceIndex) {
  const bank = path.basename(file, ".json").replace("Exercises_", "");
  const rawStem = String(item["题干"] ?? "");
  const rawOptionText = Object.values(item["选项"] || {}).join("\n");
  const rawContent = `${rawStem}\n${rawOptionText}`;
  const embeddedAnswers = extractEmbeddedAnswer(rawContent);
  const inlineAnswers = extractInlineAnswer(rawStem);
  const sourceAnswers = parseLetters(item["原资料答案"]);
  const answers = sourceAnswers.length ? sourceAnswers : embeddedAnswers.length ? embeddedAnswers : inlineAnswers;
  const answerSource = sourceAnswers.length ? "source" : embeddedAnswers.length ? "embedded" : inlineAnswers.length ? "inline_key" : "missing";
  const parsed = parseOptions(rawStem, item["选项"]);
  const explanation = item["解析"] ? cleanText(item["解析"]) : extractExplanation(rawContent);
  const type = /(?:\[|（|\()\s*多选题?/.test(rawContent) || String(item["题型"] ?? "").includes("多") ? "multiple" : "single";
  const question = {
    id: `${bank}-${String(sourceIndex + 1).padStart(4, "0")}`,
    bank,
    sourceFile: item["来源文件"] || file,
    sourceQuestionNo: item["题号"],
    sourcePages: Array.isArray(item["来源页码"]) ? item["来源页码"] : [],
    type,
    stem: reflowText(parsed.stem),
    sharedStem: item["共用题干"] ? reflowText(item["共用题干"]) : null,
    options: Object.entries(parsed.options).map(([key, content]) => ({ key, content: reflowText(content) })),
    answers,
    explanation: explanation ? reflowText(explanation) : null,
    reviewStatus: item["校对状态"] || "未知",
    answerSource,
    rawStem,
  };
  question.options = Object.fromEntries(question.options.map((option) => [option.key, option.content]));
  question.qualityIssues = qualityIssues({ ...question, options: question.options });
  question.verification = {
    method: answerSource === "embedded" ? "embedded_answer_and_explanation" : answerSource === "inline_key" ? "inline_answer_recovery" : item["校对状态"] === "已核对" ? "source_reviewed" : "ai_structure_review",
    confidence: item["校对状态"] === "已核对" || answerSource === "inline_key" || (answerSource === "embedded" && explanation) ? "high" : "medium",
  };
  const blockingIssues = ["missing_stem", "incomplete_options", "non_contiguous_options", "missing_answer", "answer_not_in_options", "single_answer_count_error", "multiple_answer_count_error"];
  question.publishable = !question.qualityIssues.some((issue) => blockingIssues.includes(issue));
  question.contentFingerprint = normalizeForCompare(question.stem);
  return question;
}

function main() {
  fs.mkdirSync(outputDir, { recursive: true });
  fs.mkdirSync(reviewDir, { recursive: true });
  const all = [];
  for (const file of files) {
    const fullPath = path.join(inputDir, file);
    const data = JSON.parse(fs.readFileSync(fullPath, "utf8"));
    let currentGroup = null;
    let currentSharedStem = null;
    let currentGroupSize = 0;
    let previousQuestionNo = null;
    data.forEach((item, index) => {
      const question = buildQuestion(file, item, index);
      if (item["共用题干"]) {
        currentGroup = `${question.bank}-group-${String(index + 1).padStart(4, "0")}`;
        currentSharedStem = question.sharedStem;
        currentGroupSize = 0;
      } else if (currentGroup && Number.isFinite(Number(item["题号"])) && Number.isFinite(Number(previousQuestionNo)) && Number(item["题号"]) !== Number(previousQuestionNo) + 1) {
        currentGroup = null;
        currentSharedStem = null;
        currentGroupSize = 0;
      } else if (currentGroup && currentGroupSize >= 5) {
        currentGroup = null;
        currentSharedStem = null;
        currentGroupSize = 0;
      }
      question.groupId = currentGroup;
      if (currentSharedStem) question.sharedStem = currentSharedStem;
      question.groupOrder = index;
      if (question.groupId) currentGroupSize += 1;
      previousQuestionNo = item["题号"];
      all.push(question);
    });
  }

  const fingerprints = new Map();
  for (const question of all) {
    if (!question.contentFingerprint) continue;
    const group = fingerprints.get(question.contentFingerprint) || [];
    group.push(question.id);
    fingerprints.set(question.contentFingerprint, group);
  }
  for (const question of all) {
    const duplicateIds = fingerprints.get(question.contentFingerprint) || [];
    if (duplicateIds.length > 1) {
      question.duplicateCandidateIds = duplicateIds.filter((id) => id !== question.id);
      question.qualityIssues.push("duplicate_candidate");
      question.publishable = false;
    } else {
      question.duplicateCandidateIds = [];
    }
  }

  const published = all.filter((question) => question.publishable);
  const review = all.filter((question) => !question.publishable);
  const summary = {
    generatedAt: new Date().toISOString(),
    sourceFiles: files,
    total: all.length,
    published: published.length,
    needsReview: review.length,
    byBank: Object.fromEntries(files.map((file) => {
      const bank = path.basename(file, ".json").replace("Exercises_", "");
      return [bank, { total: all.filter((q) => q.bank === bank).length, published: published.filter((q) => q.bank === bank).length }];
    })),
    issueCounts: Object.fromEntries([...new Set(all.flatMap((q) => q.qualityIssues))].sort().map((issue) => [issue, all.filter((q) => q.qualityIssues.includes(issue)).length])),
  };

  const manifest = {
    version: "2026-09-04.2",
    generatedAt: summary.generatedAt,
    total: published.length,
    banks: Object.fromEntries([...new Set(published.map((q) => q.bank))].sort().map((bank) => [bank, published.filter((q) => q.bank === bank).length])),
    types: {
      single: published.filter((q) => q.type === "single").length,
      multiple: published.filter((q) => q.type === "multiple").length,
    },
  };

  const publicQuestions = published.map(({ contentFingerprint, rawStem, ...question }) => question);
  fs.writeFileSync(path.join(outputDir, "questions.json"), JSON.stringify(publicQuestions, null, 2), "utf8");
  fs.writeFileSync(path.join(reviewDir, "all-cleaned.json"), JSON.stringify(all, null, 2), "utf8");
  fs.writeFileSync(path.join(reviewDir, "needs-review.json"), JSON.stringify(review, null, 2), "utf8");
  fs.writeFileSync(path.join(outputDir, "manifest.json"), JSON.stringify(manifest, null, 2), "utf8");
  fs.writeFileSync(path.join(reviewDir, "cleaning-report.json"), JSON.stringify(summary, null, 2), "utf8");
  console.log(JSON.stringify(summary, null, 2));
}

main();
