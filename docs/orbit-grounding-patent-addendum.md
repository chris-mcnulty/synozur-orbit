# Orbit Grounding-Document Supplemental Disclosure

## Counsel review draft — separate from the Orion/Vega application

Prepared 12 November 2026. Technical inspection baseline: `cf8d930e402fb4f824a94f3855719cae7929506a`.

This is a supplemental technical disclosure and drafting aid, not a legal opinion, filing-ready application, novelty search, or patentability assessment. No application code was changed. The evidence is static source inspection, not a certification of deployed behavior or a historical implementation date.

The supplied attachment, `attached_assets/Pasted-I-ve-drafted-the-provisional-patent-application-Provisi_1794516938031.txt`, is a summary containing a document link. It is not the referenced 11-page DOCX. That application, its 20 described claims, and its seven described figures have not been reviewed or amended. References below to differences concern only the supplied summary, not the actual application. Integration and claim mapping await the original DOCX.

### Reading key

**I — Implemented in the inspected path:** supported by the cited code, subject to the stated limitations. This does not establish deployment, conception, inventorship, or efficacy.

**O — Optional embodiment requiring inventor confirmation:** a proposed extension or combination, not established as implemented by this inspection. Related code references identify the starting point or evidentiary gap; they are not proof of implementation.

Evidence IDs E01–E14 identify precise source locations in Section 2. Narrative paragraphs, examples, and figure proposals inherit the classification and limits of their cited evidence. Hypothetical document names and sizes are explanatory inputs, not observed customer records.

## 1. Proposed supplemental subject matter

Suggested working title: **Task-Applicable, Scope-Constrained Document Grounding with Authored-Source Precedence and Typed Reference Resolution**.

The supplied summary emphasizes tenant/global document stores, priority ordering, and bounded prompt construction. Orbit supplies more specific examples of task applicability, market and entity filtering, source-type-dependent eligibility, replacement of generated strategy by uploaded strategy, and limited source attribution. These mechanisms occur in different code paths; they must not be presented as one universally implemented algorithm. [I: E01–E14]

For counsel's consideration, the technical focus is selecting eligible context before constructing a prompt, rather than indiscriminately appending all available documents. The inspected selectors use relational fields, task tags, reference kinds, and local string assembly. These selectors do not perform vector similarity retrieval or model retraining; this is a statement about these functions, not Orbit's entire architecture or an asserted advantage over retrieval or fine-tuning. [I: E02–E10]

## 2. Implementation-evidence table

All line references below are to the inspection baseline above. Function names accompany references so counsel and engineers can relocate evidence after later changes.

| ID / status | Technical assertion and inspected path | Code evidence | Limits material to drafting |
| --- | --- | --- | --- |
| E01 / I | Separate tenant grounding, competitor-document, and global-document records carry different metadata. Tenant grounding includes tenant, nullable market, contexts, scope, use case, and optional product/competitor links. Competitor documents have active/archive metadata; global documents have category and active flag. | `shared/schema.ts:1261-1389` — groundingDocuments, competitorDocuments, globalGroundingDocuments | No priority column in these definitions. Tenant grounding has no general active flag equivalent to global isActive or competitor status. Do not transfer one store's lifecycle fields to all stores. |
| E02 / I | Context retrieval filters tenant and market; default-market requests include matching-market and null-market documents, while other requests require an exact market. A supplied task tag accepts null contexts or a containing array. Optional entity filters support exact product, product-or-null, and exact competitor. Results are newest-created first. | `server/storage.ts:3207-3242` — getGroundingDocumentsByContext | Null contexts are a wildcard here; an empty array is not. Filters are conditional on arguments. The stored useCase and scope strings are not independently applied as eligibility predicates here. Timestamp ordering is not administrator priority. |
| E03 / I | Product grounding uses product-or-null selection and then excludes documents associated with unrelated competitors. Text feature import validates the requested product, requests the product_features context, invokes extraction with grounding, and saves extracted feature records. | `server/routes/products.ts:15-38,762-802` — buildProductGroundingContext and import-text route | A product with no competitor retains only documents without a competitor association. This path does not invoke the strategic authored-over-generated selector or voice global resolver. |
| E04 / I | The strategic loader chooses the first nonblank uploaded document explicitly tagged messaging_framework or gtm_plan and matching its market rule; it returns that text before attempting the generated equivalent. Tenant retrieval is newest-created first. | `server/services/strategic-context.ts:30-99,154-191`; `server/storage.ts:1345-1349` — loadUploadedAuthoritativeDoc, loadMessagingFramework, loadGtmPlanSummary | Each uploaded body is trimmed and cut to 2,500 characters. Default-market behavior admits null-market records. No authorship verification, approval requirement, priority field, or exact-market preference over a newer null-market record is implemented by this selector. |
| E05 / I | Strategic sections are independently loaded and formatted as named prompt sections; unsuccessful section loads are omitted through Promise.allSettled. | `server/services/strategic-context.ts:331-410` — loadStrategicContext, formatStrategicContextForPrompt | No final aggregate prompt budget here. If isDefaultMarket is omitted, it is inferred as !marketId; callers supplying a market ID do not automatically receive default-market inheritance. An uploaded loader error omits that section rather than necessarily reaching its generated fallback. |
| E06 / I | Content extraction's grounding loader includes tenant-wide marketing documents plus documents for the specified market, names them, and excludes the separate global store. Null contexts or marketing_content qualifies. | `server/services/content-extraction.ts:183-216,386-430` — loadGroundingContext, generateContentSummary | Unlike E02, null-market documents remain eligible even when a non-default market is supplied. No local grounding-size cap or explicit query ordering. The 3,000-character source-page preview limit is not a grounding-document limit. |
| E07 / I | Framework references carry kind plus ID. Resolution dispatches long_form, grounding, and global references to different stores, then reconstructs surviving results in input order. | `shared/schema.ts:3032-3038,3141-3144`; `server/services/voice-service.ts:83-166` — VoiceFrameworkRef, resolveFrameworkRefs | Long form requires tenant match, messaging_framework type, and content, but not generated status in this resolver. Grounding requires tenant match and an explicit marketing_content tag; null contexts do not qualify. No market/entity predicate is applied by this resolver. |
| E08 / I | Selected global references resolve only when active and in brand_voice or marketing_guidelines. Framework bodies are bounded in input order and inserted into labeled authoritative messaging sections. | `server/services/voice-service.ts:37-39,115-165,269-280`; `shared/schema.ts:3141-3144` | Nominal 8,000 characters per body and 24,000 across returned bodies, not tokenizer-measured limits. Truncation markers can exceed those nominal thresholds. Labels and other prompt sections add overhead. Global inclusion is selected, not automatic tenant inheritance or proof of per-tenant approval. |
| E09 / I | Document extraction handles text/Markdown, PDF, and DOCX; the generic assembler names documents and their scope, skips missing extracted text, and sequentially includes or truncates text using a four-characters-per-token approximation. | `server/services/document-extraction.ts:11-58,116-147` — extractTextFromDocument, prepareGroundingContext | Legacy DOC returns a conversion notice; PDF/DOCX parse errors can return textual error notices. Budget defaults to 8,000 approximate tokens; this is not exact tokenizer enforcement. Headers/separators introduce edge cases, including possible two-character separator overrun at an exact fit. |
| E10 / I | Competitor grounding selects active uploads for a competitor, filters by tenant, labels the document text, and returns source IDs, titles, scope tags, and competitor IDs using title-presence checks after assembly. Multi-competitor assembly verifies competitor tenant ownership and labels each entity. | `server/storage.ts:1389-1403`; `server/services/competitor-document-context.ts:27-126,140-147` | Single-competitor default is 4,000 approximate tokens. Multi-competitor nominal budget is 6,000, allocated as max(800, floor(budget/count)); the floor and wrappers can exceed the nominal combined allowance. No independent market filter here. Title matches can falsely attribute same-title documents or title strings inside other text. |
| E11 / I | Battlecard generation inserts competitor-document context into the model prompt, parses a JSON response, saves a battlecard, and returns competitorDocSources with the result. | `server/routes/battlecards.ts:84-104,129-159,164-206` | This inspected persistence block saves battlecard fields, not competitorDocSources; the source list is attached to the returned result. Do not claim durable source lineage for every saved battlecard. |
| E12 / I | Rewrite preview verifies account tenant ownership, chooses request refs or profile defaults, resolves frameworks, builds prompts, invokes the model, and returns variants. Empty refs explicitly select none; omitted refs use defaults. Persona null suppresses the default. | `server/routes/marketing-posts.ts:132-200,207-229`; `server/services/voice-service.ts:203-319` | The rewrite helper returns refsToUse, not refs reconstructed from surviving frameworks. Its field name resolvedFrameworkRefs therefore does not prove every recorded reference contributed prompt text. |
| E13 / I | Existing-post rewrite checks post/account tenant ownership and retains up to 20 lineage entries with time, actor, model, persona, and reference metadata; it does not automatically replace edited content. A voice snapshot captures profile settings and default refs. | `server/routes/marketing-posts.ts:237-286`; `server/services/voice-service.ts:331-351` — snapshotVoiceProfile | Neither a complete immutable source-text snapshot nor claim-to-source evidence. Ref lineage inherits E12's pre-resolution-list limitation. Snapshot helper existence alone is not a guarantee of capture on every generation. |
| E14 / I | The documents/context/ai endpoint uses context retrieval and the generic assembler without supplying a task tag. | `server/routes/admin.ts:275-289` | A concrete counterexample to universal task filtering. Its generic budget differs from voice and competitor paths. |

### Budget and selection conclusions

“Bounded” in this disclosure means the particular truncation/allocation procedure shown in code, not a universal hard token ceiling. E04 bounds selected strategic text but E05 has no aggregate cap; E06 does not locally bound grounding text; E08 bounds framework bodies approximately; E09–E10 use character estimates and have overhead/allocation exceptions. Model output limits are separate from input grounding limits. [I: E04–E10]

Likewise, “authority” denotes substitution and prompt instructions, not proof that a document was written by a human, that its factual claims are true, or that the model obeyed it. “Attribution” denotes labels or source/reference metadata, not a verified mapping from every output assertion to supporting passages. [I: E04, E08, E10–E13]

## 3. Supplemental specification narrative

### 3.1 Records and applicability

In an implemented Orbit product-analysis path, a server receives a request associated with a tenant, active market, product, and task type. The server validates the product against the request context. It retrieves grounding records constrained by tenant and market and applies the requested task tag. Product-specific records are combined with records lacking a product association, after which records tied to unrelated competitors are excluded. The selected records provide context to feature extraction rather than becoming product features merely by being stored. [I: E01–E03]

The market predicate is conditional: in the context-storage path, null-market records are included when the request context identifies the default market, but not for a non-default market. This permits a particular form of inherited tenant context without making all tenant documents applicable to every market. Task applicability also depends on the caller: a null contexts value qualifies as unspecified applicability in that storage path, whereas an explicit array must contain the task. [I: E02]

Other implementations use different rules. The marketing content loader places tenant-wide guidelines alongside matching-market guidelines, while explicit voice-reference resolution does not itself constrain market or product. These are separate embodiments of scope selection, not interchangeable enforcement layers. [I: E06–E08]

### 3.2 Authored-source precedence

In the implemented strategic-context path, the server first seeks a nonblank uploaded document carrying the relevant strategy tag. A matching uploaded messaging framework or go-to-market plan supplies the respective section instead of the generated recommendation. An authority label accompanies a bounded excerpt. If no eligible uploaded document exists, the server can use a generated recommendation with the required status and content; that generated text is summarized through recognized headings or a fallback prefix. [I: E04]

The significance for supplemental drafting is a choice between two alternative sources serving the same strategic role, rather than merely concatenating both. The code treats the uploaded document as team authority, but does not verify human authorship. Multiple eligible uploads are resolved by first match in newest-created order, with no separate priority ranking or specificity-based conflict resolver. [I: E04]

### 3.3 Controlled global inclusion and typed references

In a distinct implemented rewrite path, a reference comprises a source kind and record identifier. References may designate generated long-form messaging, tenant grounding documents, or application-wide documents. The resolver fetches each kind through its applicable eligibility conditions and emits eligible text in reference order. The global branch requires active status and an allowed messaging category; it is reached only for selected global references, including configured profile defaults. [I: E07, E08, E12]

This differs from the marketing-content grounding loader, which excludes the global table entirely. Therefore the addendum should describe controlled global participation at identified entry points, not automatic addition of global documents to every tenant prompt. The global checks are not evidence that an administrator approved each global document separately for each tenant. [I: E06–E08]

### 3.4 Assembly and source identity

In the rewrite implementation, the resolver constructs a sequence of typed, identified, labeled text bodies under per-body and running character allowances. Prompt assembly encloses those bodies in labeled messaging guidance and combines them with the account voice, optional audience, and author instructions. Unsupported or ineligible references are omitted from resolved text. Selection and bounded assembly are implemented operations; reliable model compliance or reduced hallucinations are not established measurements. [I: E07, E08, E12]

In competitor analysis, a separate assembler uses named documents and entity labels to distinguish uploaded competitor material from company positioning. A companion source list is derived by checking whether document titles remain in the assembled text. This supports document-level contextual attribution but does not establish exact inclusion tracking or proof of individual output claims. The supplied “first-party” label describes how the prompt labels tenant-uploaded material; it does not verify the material's original author. [I: E09–E11]

### 3.5 Proposed combined embodiment

An optional integrated embodiment could apply task/market/entity eligibility, authored-over-generated selection for equivalent strategy roles, explicit typed global selection, bounded assembly, and an inclusion manifest in a single request pipeline. The inspected product, strategic, voice, and competitor paths separately supply components, but no inspected path establishes that complete sequence. Inventors must confirm whether this combination was conceived, when, by whom, and with what operational detail before counsel includes it as their disclosure. [O: E02–E13; implementation of the combined pipeline not established]

## 4. End-to-end worked examples

### Example A — implemented product-feature import

The following is a hypothetical execution of the inspected route, not a production test.

1. A user submits at least 50 characters of product description to the text feature-import endpoint for Product P. The route obtains request context and validates P. Assume that context identifies Tenant T and non-default Market M. [I: E03]
2. Assume records include: A, tagged product_features for P in M; B, null product and null contexts in M; C, for another product; D, a null-market record; E, in another tenant; and F, tagged only marketing_content. The product-or-null and task/market/tenant predicates admit A and B and exclude C–F under these assumptions. If B belongs to an unrelated competitor, the subsequent competitor filter excludes B too. [I: E02, E03]
3. Remaining records are newest-created first. The product helper passes their names, text, and scope labels to the generic assembler with its default approximate 8,000-token allowance. A long body may be cut and later records omitted. The result is a labeled context string, not a document priority score. [I: E02, E03, E09]
4. The route supplies that string, the submitted description, source type text, and product name to extractFeaturesFromContent. Returned features are saved with the product, tenant, market, and parsed source type; an empty feature result is rejected. This establishes the route's invocation and persistence behavior, not an audit of model accuracy. [I: E03]
5. This route does not thereby demonstrate authored-over-generated strategy replacement, global framework selection, or an output-claim provenance manifest. Those features must not be silently added to this example. [I: E03; O for a combined extension under Section 3.5]

### Example B — implemented typed-reference rewrite

Assume an account owned by T and a request selecting, in order: a 10,000-character tenant framework with marketing_content, a 9,000-character active global brand_voice document, a foreign-tenant long-form record, and a 10,000-character eligible tenant long-form messaging framework. [Hypothetical inputs; I processing: E07, E08, E12]

The resolver excludes the foreign-tenant record. It takes the first 8,000 characters of each of the first two eligible bodies and appends a truncation marker to each. The third eligible body's allowance is the remaining 24,000-character budget after counting those returned strings; its appended marker can take the resulting total slightly over the nominal ceiling. Prompt headings and other instructions add further characters. The selected global source is permitted by kind, active status, and category—not because all globals are inherited. [I: E07, E08]

The route builds the system and user prompts, requests variants, applies the shown copy-quality step, and returns variants. For the existing-post endpoint, lineage is appended without automatically replacing edited content. Because its metadata uses the selected/default-applied list, that lineage can still mention the rejected foreign-tenant reference even though its text was not included. This is a provenance limitation, not evidence of foreign-tenant text inclusion by the resolver. [I: E12, E13]

Neither this rewrite example nor Example A invokes the strategic replacement rule in E04. An integrated example doing both would be optional, not a description of an inspected end-to-end path.

## 5. Proposed figure descriptions

These are drawing instructions, not completed drawings. Use supplemental labels S1–S6 until counsel reconciles numbering with the original application's seven described figures.

**S1 — Records and request selectors.** Show tenant grounding, competitor uploads, and global documents as separate stores. Depict tenant/market/task/entity inputs and arrows to distinct selectors, not a universal combined selector. Label fields only as shown in E01. [I: E01–E03, E06–E08]

**S2 — Product-context decision flow.** Draw tenant match → conditional market rule → null-or-matching task contexts → product-or-null → compatible competitor association → labeled assembly → feature-extraction call → saved product features. Mark the default-market branch explicitly. [I: E02, E03, E09]

**S3 — Strategic authority substitution.** Draw eligible uploaded strategy? with “yes” leading to an authority-labeled excerpt and “no” leading to a generated equivalent with status/content checks. Show messaging and GTM roles separately; annotate newest-created first, 2,500-character uploaded excerpt, and no authorship attestation. [I: E04, E05]

**S4 — Typed-reference dispatch and budgeting.** Draw ordered kind/ID inputs, three store-specific eligibility branches, maps by ID, ordered reassembly, body truncation, and labeled prompt sections. Mark active/category requirements only on the global branch and tenant checks on the two tenant branches. Annotate nominal character allowances and marker overhead. [I: E07, E08, E12]

**S5 — Competitor labels and limited attribution.** Show active uploads → tenant filter → named body assembly → title-presence source-list derivation → battlecard result. Put a caution next to title collisions and separate the returned source metadata from the saved battlecard fields. [I: E10, E11]

**S6 — Optional unified pipeline.** Use dashed boxes for combined scope/applicability selection, authored-equivalent replacement, explicit globals, exact inclusion manifest, and optional output evidence linkage. Caption it “proposed embodiment; inventor confirmation required.” Do not draw it as an existing Orbit subsystem. [O: related E02–E13; missing combination and evidence linkage]

## 6. Candidate claim themes for counsel

These are technical themes, not final claims, opinions on validity, or guarantees of novelty. Counsel should assess support, eligibility, prior art, breadth, dependency, and method/system/computer-readable-medium forms using the actual application.

1. **Conditional scope plus task applicability:** tenant and conditional market selection followed by null-or-matching task contexts and product/competitor compatibility before prompt construction. [I: E02, E03; candidate implemented combination]
2. **Role-specific authority substitution:** select an eligible uploaded strategic document in place of a generated equivalent, with fallback only when no qualifying upload is found. Scope this theme to the inspected messaging/GTM path and its actual error behavior. [I: E04, E05]
3. **Typed multi-source resolution:** dispatch ordered kind/ID references to separately constrained stores, including active/category-gated globals, and reconstruct eligible labeled text in input order with bounded bodies. [I: E07, E08, E12; candidate implemented combination]
4. **Entity-labeled grounding and document-level attribution:** maintain competitor separation in assembled context and return associated source metadata, accurately describing the title-based approximation rather than exact provenance. [I: E10, E11]
5. **Combined eligibility, authority, and inclusion evidence:** join the preceding distinct mechanisms into a unified pipeline with a precise inclusion manifest. This is an optional theme only; existing components do not establish the whole combination. [O: E02–E13; confirmation required]

Potential engineering rationales include limiting irrelevant context, preferring supplied strategy over conflicting generated strategy, and making selected sources identifiable. These are design rationales inferred from the mechanisms, not benchmarked reductions in cost, latency, hallucination, or leakage, and not conclusions that the mechanisms differ from prior art. [I mechanisms: E02–E13; efficacy unverified]

## 7. Optional embodiments and explicit exclusions

| Optional item | Related evidence and gap | Required inventor confirmation |
| --- | --- | --- |
| O1: unified eligibility/authority/global pipeline | E02–E13 implement separate paths, not the complete sequence. | Confirm conception and specify ordering, conflicts, missing data, and which tasks participate. |
| O2: exact hard tokenizer budget | E08–E10 use character estimates, markers, and differing aggregation rules; E06 has no local grounding cap. | Identify tokenizer, reserved overhead, allocation policy, and treatment of oversized headers/documents. |
| O3: exact inclusion manifest and claim-level links | E10 uses title-presence inference; E12–E13 can record pre-resolution refs; E11 does not persist sources in the shown save block. | Specify IDs, versions/hashes, included ranges, truncation status, persistence, and how output assertions would be linked and checked. |
| O4: explicit priority, approval, or version history for all grounding | E01 has no grounding priority column or universal lifecycle; E04 uses newest-created first. | Identify intended ordering, authority conflicts, approval actors, version semantics, and actual implementation history. |
| O5: authenticated human authorship or policy validation of model output | E04 treats uploads as authoritative; E08 instructs the model but does not attest authorship or prove factual compliance. | Specify evidence of authorship, validation criteria, failure behavior, and human review. |

None of O1–O5 is asserted to exist in Orbit on the basis of this inspection. Do not describe universal user/team-level document scopes, comprehensive audit logs, immutable grounding snapshots, exact replay, or universal preview/approval as implemented without additional evidence. References to such variations in the supplied Orion/Vega summary do not establish Orbit support.

## 8. Inventor and counsel review checklist

### Technical facts for inventors

- Identify actual contributors to each mechanism and to any proposed combination; distinguish conception from later implementation.
- Confirm whether team-uploaded documents are genuinely human-authored, reviewed, or sometimes generated. Does “authority” reflect intended product behavior?
- Confirm intended default-market inheritance, null versus empty task tags, multiple eligible upload ordering, and whether explicit voice selection is intentionally tenant-wide rather than market-restricted. [Related I evidence: E02, E04–E08]
- Confirm whether any path outside this inspection combines strategic replacement with typed global selection; supply code and a concrete workflow before upgrading O1 to implemented.
- Confirm intended budget semantics and whether title-based sources and pre-resolution rewrite refs are acceptable descriptions of current attribution. [Related I evidence: E08–E13]
- Provide dated design notes, prototypes, commits, demonstrations, and disclosure records without assuming today's code existed at an earlier date.

### Matters reserved for patent counsel

- Obtain the original DOCX, review actual claims/specification/figures, and determine where supplemental material belongs and whether any filing has already occurred.
- Confirm inventorship and ownership/assignment. The supplied summary's named inventor and Synozur Alliance LLC assignee are unverified statements, not conclusions adopted here.
- Determine all applicable filing deadlines from actual disclosure, sale, publication, and filing facts. Do not rely on the attachment's January 2026/January 2027 assumptions.
- Assess foreign rights jurisdiction by jurisdiction. The attachment's speculation about Europe and China is not adopted.
- Conduct or commission the appropriate prior-art inquiry and assess novelty, non-obviousness, eligibility, written description, enablement, and claim scope.
- Decide which optional embodiments accurately reflect inventor knowledge, rather than treating this drafting aid as proof of conception or support.
- Reconcile terminology, figure numbering, claim dependencies, and any priority/new-matter issues before integration or filing.

## 9. Handoff and verification

Deliverables are this editable source and a matching Word review copy. No source application was integrated, no legal deadline was calculated, no filing was made, and no application behavior was modified.

Technical verification consisted of source inspection at the stated baseline, tracing the product import and rewrite routes through their selection/assembly calls, and checking the cited scope, ordering, budget, and attribution exceptions. Examples are reasoned from code, not live model runs. App tests or a visual app check would not validate this document-only disclosure. Counsel should retain the evidence table with the review draft, then decide what drafting notes and implementation details belong in the eventual application.
