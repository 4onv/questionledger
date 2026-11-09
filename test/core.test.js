import test from "node:test";
import assert from "node:assert/strict";
import {
  validateLedger, analyzeLedger, setAnswer, reviewAnswer, updateFact, confirmLedger, toMarkdown
} from "../src/core.js";

function fixture() {
  return {
    version: 1, title: "Synthetic planning example", description: "Demonstration data, not production evidence.",
    facts: [{ id: "F1", label: "Does the backend support batches?", status: "confirmed", value: "Yes, up to 100 items." }],
    questions: [
      { id: "Q1", parentId: null, prompt: "How should requests be submitted?", dependsOn: ["F1"], answer: null },
      { id: "Q2", parentId: "Q1", prompt: "What should happen on a partial failure?", dependsOn: [], answer: null },
      { id: "Q3", parentId: null, prompt: "What should the documentation explain?", dependsOn: [], answer: null }
    ],
    confirmation: null
  };
}
async function reviewed() {
  let ledger = fixture();
  for (const [id, answer] of [["Q1", "Use batches."], ["Q2", "Retry failed items."], ["Q3", "Explain retry behavior."]]) {
    ledger = await reviewAnswer(ledger, id, answer);
  }
  return ledger;
}
const state = (analysis, id) => analysis.questions.find(question => question.id === id);

test("validation returns independent normalized data without mutating the input", () => {
  const input = fixture();
  const before = structuredClone(input);
  const normalized = validateLedger(input);
  normalized.facts[0].value = "Changed";
  normalized.questions[0].dependsOn.push("not shared");
  assert.deepEqual(input, before);
  assert.notEqual(normalized.questions[0], input.questions[0]);
});

test("strict schema rejects unknown, missing, accessor and non-plain object fields", () => {
  let input = fixture(); input.extra = true;
  assert.throws(() => validateLedger(input), /unknown field/);
  input = fixture(); delete input.confirmation;
  assert.throws(() => validateLedger(input), /required/);
  input = fixture(); Object.defineProperty(input, "title", { get() { throw Error("must not execute"); }, enumerable: true });
  assert.throws(() => validateLedger(input), /data fields/);
  input = fixture(); Object.setPrototypeOf(input, { inherited: true });
  assert.throws(() => validateLedger(input), /plain object/);
  input = fixture(); input.questions[0].answer = { text: "Answer", reviewedAgainst: null, status: "reviewed" };
  assert.throws(() => validateLedger(input), /unknown field/);
});

test("rejects malformed IDs, duplicate IDs across kinds, references, and repeated dependencies", () => {
  let input = fixture(); input.questions[0].id = "1not-valid";
  assert.throws(() => validateLedger(input), /start with a letter/);
  input = fixture(); input.questions[0].id = "F1";
  assert.throws(() => validateLedger(input), /Duplicate ID/);
  input = fixture(); input.questions[0].dependsOn = ["missing"];
  assert.throws(() => validateLedger(input), /missing fact/);
  input = fixture(); input.questions[0].dependsOn = ["F1", "F1"];
  assert.throws(() => validateLedger(input), /duplicate IDs/);
  input = fixture(); input.questions[1].parentId = "missing";
  assert.throws(() => validateLedger(input), /missing parent/);
});

test("rejects parent cycles, self parents, and depth beyond twenty", () => {
  let input = fixture(); input.questions[0].parentId = "Q2";
  assert.throws(() => validateLedger(input), /cycle/);
  input = fixture(); input.questions[0].parentId = "Q1";
  assert.throws(() => validateLedger(input), /cycle/);
  input = fixture();
  input.questions = Array.from({ length: 20 }, (_, i) => ({
    id: "Q" + i, parentId: i ? "Q" + (i - 1) : null, prompt: "Level " + i, dependsOn: [], answer: null
  }));
  assert.equal(validateLedger(input).questions.length, 20);
  input.questions.push({ id: "Q20", parentId: "Q19", prompt: "Too deep", dependsOn: [], answer: null });
  assert.throws(() => validateLedger(input), /depth/);
});

test("field limits, blank required text and lone Unicode surrogates are rejected", () => {
  for (const mutate of [
    ledger => { ledger.title = "x".repeat(161); },
    ledger => { ledger.description = "x".repeat(2001); },
    ledger => { ledger.facts[0].label = "x".repeat(201); },
    ledger => { ledger.facts[0].value = "x".repeat(8001); },
    ledger => { ledger.questions[0].prompt = "x".repeat(4001); },
    ledger => { ledger.title = " \t\n "; },
    ledger => { ledger.facts[0].label = " "; },
    ledger => { ledger.questions[0].prompt = ""; },
    ledger => { ledger.title = "\ud800"; },
    ledger => { ledger.facts[0].value = "\udc00"; }
  ]) {
    const input = fixture(); mutate(input); assert.throws(() => validateLedger(input));
  }
  const input = fixture(); input.title = "Valid emoji \ud83d\ude00";
  assert.equal(validateLedger(input).title, input.title);
  assert.throws(() => setAnswer(input, "Q1", "x".repeat(8001)), /8000/);
});

test("canonical UTF-8 limit catches multibyte payloads within per-field limits", () => {
  const input = fixture();
  input.facts = Array.from({ length: 50 }, (_, i) => ({ id: "F" + i, label: "Example", status: "confirmed", value: "\u754c".repeat(8000) }));
  input.questions[0].dependsOn = ["F1"];
  assert.throws(() => validateLedger(input), /512 KiB/);
});

test("array bounds and sparse/extra-property arrays are rejected", () => {
  let input = fixture(); input.facts = Array.from({ length: 51 }, (_, i) => ({ id: "F" + i, label: "f", status: "pending", value: "" }));
  assert.throws(() => validateLedger(input), /at most 50/);
  input = fixture(); input.questions = Array.from({ length: 101 }, (_, i) => ({ id: "Q" + i, parentId: null, prompt: "q", dependsOn: [], answer: null }));
  assert.throws(() => validateLedger(input), /at most 100/);
  input = fixture(); delete input.questions[0];
  assert.throws(() => validateLedger(input), /holes/);
  input = fixture(); input.facts.extra = "hidden";
  assert.throws(() => validateLedger(input), /array property/);
});

test("pending facts block draft review and inherited dependencies while preserving text", async () => {
  const input = fixture(); input.facts[0].status = "pending";
  const draft = setAnswer(input, "Q1", "A provisional answer.");
  const analysis = await analyzeLedger(draft);
  assert.equal(state(analysis, "Q1").status, "blocked");
  assert.equal(state(analysis, "Q2").status, "blocked");
  assert.deepEqual(state(analysis, "Q2").effectiveFactIds, ["F1"]);
  assert.equal(draft.questions[0].answer.text, "A provisional answer.");
  assert.equal(draft.questions[0].answer.reviewedAgainst, null);
  await assert.rejects(reviewAnswer(draft, "Q1", "A provisional answer."), /F1 is pending/);
  assert.equal(input.questions[0].answer, null);
});

test("question ancestors must be reviewed before child acknowledgement", async () => {
  const input = fixture();
  await assert.rejects(reviewAnswer(input, "Q2", "Retry it."), /Ancestor Q1/);
  const parentReviewed = await reviewAnswer(input, "Q1", "Use batches.");
  const childReviewed = await reviewAnswer(parentReviewed, "Q2", "Retry it.");
  assert.equal(state(await analyzeLedger(childReviewed), "Q2").status, "reviewed");
});

test("all reviewed questions produce exact count keys and structural readiness", async () => {
  const ledger = await reviewed();
  const analysis = await analyzeLedger(ledger);
  assert.deepEqual(analysis.counts, { unanswered: 0, blocked: 0, "needs-review": 0, reviewed: 3 });
  assert.equal(analysis.ready, true);
  assert.equal(analysis.confirmed, false);
  assert.match(analysis.contentHash, /^[a-f0-9]{64}$/);
});

test("changing a fact stales its answer, blocks descendants and leaves unrelated questions reviewed", async () => {
  const input = await reviewed();
  const before = structuredClone(input);
  const changed = updateFact(input, "F1", { value: "No batch endpoint exists." });
  const analysis = await analyzeLedger(changed);
  assert.equal(state(analysis, "Q1").status, "needs-review");
  assert.equal(state(analysis, "Q2").status, "blocked");
  assert.equal(state(analysis, "Q3").status, "reviewed");
  assert.deepEqual(input, before);
  const renewedParent = await reviewAnswer(changed, "Q1", "Submit individually.");
  assert.equal(state(await analyzeLedger(renewedParent), "Q2").status, "needs-review");
});

test("fact label and status changes invalidate review, including inherited context", async () => {
  const input = await reviewed();
  assert.equal(state(await analyzeLedger(updateFact(input, "F1", { label: "Which API version supports batches?" })), "Q1").status, "needs-review");
  const pending = updateFact(input, "F1", { status: "pending" });
  assert.equal(state(await analyzeLedger(pending), "Q1").status, "blocked");
  assert.equal(state(await analyzeLedger(pending), "Q2").status, "blocked");
});

test("ancestor answer changes require descendant review even after the parent is reviewed again", async () => {
  const input = await reviewed();
  const changed = await reviewAnswer(input, "Q1", "Use one request per item.");
  const analysis = await analyzeLedger(changed);
  assert.equal(state(analysis, "Q1").status, "reviewed");
  assert.equal(state(analysis, "Q2").status, "needs-review");
  assert.equal(state(analysis, "Q3").status, "reviewed");
});

test("prompt and declared dependency changes invalidate acknowledgement", async () => {
  let ledger = await reviewed();
  ledger.questions[0].prompt = "How should version two requests be submitted?";
  assert.equal(state(await analyzeLedger(ledger), "Q1").status, "needs-review");
  ledger = await reviewed();
  ledger.questions[0].dependsOn = [];
  assert.equal(state(await analyzeLedger(ledger), "Q1").status, "needs-review");
});

test("manually changed answer text cannot reuse the previous acknowledgement hash", async () => {
  const ledger = await reviewed();
  const previousHash = ledger.questions[0].answer.reviewedAgainst;
  ledger.questions[0].answer.text = "An imported replacement answer.";
  assert.equal(ledger.questions[0].answer.reviewedAgainst, previousHash);
  const analysis = await analyzeLedger(ledger);
  assert.equal(state(analysis, "Q1").status, "needs-review");
  assert.equal(state(analysis, "Q2").status, "blocked");
  assert.notEqual(state(analysis, "Q1").contextHash, previousHash);
});

test("draft changes clear previous review and blank drafts remain unanswered", async () => {
  const input = await reviewed();
  const draft = setAnswer(input, "Q1", "Changed, not acknowledged.");
  assert.equal(state(await analyzeLedger(draft), "Q1").status, "needs-review");
  assert.equal(state(await analyzeLedger(draft), "Q2").status, "blocked");
  const blank = setAnswer(input, "Q1", " \n");
  assert.equal(state(await analyzeLedger(blank), "Q1").status, "unanswered");
  await assert.rejects(reviewAnswer(input, "Q1", ""), /not be blank/);
  assert.equal(input.questions[0].answer.text, "Use batches.");
});

test("confirmation binds complete content, is stable on analysis, and clears for every mutation", async () => {
  const input = await reviewed();
  const confirmed = await confirmLedger(input);
  const analysis = await analyzeLedger(confirmed);
  assert.equal(analysis.confirmed, true);
  assert.equal(confirmed.confirmation, analysis.contentHash);
  assert.equal(input.confirmation, null);
  assert.equal(setAnswer(confirmed, "Q1", "Use batches.").confirmation, null);
  assert.equal(updateFact(confirmed, "F1", { value: confirmed.facts[0].value }).confirmation, null);
  assert.equal((await reviewAnswer(confirmed, "Q1", "Use batches.")).confirmation, null);
  const editedTitle = structuredClone(confirmed); editedTitle.title = "Renamed notebook";
  assert.equal((await analyzeLedger(editedTitle)).confirmed, false);
  const reordered = structuredClone(confirmed); reordered.questions.reverse();
  assert.equal((await analyzeLedger(reordered)).ready, true);
  assert.equal((await analyzeLedger(reordered)).confirmed, false);
});

test("an unused pending fact still prevents global confirmation; an empty ledger never passes", async () => {
  const ledger = await reviewed();
  ledger.facts.push({ id: "F2", label: "New constraint", status: "pending", value: "" });
  assert.equal((await analyzeLedger(ledger)).ready, false);
  await assert.rejects(confirmLedger(ledger), /confirm every fact/);
  const empty = { version: 1, title: "Empty", description: "", facts: [], questions: [], confirmation: null };
  assert.equal((await analyzeLedger(empty)).ready, false);
  await assert.rejects(confirmLedger(empty), /Cannot confirm/);
});

test("reviewing an answer does not mutate source data and unknown IDs/patches fail", async () => {
  const input = fixture(); const before = structuredClone(input);
  await reviewAnswer(input, "Q1", "Use batches.");
  assert.deepEqual(input, before);
  assert.throws(() => setAnswer(input, "Absent", "No"), /Unknown question/);
  assert.throws(() => updateFact(input, "Absent", { value: "No" }), /Unknown fact/);
  assert.throws(() => updateFact(input, "F1", { id: "Other" }), /unknown field/);
  assert.throws(() => updateFact(input, "F1", { status: "maybe" }), /status/);
});

test("hashes are deterministic across object key insertion order", async () => {
  const ledger = await reviewed();
  const reordered = {
    confirmation: ledger.confirmation, questions: ledger.questions, facts: ledger.facts,
    description: ledger.description, title: ledger.title, version: ledger.version
  };
  assert.deepEqual(await analyzeLedger(reordered), await analyzeLedger(ledger));
});

test("Markdown exports stable references, statuses and escaped hostile text without mutating", async () => {
  const ledger = fixture();
  ledger.title = '<img src=x onerror="alert(1)">';
  ledger.description = "[click](javascript:alert(1))\n# fake heading";
  ledger.questions[0].prompt = "<script>alert(1)</script> | question";
  const before = structuredClone(ledger);
  const exported = await toMarkdown(ledger);
  assert.ok(exported.includes("&lt;img"));
  assert.ok(!exported.includes("<img"));
  assert.ok(!exported.includes("<script"));
  assert.ok(!exported.includes("[click](javascript:"));
  assert.ok(exported.includes("\\|"));
  assert.ok(exported.includes("Ancestor context: Q1"));
  assert.ok(exported.includes("Effective facts: F1"));
  assert.ok(exported.includes("Status: unanswered"));
  assert.deepEqual(ledger, before);
});
