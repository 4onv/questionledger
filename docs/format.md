# Notebook format and API

QuestionLedger stores one notebook as versioned JSON. The file is the portable source of truth; the browser keeps an editable copy in memory.

## Minimal notebook

~~~json
{
  "version": 1,
  "title": "Choose an export format",
  "description": "Synthetic example: confirm the consumer's requirements first.",
  "facts": [
    {
      "id": "F1",
      "label": "Which formats can the consumer import?",
      "status": "pending",
      "value": ""
    }
  ],
  "questions": [
    {
      "id": "Q1",
      "parentId": null,
      "prompt": "Which format should the export use?",
      "dependsOn": ["F1"],
      "answer": {
        "text": "CSV is a provisional candidate.",
        "reviewedAgainst": null
      }
    }
  ],
  "confirmation": null
}
~~~

This notebook is valid but blocked: F1 is pending. The draft is retained.

All shown fields are required. Unknown fields, duplicate object keys in imported JSON, invalid UTF-8, missing references and cyclic ancestry are rejected. This strictness prevents a misspelled field from silently changing the meaning of an acknowledgement.

## Fields

| Object | Field | Meaning |
| --- | --- | --- |
| Notebook | `version` | Exactly `1` |
| Notebook | `title`, `description` | Display text |
| Notebook | `facts`, `questions` | Ordered arrays |
| Notebook | `confirmation` | `null` or the content fingerprint acknowledged by Confirm notebook |
| Fact | `id` | Stable reference unique across both facts and questions |
| Fact | `label`, `value` | The question or claim being investigated, and its recorded value |
| Fact | `status` | `pending` or `confirmed` |
| Question | `id` | Stable reference unique across both kinds |
| Question | `parentId` | Parent question ID, or `null` for a root |
| Question | `prompt` | The question being answered |
| Question | `dependsOn` | Unique IDs of facts directly used by this answer |
| Question | `answer` | `null` or an answer object |
| Answer | `text` | Answer or draft text |
| Answer | `reviewedAgainst` | `null` for a draft, or the context fingerprint acknowledged on review |

IDs must match `^[A-Za-z][A-Za-z0-9._-]{0,63}$`. Preserve IDs when editing or rearranging questions; they are references, not display positions. The UI generates IDs and does not rename or delete existing ones. An external JSON editor is responsible for preserving identity when making structural changes.

A fact may legitimately have an empty value, even when confirmed. QuestionLedger cannot determine whether that assertion is justified.

## Ancestry and dependencies

A question has at most one parent. It inherits all facts declared by its ancestors, as well as depending on the ancestors' prompts and answer text.

~~~text
F1: available storage
 └─ Q1: where should records live?
     └─ Q2: how long should records be kept?   also depends on F2
         └─ Q3: what should an export contain?
~~~

Q3's effective facts are F1 and F2. Changing F1 invalidates Q1's acknowledgement and blocks Q2 and Q3 until their ancestors are reviewed. Reviewing Q1 does not automatically review its descendants.

An unrelated question keeps its reviewed state when its context is unchanged.

## Derived states

The notebook does not store question statuses. Analysis derives them in this order:

1. **Blocked:** an effective fact is pending, or any ancestor is not reviewed.
2. **Unanswered:** no nonblank answer exists.
3. **Needs review:** a nonblank answer has no acknowledgement, or its fingerprint no longer matches.
4. **Reviewed:** the answer's fingerprint matches its current recorded context.

Blocking takes precedence. An unanswered child can therefore show Blocked while its parent remains unanswered. Drafts are allowed while blocked.

Notebook readiness requires:

- At least one question.
- Every question to be Reviewed.
- Every recorded fact to be confirmed, including facts not used by any question.

Readiness is a structural result. It does not assert that dependencies are complete, answers are correct, or a person is authorized to proceed.

## Fingerprints and confirmation

Fingerprints use SHA-256 over deterministic JSON. Object keys are sorted recursively; arrays preserve order unless the context explicitly sorts IDs.

A question's context fingerprint includes:

- Its ID, parent ID, prompt, direct dependency IDs and **own answer text**.
- The root-to-parent chain: ancestor IDs, parent IDs, prompts, dependency IDs and answer text.
- The full current records of all effective facts: ID, label, status and value.

Direct/effective fact ID sets are sorted when constructing the context. Reordering an otherwise identical dependency list does not invalidate the answer. Editing its own answer text in JSON while retaining the old fingerprint does invalidate it.

The notebook content fingerprint includes every notebook field except `confirmation`, including answer acknowledgements and array order. A confirmation is current only if the notebook is ready and its stored confirmation matches that fingerprint. Changing the title or rearranging records can invalidate notebook confirmation without invalidating individual answers.

Every provided mutation function clears confirmation, even when asked to write the same value. The UI also clears it when adding records or editing question fields.

**These are reproducible state fingerprints, not signatures or an audit log.** They do not identify a reviewer or resist deliberate recomputation. If edited content is restored byte-for-byte in the relevant normalized context, its earlier fingerprint can match again; there is no revision counter or historical change log.

## Limits

| Item | Limit |
| --- | --- |
| Imported JSON file | 1 MiB of UTF-8 |
| Normalized canonical notebook | 512 KiB of UTF-8 |
| Questions | 100 |
| Facts | 50 |
| Parent depth | 20, counting a root as level 1 |
| Title | 160 UTF-16 units; not whitespace-only |
| Description | 2,000 UTF-16 units |
| Fact label | 200 UTF-16 units; not whitespace-only |
| Fact value | 8,000 UTF-16 units |
| Question prompt | 4,000 UTF-16 units; not whitespace-only |
| Answer text | 8,000 UTF-16 units; blank drafts are allowed |
| ID | 64 ASCII characters, using the pattern above |
| Imported JSON nesting | 24 levels |

A typical emoji uses two UTF-16 units. Lone Unicode surrogates are rejected. Fingerprints must be lowercase 64-character hexadecimal strings or `null`.

The JavaScript API additionally rejects non-plain objects, accessor properties, unknown fields, sparse arrays and extra array properties. Validation returns fresh ordinary objects; callers' input data is not mutated.

## JavaScript API

Install the downloaded release archive in your project:

~~~sh
npm install --offline --ignore-scripts ./4onv-questionledger-0.1.0.tgz
~~~

Then import the portable core:

~~~js
import {
  validateLedger,
  analyzeLedger,
  setAnswer,
  updateFact,
  reviewAnswer,
  confirmLedger,
  toMarkdown
} from '@4onv/questionledger/core';

let notebook = validateLedger(input);
notebook = updateFact(notebook, 'F1', {
  status: 'confirmed',
  value: 'The consumer accepts CSV.'
});
notebook = await reviewAnswer(notebook, 'Q1', 'Export UTF-8 CSV.');
const result = await analyzeLedger(notebook);

if (result.ready) {
  notebook = await confirmLedger(notebook);
}
const handoff = await toMarkdown(notebook);
~~~

The example assumes the minimal notebook above. It uses manually supplied data and does not call a model or external service.

| Function | Result |
| --- | --- |
| `validateLedger(input)` | Fresh normalized notebook, or a validation error |
| `analyzeLedger(input)` | Promise for derived analysis |
| `setAnswer(input, questionId, text)` | Fresh notebook with a draft answer and cleared confirmation |
| `updateFact(input, factId, patch)` | Fresh notebook; patch may contain label, status and/or value |
| `reviewAnswer(input, questionId, text)` | Promise for fresh notebook with the supplied answer reviewed against current context |
| `confirmLedger(input)` | Promise for confirmed notebook; throws unless structurally ready |
| `toMarkdown(input)` | Promise for an escaped Markdown handoff |

`reviewAnswer` rejects blank text, pending effective facts and ancestors that are not reviewed. It hashes the supplied answer after applying it, so the acknowledgement binds the text actually recorded.

Analysis has this shape:

~~~js
{
  questions: [{
    id: 'Q1',
    status: 'reviewed',
    reasons: [],
    contextHash: '...',       // 64 lowercase hex characters
    ancestorIds: [],
    effectiveFactIds: ['F1']
  }],
  counts: { unanswered: 0, blocked: 0, 'needs-review': 0, reviewed: 1 },
  ready: true,
  confirmed: false,
  contentHash: '...'
}
~~~

Question analysis follows input order. Reasons are human-readable messages; use the status values for program logic.

The core has no Node imports and uses Web Crypto SHA-256. Run it on Node.js 22+ or a supported browser. The main package entry point additionally exports the Node-only `renderLedger(input)` compiler and the strict `parseJson(text)` parser.

## Browser and export behavior

Form controls are editors, not automatic persistence. Unapplied edits are retained while switching questions or editing other forms. Apply them with Save draft, Review this answer or Save fact; exports, imports and confirmation are blocked while unapplied edits remain. Save JSON downloads the current in-memory notebook; it does not overwrite the original HTML file. Closing or reloading the tab still loses anything that has not been downloaded.

A built HTML notebook embeds its initial data, code and styles. Its content security policy disallows network connections. Import is explicit through a file picker; no local directory is scanned. Markdown exports escape authored HTML and Markdown punctuation and include IDs, context fingerprints, facts, statuses and reasons.

Generated HTML and saved JSON can contain sensitive planning material. Local execution does not make a shared output file private.
