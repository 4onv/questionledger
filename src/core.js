/**
 * The portable QuestionLedger state model.
 * Readiness means recorded dependencies are reviewed; it never verifies truth.
 */
const ID = /^[A-Za-z][A-Za-z0-9._-]{0,63}$/;
const HASH = /^[a-f0-9]{64}$/;
const MAX_BYTES = 512 * 1024;
const encoder = new TextEncoder();

function fail(message) { throw new TypeError(message); }

function object(value, fields, label, required = fields) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) fail(label + " must be a plain object.");
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) fail(label + " must be a plain object.");
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string" || !fields.includes(key)) fail(label + " has an unknown field.");
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) fail(label + " must contain enumerable data fields.");
  }
  for (const key of required) if (!Object.hasOwn(value, key)) fail(label + "." + key + " is required.");
  return value;
}

function array(value, max, label) {
  if (!Array.isArray(value) || value.length > max) fail(label + " must be an array of at most " + max + " items.");
  for (const key of Reflect.ownKeys(value)) {
    if (key === "length") continue;
    if (typeof key !== "string" || !/^(0|[1-9][0-9]*)$/.test(key) || Number(key) >= value.length) fail(label + " has an unknown array property.");
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !("value" in descriptor)) fail(label + " must contain data items.");
  }
  for (let index = 0; index < value.length; index++) if (!Object.hasOwn(value, index)) fail(label + " must not contain holes.");
  return value;
}

function string(value, max, label, nonblank = false) {
  if (typeof value !== "string" || value.length > max) fail(label + " must be a string of at most " + max + " UTF-16 units.");
  if (nonblank && !value.trim()) fail(label + " must not be blank.");
  for (let index = 0; index < value.length; index++) {
    const unit = value.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(++index);
      if (!(next >= 0xdc00 && next <= 0xdfff)) fail(label + " contains a lone Unicode surrogate.");
    } else if (unit >= 0xdc00 && unit <= 0xdfff) fail(label + " contains a lone Unicode surrogate.");
  }
  return value;
}

function id(value, label) {
  string(value, 64, label, true);
  if (!ID.test(value)) fail(label + " must start with a letter and use only letters, digits, dot, underscore or hyphen.");
  return value;
}

function hashOrNull(value, label) {
  if (value !== null && (typeof value !== "string" || !HASH.test(value))) fail(label + " must be null or a lowercase SHA-256 hex digest.");
  return value;
}

function canonical(value) {
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  if (value !== null && typeof value === "object") {
    return "{" + Object.keys(value).sort().map(key => JSON.stringify(key) + ":" + canonical(value[key])).join(",") + "}";
  }
  return JSON.stringify(value);
}

async function digest(value) {
  if (!globalThis.crypto?.subtle) throw new Error("Web Crypto is unavailable; use Node 22+ or a supported browser.");
  const bytes = await globalThis.crypto.subtle.digest("SHA-256", encoder.encode(canonical(value)));
  return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, "0")).join("");
}

function ancestry(question, questionMap) {
  const result = [];
  const seen = new Set([question.id]);
  let next = question.parentId;
  while (next !== null) {
    if (seen.has(next)) fail("Question parent relationships contain a cycle.");
    seen.add(next);
    const parent = questionMap.get(next);
    if (!parent) fail("Question " + question.id + " references missing parent " + next + ".");
    result.unshift(parent);
    if (result.length >= 20) fail("Question parent depth must not exceed 20.");
    next = parent.parentId;
  }
  return result;
}

/** Reject unknown fields and unsafe/ambiguous shapes, and return independent data. */
export function validateLedger(input) {
  object(input, ["version", "title", "description", "facts", "questions", "confirmation"], "ledger");
  if (input.version !== 1) fail("ledger.version must be 1.");
  const usedIds = new Set();
  const uniqueId = (value, label) => {
    const valid = id(value, label);
    if (usedIds.has(valid)) fail("Duplicate ID: " + valid + ".");
    usedIds.add(valid);
    return valid;
  };
  const facts = array(input.facts, 50, "facts").map((fact, index) => {
    const label = "facts[" + index + "]";
    object(fact, ["id", "label", "status", "value"], label);
    if (!["pending", "confirmed"].includes(fact.status)) fail(label + ".status must be pending or confirmed.");
    return {
      id: uniqueId(fact.id, label + ".id"),
      label: string(fact.label, 200, label + ".label", true),
      status: fact.status,
      value: string(fact.value, 8000, label + ".value")
    };
  });
  const factIds = new Set(facts.map(fact => fact.id));
  const questions = array(input.questions, 100, "questions").map((question, index) => {
    const label = "questions[" + index + "]";
    object(question, ["id", "parentId", "prompt", "dependsOn", "answer"], label);
    const dependencies = array(question.dependsOn, 50, label + ".dependsOn").map(value => id(value, label + ".dependsOn"));
    if (new Set(dependencies).size !== dependencies.length) fail(label + ".dependsOn has duplicate IDs.");
    for (const dependency of dependencies) if (!factIds.has(dependency)) fail(label + " references missing fact " + dependency + ".");
    let answer = null;
    if (question.answer !== null) {
      object(question.answer, ["text", "reviewedAgainst"], label + ".answer");
      answer = {
        text: string(question.answer.text, 8000, label + ".answer.text"),
        reviewedAgainst: hashOrNull(question.answer.reviewedAgainst, label + ".answer.reviewedAgainst")
      };
    }
    return {
      id: uniqueId(question.id, label + ".id"),
      parentId: question.parentId === null ? null : id(question.parentId, label + ".parentId"),
      prompt: string(question.prompt, 4000, label + ".prompt", true),
      dependsOn: dependencies,
      answer
    };
  });
  const questionMap = new Map(questions.map(question => [question.id, question]));
  for (const question of questions) ancestry(question, questionMap);
  const normalized = {
    version: 1,
    title: string(input.title, 160, "title", true),
    description: string(input.description, 2000, "description"),
    facts,
    questions,
    confirmation: hashOrNull(input.confirmation, "confirmation")
  };
  if (encoder.encode(canonical(normalized)).byteLength > MAX_BYTES) fail("Ledger canonical UTF-8 size exceeds 512 KiB.");
  return normalized;
}

/** Derive review states using only explicit facts and question ancestry. */
export async function analyzeLedger(input) {
  const ledger = validateLedger(input);
  const questionMap = new Map(ledger.questions.map(question => [question.id, question]));
  const factMap = new Map(ledger.facts.map(fact => [fact.id, fact]));
  const ancestors = new Map(ledger.questions.map(question => [question.id, ancestry(question, questionMap)]));
  const results = new Map();
  const ordered = [...ledger.questions].sort((a, b) => ancestors.get(a.id).length - ancestors.get(b.id).length);
  for (const question of ordered) {
    const parents = ancestors.get(question.id);
    const effectiveFactIds = [...new Set([...parents.flatMap(parent => parent.dependsOn), ...question.dependsOn])].sort();
    const context = {
      version: 1,
      question: {
        id: question.id, parentId: question.parentId, prompt: question.prompt,
        dependsOn: [...question.dependsOn].sort(), answer: question.answer?.text ?? null
      },
      ancestors: parents.map(parent => ({
        id: parent.id, parentId: parent.parentId, prompt: parent.prompt,
        dependsOn: [...parent.dependsOn].sort(), answer: parent.answer?.text ?? null
      })),
      facts: effectiveFactIds.map(factId => factMap.get(factId))
    };
    const contextHash = await digest(context);
    const reasons = [];
    for (const factId of effectiveFactIds) {
      if (factMap.get(factId).status === "pending") reasons.push("Fact " + factId + " is pending.");
    }
    for (const parent of parents) {
      if (results.get(parent.id).status !== "reviewed") reasons.push("Ancestor " + parent.id + " needs review.");
    }
    let status;
    if (reasons.length) status = "blocked";
    else if (question.answer === null || !question.answer.text.trim()) {
      status = "unanswered";
      reasons.push("No nonblank answer has been recorded.");
    } else if (question.answer.reviewedAgainst !== contextHash) {
      status = "needs-review";
      reasons.push(question.answer.reviewedAgainst === null
        ? "The answer is a draft and has not been reviewed."
        : "Recorded question context changed since this answer was reviewed.");
    } else status = "reviewed";
    results.set(question.id, {
      id: question.id, status, reasons, contextHash,
      ancestorIds: parents.map(parent => parent.id), effectiveFactIds
    });
  }
  const questions = ledger.questions.map(question => results.get(question.id));
  const counts = { unanswered: 0, blocked: 0, "needs-review": 0, reviewed: 0 };
  for (const question of questions) counts[question.status]++;
  const ready = questions.length > 0
    && questions.every(question => question.status === "reviewed")
    && ledger.facts.every(fact => fact.status === "confirmed");
  const { confirmation: ignoredConfirmation, ...content } = ledger;
  const contentHash = await digest(content);
  return { questions, counts, ready, confirmed: ready && ledger.confirmation === contentHash, contentHash };
}

function questionById(ledger, questionId) {
  id(questionId, "question ID");
  const question = ledger.questions.find(item => item.id === questionId);
  if (!question) fail("Unknown question: " + questionId + ".");
  return question;
}

/** Store a draft, with no review claim, without modifying the supplied ledger. */
export function setAnswer(input, questionId, text) {
  const ledger = validateLedger(input);
  const question = questionById(ledger, questionId);
  question.answer = { text: string(text, 8000, "answer text"), reviewedAgainst: null };
  ledger.confirmation = null;
  return validateLedger(ledger);
}

/** Acknowledge an answer against the current explicit context when unblocked. */
export async function reviewAnswer(input, questionId, text) {
  const ledger = setAnswer(input, questionId, text);
  if (!text.trim()) fail("An answer must not be blank to review.");
  const analysis = await analyzeLedger(ledger);
  const state = analysis.questions.find(question => question.id === questionId);
  if (state.status === "blocked") throw new Error("Cannot review " + questionId + ": " + state.reasons.join(" "));
  questionById(ledger, questionId).answer.reviewedAgainst = state.contextHash;
  return validateLedger(ledger);
}

/** Edit any subset of a fact's label/status/value and invalidate confirmation. */
export function updateFact(input, factId, patch) {
  const ledger = validateLedger(input);
  id(factId, "fact ID");
  object(patch, ["label", "status", "value"], "fact patch", []);
  const fact = ledger.facts.find(item => item.id === factId);
  if (!fact) fail("Unknown fact: " + factId + ".");
  for (const key of Object.keys(patch)) fact[key] = patch[key];
  ledger.confirmation = null;
  return validateLedger(ledger);
}

/** Confirm only a fully reviewed nonempty ledger with all facts confirmed. */
export async function confirmLedger(input) {
  const ledger = validateLedger(input);
  ledger.confirmation = null;
  const analysis = await analyzeLedger(ledger);
  if (!analysis.ready) throw new Error("Cannot confirm: review every question and confirm every fact first.");
  ledger.confirmation = analysis.contentHash;
  return validateLedger(ledger);
}

function markdown(value) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;")
    .replace(/[\\\x60*_{}\[\]()#+.!|~-]/g, "\\$&")
    .replace(/\r\n?/g, "\n").replace(/\n/g, "\n  ");
}

/** Export an inert, readable handoff. Imported prose is never raw HTML. */
export async function toMarkdown(input) {
  const ledger = validateLedger(input);
  const analysis = await analyzeLedger(ledger);
  const states = new Map(analysis.questions.map(question => [question.id, question]));
  const lines = [
    "# " + markdown(ledger.title), "",
    markdown(ledger.description), "",
    "Readiness: " + (analysis.ready ? "ready" : "not ready") + ". Confirmation: " + (analysis.confirmed ? "current" : "not current") + ".", "",
    "Status is based only on manually recorded dependencies. Facts are not independently verified.", "",
    "Content SHA-256: \x60" + analysis.contentHash + "\x60", "",
    "## Facts", ""
  ];
  if (!ledger.facts.length) lines.push("No facts recorded.", "");
  for (const fact of ledger.facts) {
    lines.push("### " + markdown(fact.id) + ": " + markdown(fact.label), "",
      "Status: " + fact.status + ".", "", markdown(fact.value), "");
  }
  lines.push("## Questions", "");
  if (!ledger.questions.length) lines.push("No questions recorded.", "");
  for (const question of ledger.questions) {
    const state = states.get(question.id);
    lines.push("### " + markdown(question.id) + ": " + markdown(question.prompt), "",
      "Status: " + state.status + ". Parent: " + markdown(question.parentId ?? "none") + ".", "",
      "Ancestor context: " + (state.ancestorIds.length ? state.ancestorIds.map(markdown).join(", ") : "none") + ".",
      "Direct facts: " + (question.dependsOn.length ? question.dependsOn.map(markdown).join(", ") : "none") + ".",
      "Effective facts: " + (state.effectiveFactIds.length ? state.effectiveFactIds.map(markdown).join(", ") : "none") + ".", "",
      "Answer: " + (question.answer === null ? "(not recorded)" : markdown(question.answer.text)), "",
      "Context SHA-256: \x60" + state.contextHash + "\x60",
      "Reviewed against: " + (question.answer?.reviewedAgainst ? "\x60" + question.answer.reviewedAgainst + "\x60" : "not reviewed"), "");
    if (state.reasons.length) lines.push(...state.reasons.map(reason => "- " + markdown(reason)), "");
  }
  return lines.join("\n");
}
