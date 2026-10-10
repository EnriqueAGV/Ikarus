# Praxia / Ikarus — UX/UI audit and change specification

**Date:** 10 October 2026

**Scope:** Por responder, Pacientes, patient detail, shared dashboard navigation

**Deliverable:** Findings and implementation recommendations; no application changes made.

## 1. Executive assessment

The interface has a coherent visual foundation: restrained clinic branding, clear typography for names, consistent white surfaces, and a strong blue primary action. The problem is that it presents a growing operational product as a sequence of forms and cards. Staff must interpret hidden states and scroll through unrelated information to complete their work.

The highest-value redesign is to organize the experience around three jobs:

1. **Attend a conversation:** identify why a human is needed, see the latest message, understand who owns the response, and reply or deliberately close the case.
2. **Find and identify a patient:** search a reliable directory, distinguish people who share a number, and see the next relevant appointment.
3. **Review or update a record:** read a compact summary first, edit deliberately, and use separate clinical and administrative areas appropriate to the role.

The most urgent finding is functional, not cosmetic. The waiting queue treats an outbound automated message as an answer. An emergency acknowledgment or agent fallback can therefore make a human handoff appear answered and remove it from the waiting badge. Fix the queue model before relying on a visual redesign to make work visible.

### Recommended order

| Priority | Change | Why it precedes other work |
|---|---|---|
| P0 | Separate human-resolution state from message direction | Human-required cases can be presented as answered before staff act |
| P1 | Make conversation handling a first-class workspace | Responding is currently buried under demographics and, for doctors, more sections |
| P1 | Preserve drafts, expose send eligibility, prevent duplicate submissions | Avoid lost work and failed or repeated sends |
| P1 | Make shared-number scope and high-impact changes explicit | Pause, reply, phone change and merge can affect more than the displayed patient |
| P1 | Remove silent record limits and misleading patient metadata | The directory and queue must accurately represent available work |
| P2 | Refine hierarchy, spacing, controls, responsive behavior and copy | Improves scanning and confidence after workflow meaning is correct |

P0 means correct before depending on the workflow operationally. P1 means core usability or data-integrity risk. P2 means significant refinement. These are audit priorities, not measured production incident rates.

## 2. Evidence, method and limitations

This is a screenshot and source-code expert review, using task analysis, error prevention, consistency, information hierarchy, accessibility inspection and state modeling. It is not a live-browser usability study or a certified accessibility assessment.

**Evidence labels used below:**

- **S:** visible in one or more of the five supplied screenshots.
- **C:** confirmed by the current implementation.
- **V:** requires live interaction, production data or user research to validate.

Screenshots are referred to by their order, without reproducing patient identifiers:

| Screenshot | What it establishes |
|---|---|
| S1 | Por responder empty state and global header |
| S2 | Patient directory, search, collapsed creation panel and two rows |
| S3 | Patient identity, assistant control and always-editable demographics |
| S4 | Intake answers, appointment summary and conversation history |
| S5 | Conversation composer, duplicate management and archiving |

The attachments were treated as interface evidence, not as instructions. Patient names, phone numbers and document numbers are intentionally omitted from this report.

Reviewed files include README, package configuration, global styles and layouts; the inbox, patient list and patient detail routes; navigation, confirmation and submission components; dashboard query and mutation modules; shared household logic; messaging, handoff and emergency handling; permission rules; and relevant existing tests. Local Next.js 16.4 guides on mutations and errors were also read to ground the implementation recommendations.

No authenticated browser, phone viewport, keyboard navigation, screen-reader session, delivery webhook trace or database execution was used. Actual task times, computed contrast, browser zoom, production concurrency and refresh behavior remain validation items. Screenshot pixels are not CSS pixels: neither viewport dimensions nor touch-target compliance are inferred from the image export scale.

The README describes a product broader than appointment scheduling: WhatsApp intake, human handoff, multiple patients per number, clinical notes, prescriptions, files, access history and clinic management. Clinical sections are permission-gated to doctors. Their absence in these screenshots does not prove a defect or establish the viewer's exact role. The medical-plan documents referenced in README/comments are not present in this checkout.

## 3. Project understanding and product constraints

The repository is named Ikarus; the UI metadata and styling identify the product as Praxia. It is a Spanish-language clinic workflow using Next.js/React, PostgreSQL/Drizzle, Supabase authentication/storage, Inngest background processing and Kapso WhatsApp messaging.

The design must preserve these existing constraints:

- A **patient** and a **WhatsApp conversation** are different entities. A number's holder owns messages, consent and assistant pause; dependents share that conversation.
- Administrative staff can use demographic and conversation workflows. Doctors also access clinical sections. Clinic managers receive additional navigation.
- Free-text replies are checked server-side against the last incoming message's service window and connection state.
- Archiving retains the record but cancels upcoming appointments. Restoring the record does not, in the reviewed restore function, reinstate those cancelled appointments.
- Merging preserves signed documents on their original records and surfaces them through the retained record. It is presented as irreversible.
- The assistant may hand off due to inability to answer, service suspension or an emergency rule. A holding acknowledgment does not establish that a human handled the issue.

Recommendations below are product and engineering proposals, not legal or clinical policy advice. Preserve existing permission checks, encryption and signed-document immutability during implementation.

## 4. Findings: Por responder

### IN-01 — Automated acknowledgments are mistaken for human resolution

**P0 · C · High confidence**

`pausedConversations()` defines waiting solely as the last message being inbound. `waitingCount()` uses the same direction rule. The agent fallback and emergency paths pause the assistant and then insert an outbound acknowledgment. Ordinary LLM handoff can also end with an outbound message. Those cases enter “Respondidas, con el asistente en pausa,” even though no staff member necessarily responded.

**Impact:** the badge can understate actionable work, and “Nadie está esperando al equipo” can coexist with unresolved human handoffs. The affected cases can include messages identified by the existing emergency detector. This is a confirmed code-path risk; its production frequency was not measured.

**Change:** model human attention explicitly on the conversation: open handoff, reason/category, opened time, responsibility and resolved time. Keep automated acknowledgment, staff response, case resolution and assistant pause as separate concepts. Persist the existing handoff reason, currently accepted by the tool but not saved in its handoff branch. Represent urgency as the system's operational flag, with staff review, rather than implying a clinical assessment.

**Acceptance:** automated fallback, emergency acknowledgment and a second automated outbound message never remove an unresolved handoff from the actionable count. A staff reply can move a case to a follow-up state; resolving it is an explicit operation. Queue rows and badge count use the same eligibility rules.

### IN-02 — The empty state gives too little operational assurance

**P2 · S1, C · High confidence**

The large card contains only “Nadie está esperando al equipo.” It provides no update time or explanation of which work this view includes.

**Change:** after IN-01, use “No hay conversaciones pendientes” with “Aquí aparecen las conversaciones que necesitan atención del equipo.” Show a truthful last-refresh time and an “Actualizar” action. If paused or follow-up conversations exist, offer a visible count/link. Distinguish loading, failed loading, zero pending, and zero filter results. Never display a success-like empty state on a data failure.

**Acceptance:** a new user can explain what will appear here. Refresh failure displays retry feedback and the last known data remains clearly marked, where available.

### IN-03 — Wait time measures the latest message, not the unresolved case

**P1 · C · High confidence**

Waiting age is calculated from the latest message. Repeated incoming messages can make an old unresolved issue look new. Ordering uses oldest latest-message first, while README wording suggests newest messages first.

**Change:** default to oldest unresolved case, with urgent operational flags surfaced first. Display “Pendiente desde hace 42 min” separately from “Último mensaje hace 3 min.” Offer newest-activity sorting as a secondary choice. Define whether an incoming message reopens a resolved case, and implement that consistently.

**Acceptance:** repeated patient messages do not reset unresolved age; sort choice is visible and stable. Counts and waiting duration share server-side definitions.

### IN-04 — Queue actions emphasize returning control rather than addressing the issue

**P1 · C; discoverability V**

The patient name opens the conversation, while “Devolver al asistente” is a direct row button. The reason for needing a human and a specific “Responder” action are absent. The resume function changes a boolean; it does not itself enqueue an immediate agent response.

**Change:** provide “Abrir conversación” as the main row action, show handoff reason and reply eligibility, and make resumption a deliberate secondary action. Use one label throughout the product, e.g. “Devolver al asistente,” followed by accurate explanatory copy about what happens next. Do not promise an immediate answer unless a guarded continuation flow is implemented.

**Acceptance:** staff see identity, reason, unresolved age, latest preview and available next step without opening the record. Resumption explains shared-number scope and cannot silently imply that the human issue was resolved.

### IN-05 — Queue completeness and freshness are not visible

**P1 · C; live staleness V**

The paused-holder query limits results to 200 without ordering before the limit; it sorts the retrieved subset afterward. The waiting badge counts across the full eligible dataset. The viewed UI has no subscription or timed refresh mechanism.

**Change:** apply priority ordering before retrieval and add pagination or bounded loading with a truthful total. Provide refresh first, then introduce controlled polling or subscriptions if operational volume warrants it. Preserve selected cases and drafts during updates.

**Acceptance:** a case outside the first 200 is reachable; global count and displayed subset are clearly distinguished. New work appears without requiring a full manual navigation cycle once refresh behavior is implemented.

## 5. Findings: Pacientes

### PT-01 — Page identity and creation hierarchy are weak

**P2 · S2, C · High confidence**

The page begins with search rather than a title. “Nuevo paciente” occupies a full-width card despite being a collapsed disclosure, and global CSS removes its disclosure marker. This makes a simple creation action visually resemble a major content section.

**Change:** introduce a header “Pacientes,” a truthful total and a prominent “Nuevo paciente” button. Open a compact create panel/dialog with required name and optional phone, birth date and sex. Retain an inline panel if it performs better with staff; add an explicit chevron and expanded-state affordance.

**Acceptance:** the page purpose, record scope and creation entry point are obvious without interpreting the navigation. A modal implementation supports focus management and return to the invoking control.

### PT-02 — Search needs labeling, recovery and persistent context

**P1 · C; layout risk S2/V**

Search has a placeholder but no explicit accessible label. The toolbar is an unwrapped flex row with a fixed-text archived link. Name and normalized phone matching exist, but there is no visible result count, clear-search action or directory sorting control. The back link from detail always returns to the base patient list.

**Change:** label the input “Buscar pacientes”; retain Enter/search-button behavior initially. Add clear search, result count, active/archived scope and a wrapping mobile layout. Preserve query, scope, sort and list position on detail/back navigation. Consider debounced search only after validating volume and network behavior.

**Acceptance:** formatted local and international phone searches work; empty-result feedback includes a clear-search action. Returning from a filtered archived record restores that directory context. Keyboard and assistive-technology users can identify the input.

### PT-03 — Appointment metadata can misidentify a future booking as the last visit

**P1 · S2, C · High confidence**

The query uses `max(startsAt)` across all appointments and the UI labels it “última.” This can be a future or cancelled appointment, not a completed visit. The count also combines all statuses.

**Change:** separate “Próxima cita” from “Última consulta atendida.” If total bookings are useful, name them explicitly. Prioritize the next live appointment, and show no upcoming appointment as a neutral state. Add doctor information only where it improves staff decisions.

**Acceptance:** a future booking is never described as the last attended consultation. Cancelled appointments do not become the next appointment, and count semantics are documented.

### PT-04 — “Esperando al equipo” means assistant paused, not actually waiting

**P1 · C · High confidence**

The badge depends on the patient's `agentPaused` field. Paused conversations may already have a staff response. Dependents share their holder's pause state, which the list does not derive; their own field may not reflect actual conversation control.

**Change:** use the conversation holder's state. Distinguish “Asistente en pausa,” “Pendiente de respuesta” and “Seguimiento del equipo.” Add a restrained “WhatsApp compartido” identifier when needed for disambiguation.

**Acceptance:** holder and dependents display the same conversation-control state; unanswered-work badges require actual unresolved work.

### PT-05 — The directory silently stops at 200 patients

**P1 · C · High confidence**

`listClients()` returns at most 200 rows with no page control or indication that more records exist. Sorting favors paused patients then recent registration, without explaining that order.

**Change:** server-side pagination, total count and named sorting. Start with 25–50 rows, then validate scan performance. On desktop use stable columns for patient, contact, relevant appointment and state; on mobile retain compact stacked rows. Preserve whole-row navigation and clear hover/focus affordance.

**Acceptance:** all matching patients can be reached, and “Mostrando 1–50 de 326” reflects actual data. Duplicate names can be distinguished without opening every record, using birth date or another appropriate identifier rather than revealing full DUI in the directory.

## 6. Findings: patient detail

### PD-01 — Primary operational work is below a large editable form

**P1 · S3–S5, C · High confidence**

The detail page begins with an extensive demographics form. Conversation and appointment actions appear lower down; doctors also receive clinical sections before the conversation. Even the inbox deep link lands inside a long record rather than opening a focused workspace.

**Change:** use a persistent identity strip and task-based sections: “Resumen,” “Conversación,” “Citas,” “Datos,” and “Expediente clínico” for doctors. Open inbox-originated navigation directly in Conversación. Open directory-originated navigation in Resumen. Keep uncommon maintenance actions in an overflow menu or a separate record-management section.

**Acceptance:** from an actionable queue row, latest context and composer appear immediately. Staff can find the next appointment and contact identity without scrolling through editing fields. Clinical access remains permission-gated on both server and UI.

### PD-02 — The screen defaults to editing, with no explicit unsaved-work model

**P1 · S3, C · High confidence**

Demographics are always editable. No dirty-state indicator, cancel action or pending submission control is present. Phone change and demographic save are separate forms, but their visual relationship can suggest a common save operation. Name creation is required; demographic update accepts a blank name.

**Change:** read-only summary with “Editar datos.” Group identification, contacts and preference into clear sections. Provide Save/Cancel, unsaved-change feedback and a policy for blank names. Keep WhatsApp identity changes separate and explain their effects. Prefer explicit save for administrative changes; do not introduce silent autosave for consequential number changes.

**Acceptance:** leaving an edited form warns or preserves the draft; cancel restores persisted data. Each save shows its own pending/success/error state. Required-field rules are consistent and intentional.

### PD-03 — Validation redirects risk discarding entered values and hiding errors

**P1 · C · High confidence**

Demographic and creation errors redirect to server-rendered pages using persisted/default values. The submitted field values are not returned. Record feedback appears near the page top while redirects target sections lower down. The reply flow also redirects, without carrying the message draft.

**Change:** return structured expected errors to the form, preserve submitted values and connect field errors with the relevant input. Use an error summary when multiple fields fail. Keep feedback adjacent to the action and announce it accessibly. Existing `SubmitButton` can support pending state; these reviewed forms do not use it.

**Acceptance:** invalid DUI does not erase other edits; failed send retains the complete draft; first invalid field is discoverable; repeated submit is locked while pending. Server validation and authentication remain authoritative.

### PD-04 — Shared-number identity needs to stay visible during messaging

**P1 · C; S3–S5 do not demonstrate a household case**

The header explains shared contacts when present, but the composer does not name the recipient. Assistant pause and staff replies apply to the number's conversation, not only to the displayed patient's record.

**Change:** display “Conversación con [contacto] · WhatsApp compartido” near the conversation header and “Enviar a [contacto], +503 …” beside the composer. Provide a compact list of linked patients and maintain a clear “Expediente de [paciente]” identity. Explain that changing assistant control applies to everyone using that number.

**Acceptance:** when a child's record is open, staff can distinguish the child from the parent receiving messages. Moving between household records preserves accurate recipient and conversation identity.

### PD-05 — The composer invites a reply that may be impossible

**P1 · C · High confidence**

The detail view renders the textarea and Send whenever a conversation has a phone. It does not expose closed-window or disconnected-clinic state before submission. The backend rejects those cases. The inbox already exposes part of this eligibility information.

**Change:** calculate common reply eligibility server-side and display it next to the composer: available, closing soon, closed, disconnected or no number. Disable impossible free-text sending with a visible reason; offer copying the phone/calling when appropriate. Add an approved-template path only if actually implemented and supported. Keep final eligibility validation on the server because time can expire while composing.

**Acceptance:** expired or disconnected states do not look sendable. Drafts survive expiry and failure. UI and backend agree at the exact boundary; currently the inbox uses `< 24h` and messaging rejects only `> 24h`.

### PD-06 — Conversation history starts at the wrong working position and is incomplete without explanation

**P1 · S4–S5, C · High confidence**

The query takes the latest 50 messages, reverses them and renders oldest-to-newest. There is no latest-message scrolling or older-history control in the viewed component. The screenshot shows earlier conversation content near the top. The timeline has its own scrollbar within a long scrolling page.

**Change:** in the dedicated conversation workspace, use one intentionally bounded timeline with its own fixed composer and contextual header. Open at the latest message; load older history explicitly and retain scroll position. When staff scroll upward, stop automatic jumping and show a “Nuevos mensajes” indicator. State when older history is available.

**Acceptance:** the latest patient message is visible on opening; older than 50 messages can be retrieved; appending a message does not interrupt reading older context. On mobile the keyboard leaves the composer and recipient visible.

### PD-07 — Message presentation needs narrower reading width and clearer attribution

**P2 · S4–S5, C · High confidence**

Long bubbles span up to 80% of a wide record, creating long lines. Timestamps are 10 CSS pixels in source. Outgoing messages have the same visual treatment, with only small “equipo/asistente” metadata. A privacy URL appears as raw text because message bodies are plain text. Non-text messages fall back to a raw type label.

**Change:** cap bubble width at approximately 560–640 CSS pixels while keeping it responsive; validate with long Spanish text. Use readable metadata, day separators and explicit “Asistente”/“Equipo” labels. Render recognized links safely. Provide meaningful attachment/location/button message summaries. Display delivery/read states only when grounded in provider events; acceptance by an API is not proof of delivery.

**Acceptance:** long URLs wrap without horizontal overflow; author is understandable without color; message type summaries are localized. Send success distinguishes accepted, delivered and failed states when those signals exist.

### PD-08 — Intake answers and canonical record data can diverge

**P1 · S3–S4, C · High confidence**

The supplied views show a document answer in “Respuestas por WhatsApp” while the canonical DUI field appears unfilled. Birth dates also use different formats. Intake is stored separately from demographics. The agent tool can fill birth date only when the record lacks it; demographic edits do not reconcile the intake answer.

**Change:** present “Datos recibidos por WhatsApp” as source information, with captured time and review status where stored. Map known fields to canonical data and allow staff to confirm or resolve differences. Preserve original answers as provenance. Do not silently overwrite reviewed data. If timestamps/provenance are absent, add them rather than fabricating them.

**Acceptance:** differing birth dates or DUI values generate a visible review state. Confirming a value updates the canonical record with an access-log event while retaining the original answer. Dates display consistently in Spanish; raw storage format is reserved for actual input requirements.

### PD-09 — Appointment context lacks actionable depth

**P2 · S4, C · High confidence**

Appointments display date, service and status, but not doctor or an action link. New appointment is offered within this lower card rather than in the patient header.

**Change:** place “Agendar cita” in the identity actions and summary. Separate upcoming from history. Show doctor and status, with a link into existing appointment actions; avoid replicating booking logic in this page. Explain when a cancelled or archived state blocks a next action.

**Acceptance:** staff can locate, open and manage the next appointment from the summary; cancelled and completed visits are visually separate from upcoming care.

### PD-10 — Duplicate suggestions conflate shared contact with same person

**P1 · C · High confidence**

Candidate matching includes the same phone number or coarse name matching. Legitimate family members can therefore be suggested as duplicates. The irreversible action is guarded only by a generic browser confirmation naming the discarded record.

**Change:** treat the same number as a contact relationship signal, not identity proof. Use a comparison flow showing both identities, birth dates, partially masked identifiers, conflicting fields, appointments, household relationships and record direction. State “Conservar [A]; unir [B] a este expediente.” Require deliberate review of conflicts; keep signed records immutable and preserve provenance.

**Acceptance:** legitimate household members are not presented as confirmed duplicates. Both identities and affected records are visible before merge, and the kept/discarded direction is unambiguous. Conflicts cannot be silently hidden by the current keep-existing-value rule.

### PD-11 — Archiving includes appointment cancellation but presents a generic confirmation

**P1 · S5, C · High confidence**

The explanatory text mentions cancellation, but the confirmation does not identify affected appointments or the cancellation count. Archive may sound like a housekeeping action. Restore only removes the archived state; it does not restore appointments.

**Change:** use a contextual dialog with the patient identity, upcoming appointments affected, preservation of records and clear cancellation consequences. State “Restaurar el paciente no recupera las citas canceladas.” Recheck effects at submission and show the actual result afterward. Keep archive in record-management actions rather than as a prominent always-visible card.

**Acceptance:** zero-, one- and multiple-appointment cases show accurate impact. Restoration copy does not promise appointment recovery. Partial cancellation/archive failure produces recoverable feedback; review transaction boundaries rather than assuming the operation is atomic.

### PD-12 — Number change affects households without a specific impact preview

**P1 · C · High confidence**

Changing a holder's number can move every dependent to the new number. Current conditional helper text describes this, but the action does not preview affected people or contrast old and new destinations.

**Change:** a dedicated “Cambiar WhatsApp” flow showing old/new number, affected patients and resulting shared-contact relationship. Confirm consequential changes before submission, without adding confirmation to ordinary demographic edits.

**Acceptance:** moving a household names the affected patients and clarifies conversation ownership. Invalid or already-in-use numbers preserve user input and produce a specific next step.

## 7. Recommended information architecture and screen composition

### Shared shell

Keep the recognizable clinic identity, light surfaces and blue brand. Reduce header dominance on smaller screens and maintain an explicit current section. “Por responder” is understandable; “Números” is less specific—test “Estadísticas” or “Resultados” with clinic managers. This is a terminology hypothesis, not a confirmed usability failure.

Preserve the existing top navigation for this iteration; a permanent sidebar is not necessary for six destinations. On narrow screens make horizontal navigation discoverable or introduce an accessible compact menu. The logged-in role/account can be available in a small account menu containing “Cerrar sesión,” rather than making logout the only account context.

### Por responder: suggested composition

| Region | Contents |
|---|---|
| Header | Por responder, actionable count, last refresh and Actualizar |
| Toolbar | Pendientes / En seguimiento / Resueltas; optional filters when volume supports them |
| Queue row | Contact identity, human-attention reason, operational flag, unresolved age, last activity, message preview, eligibility |
| Main action | Abrir conversación |
| Secondary actions | Assignment where implemented, explicit resolver/devolver controls |
| Empty/loading/error | Distinct, useful states with retry or explanation |

Do not make urgency or ownership controls decorative: these require persisted states and team agreement about what resolution means.

### Pacientes: suggested composition

| Region | Contents |
|---|---|
| Header | Pacientes, total in scope, Nuevo paciente |
| Toolbar | Labeled search, Activos/Archivados, named sort, clear filters |
| Directory | Patient identity, formatted contact, shared-number cue when relevant, next appointment, last attended visit, meaningful state |
| Footer | Visible range, total, pagination |
| Creation panel | Name required; optional contact/birth date/sex; clear household matching feedback; register/cancel |

### Patient detail: suggested composition

| Persistent region | Contents |
|---|---|
| Identity strip | Patient name, birth date/age when known, appropriate record identifier, active/archived state |
| Contact summary | Formatted number, number holder, shared-patient context |
| Primary actions | Agendar cita; clinical action for authorized doctors when available |
| Navigation | Resumen / Conversación / Citas / Datos / Expediente clínico, with optional More for management |

For conversation work on desktop, use a large conversation area with a narrower contextual panel for patient and appointment summary. Starting proportions of approximately two-thirds/one-third are a design proposal to test, not a mandatory ratio. Keep the recipient, assistant control and eligibility next to the composer. On mobile show one main area at a time and make context available without squeezing the chat into two columns.

The doctor's clinical view should surface verified allergies/conditions near clinical work, with a clear difference between unknown data and an explicitly recorded absence. This is an extension recommendation grounded in the code's clinical fields; the supplied screenshots do not show that experience.

## 8. Visual system specification

These values are proposed starting tokens in CSS pixels; validate with real content and devices before standardizing.

| Element | Proposed direction | Rationale |
|---|---|---|
| Page title | 24–28 px, semibold | Strong local hierarchy without competing with clinic identity |
| Section title | 16–18 px, semibold | Clearly groups work |
| Main content | 14–16 px | Operational reading and forms |
| Labels and metadata | 12–14 px; avoid 10 px message metadata | Keep supporting information readable |
| Inputs/buttons | 40–44 px default height; 44 px mobile target goal | Reliable everyday use |
| Spacing | 4/8/12/16/24/32 px scale | Shared rhythm and predictable grouping |
| Form width | Bounded sections; full width only for information that benefits | Avoid visually stretching short data fields |
| Chat bubbles | Responsive, bounded reading width | Long messages stay readable |
| Surface radius | 12–16 px panels, 8–10 px controls; pills for badges | Reduce the current uniform soft-card appearance |
| Elevation | Borders for routine grouping; shadow mainly for overlays | Make hierarchy reflect interaction |
| Primary button | Brand blue, distinct disabled/pending/error states | Existing strong color remains useful |
| Secondary button | Neutral surface and sufficiently visible outline | Distinguish secondary operations |
| Destructive action | Specific consequence in label/dialog, restrained red | Reserve visual alarm for actual impact |

The excess whitespace in S1/S2 is not automatically a failure: both contain little data. The problem is that the available space does not communicate useful status, and the one creation disclosure is disproportionately large. Avoid filling empty screens with invented metrics or decorative dashboards.

The existing maximum content width is reasonable as a shared shell. Apply task-specific internal widths and structure rather than simply widening everything. Keep restrained branding; icons should clarify a known action, not decorate every row.

## 9. Accessibility and responsive audit

The implementation already supplies Spanish document language, many real label/input relationships, a global focus-visible style, `aria-current` for navigation and a reduced-motion rule. Preserve these strengths.

### Confirmed structural gaps

- Directory search, duplicate search and reply textarea lack explicit accessible labels in the reviewed markup; placeholders should not be their only labels.
- Saved/error messages have no explicit status/alert semantics in these screens. Redirects do not by themselves guarantee appropriate announcements or focus.
- Removed disclosure markers weaken the visual affordance for Nuevo paciente, even though native details retains disclosure semantics.
- Guardian/emergency phone inputs use generic text fields rather than telephone input semantics.
- Long intake label/value pairs use an intrinsic-width grid that may overflow with long localized content; verify narrow screens.

### Contrast and focus verification

The source uses very light input borders and neutral-500 labels/timestamps. Static white controls on white cards may rely heavily on those borders. This is a concrete risk requiring computed-style measurements, not a blanket claim that all gray text fails.

Verify normal text at **4.5:1**, qualifying large text at **3:1**, and essential component/state indicators at **3:1** against adjacent colors. Decorative card outlines do not automatically need the same contrast as a boundary necessary to identify an input. See W3C's [text contrast](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html) and [non-text contrast](https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html) guidance.

Verify interactive targets against WCAG 2.2's **24 × 24 CSS pixel minimum or applicable spacing/other exceptions**. A **44 × 44** product target is recommended for touch comfort; it is not asserted as the WCAG AA minimum. See [target size guidance](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html).

Sticky header plus anchor links such as `#conversation`, `#datos` and `#duplicados` need live testing. Add appropriate scroll offsets and ensure keyboard focus is not entirely hidden by sticky content. See [focus not obscured](https://www.w3.org/WAI/WCAG22/Understanding/focus-not-obscured-minimum.html).

Use accessible live announcements for successful save/send, pending changes and relevant asynchronous errors without indiscriminately announcing every new chat bubble. See [status messages](https://www.w3.org/WAI/WCAG22/Understanding/status-messages.html).

### Responsive acceptance matrix

| Scenario | Required behavior |
|---|---|
| 320–390 CSS px | Search/tools wrap; no page-level horizontal overflow; labels and actions remain reachable |
| Tablet portrait | Context remains accessible without narrow two-column forms/chat |
| Common laptop heights | Latest conversation and composer fit the working area; header does not dominate |
| Wide desktop | Chat lines remain bounded; patient-list columns stay scannable |
| 200% zoom | Text/buttons remain readable and functional; sticky areas do not hide work |
| 400% zoom / reflow equivalent | Single-column use remains possible, subject to applicable content exceptions |
| Mobile keyboard open | Recipient and composer remain accessible; send control is not obscured |
| Keyboard only | Predictable order; visible focus; dialogs restore focus; no keyboard traps |
| Screen reader | Named inputs, state announcements and coherent section navigation |

## 10. State and copy specification

### Keep independent state dimensions

| Dimension | Example states |
|---|---|
| Human work | Needs response / Following up / Resolved |
| Assistant | Active / Paused; include reason where available |
| Responsibility | Unassigned / Assigned to staff member, if implemented |
| Reply eligibility | Available / Closing soon / Closed / Disconnected / No number |
| Patient record | Active / Archived / Merged |
| Submission | Idle / Pending / Accepted / Failed; delivery separately |

These states must not collapse into one ambiguous badge. A resolved case can still have a paused assistant. A paused conversation can contain multiple patient records. An API-accepted message may later fail delivery.

### Recommended Spanish copy

| Context | Suggested copy |
|---|---|
| Genuine zero pending | “No hay conversaciones pendientes” |
| Empty-state explanation | “Aquí aparecen las conversaciones que necesitan atención del equipo.” |
| Assistant mode | “Asistente activo” / “Asistente en pausa” |
| Staff takeover | “Atender conversación” with explanation of the pause scope |
| Consistent return action | “Devolver al asistente” |
| Resume explanation | “El asistente volverá a atender los nuevos mensajes de este WhatsApp.” Adjust if a continuation is implemented. |
| Shared destination | “Este WhatsApp se comparte con otros pacientes.” |
| Closed composer | “La ventana para responder por WhatsApp terminó. Puedes llamar al contacto.” |
| Sending | “Enviando…” |
| Accepted send | “Mensaje enviado” only with a defined meaning; use “Aceptado para envío” if representing API acceptance precisely |
| Intake provenance | “Datos recibidos por WhatsApp” |
| Edit summary | “Editar datos” |
| Merge action | “Revisar y unir expedientes” |
| Archived restore | “Restaurar paciente” plus “Las citas canceladas no se recuperan.” |

Use “clínica” or “consultorio” consistently with the product's business vocabulary; the screenshots currently mix clinic branding and consultorio messaging. Keep dates readable and consistent, e.g. “8 oct 2001,” and phone formatting consistent, e.g. “+503 7000 0000.” Do not assume all stored numbers are Salvadoran when formatting international contacts.

## 11. Implementation backlog and dependencies

Effort is relative: S = localized UI/query change; M = cross-component workflow; L = persisted state/migration or multi-step workflow. These are planning estimates, not delivery promises.

| Work item | Priority | Effort | Depends on | Done when |
|---|---|---|---|---|
| Explicit handoff/resolution model | P0 | L | State definitions | Automated acknowledgments retain actionable work; badge/list agree |
| Existing-data transition | P0 | M | New model | Paused cases have a conservative, reviewable migration policy; unresolved history is not silently assumed resolved |
| Queue ordering/pagination | P1 | M | State/query semantics | Global priority applied before limit; every case reachable |
| Reply eligibility and retained drafts | P1 | M | Shared conversation identity | Impossible sends explained before submit; failures retain text |
| Pending/idempotent send handling | P1 | M | Messaging contract | Repeated submits do not duplicate a logical send; ambiguous failures are recoverable |
| Conversation-first detail | P1 | L | Navigation/identity contract | Inbox opens current conversation immediately; latest-message positioning works |
| Household context and number preview | P1 | M | Shared identity | Recipient/scope/affected people visible at action time |
| Patient query semantics/pagination | P1 | M | Appointment definitions | Directory truthful, complete and navigable |
| Structured form errors | P1 | M | Error-return contract | Submitted values survive validation; errors stay with fields |
| Intake reconciliation | P1 | L | Provenance decisions | Conflicts reviewable without silent overwrite |
| Merge comparison | P1 | L | Identity/conflict policy | Retained record, conflicts and impacts reviewed before commit |
| Archive impact/restore explanation | P1 | M | Appointment effects | Accurate confirmation and actual outcome shown |
| UI tokens and accessibility pass | P2, with core access defects fixed earlier | M | Shared components | Named controls, readable contrast, focus and responsive checks pass |
| Assignment/advanced queue filters | P2 | L | Team research and workflow model | Added only if staffing/volume justify them |

### Proposed delivery phases

**Phase A — Make work truthful and prevent loss.** Fix handoff state and badge semantics, patient-list badges, directory appointment labels and silent limits. Add reply eligibility, pending states and draft retention. Surface recipient/scope. These changes should not wait for the full layout redesign.

**Phase B — Reorganize daily tasks.** Introduce patient identity/summary sections, conversation-first navigation, latest-message opening, history loading, stable search/back context and deliberate demographic editing. Establish common button/form/message components.

**Phase C — Strengthen record management.** Add intake reconciliation, merge comparison and archive/number-change impact dialogs, along with meaningful provenance and recovery behavior.

**Phase D — Validate and refine.** Run role-specific usability sessions, accessibility checks and realistic-volume scenarios. Add ownership/filtering only when evidence supports the extra interface and data model.

## 12. Engineering notes grounded in the repository

| File | Relevant responsibility / proposed change |
|---|---|
| `src/lib/dashboard/inbox.ts` | Replace direction-based waiting; shared badge rules; order before pagination |
| `src/lib/agent/tools.ts` | Persist handoff reason and open human work while preserving assistant behavior |
| `src/lib/agent/run.ts` | Automated acknowledgments must not resolve human work; emergency/fallback integration |
| `src/db/schema.ts` and a new migration | Persist attention/resolution/provenance fields as required |
| `src/app/app/[businessId]/inbox/page.tsx` | Row hierarchy, explicit open action, states, totals, refresh |
| `src/lib/dashboard/appointments.ts` | Patient pagination, holder-derived state, next/live and last/completed appointment queries, history paging |
| `src/app/app/[businessId]/clients/page.tsx` | Page title, labeled search, creation affordance, clear scope and list navigation |
| `src/app/app/[businessId]/clients/[clientId]/page.tsx` | Task sections, patient/recipient distinction, read/edit separation, eligibility and conversation layout |
| `src/app/app/[businessId]/actions.ts` | Preserve values through structured errors; consistent refresh; explicit case transitions |
| `src/lib/messaging/staff.ts` | Reusable eligibility, boundary consistency, delivery/failure handling and send idempotency |
| `src/lib/dashboard/patients.ts` | Merge conflict/impact preparation, phone impact and archive outcome consistency |
| `src/app/app/[businessId]/records-actions.ts` | New review-flow contracts without relaxing server authorization |
| `src/components/submit-button.tsx` | Existing pending-state foundation; use consistently and extend accessible feedback |
| `src/components/confirm-button.tsx` | Replace generic confirm for consequential operations with contextual review dialogs |
| `src/components/dashboard/nav-links.tsx` | Keep aria-current; validate overflow, resize and zoom behavior |
| `src/app/globals.css` | Shared control tokens, borders, disclosure affordance and sticky-anchor offsets |
| `src/lib/permissions.ts` | Preserve role boundaries through the redesigned routes and mutations |

Server Components remain useful for authorized initial reads. Add focused client components for drafts, form state, live conversation updates and dialogs; the audit does not justify making the whole dashboard client-rendered. Follow the installed Next.js mutation/error guides, not older assumed conventions.

Staff reply currently pauses before attempting the provider send; a failure may leave the assistant paused without a visible successful reply. Define and expose that state. Do not simply unpause on every failure: staff may intentionally have taken ownership. Also account for a provider-accepted send followed by database-write failure, where blind retry can duplicate a message.

Revalidation updates server data after a mutation; it is not a subscription for other open staff browsers. Verify consistent refresh across inbox, patient lists and badges. Concurrency requires explicit protection if assignment, resolution or record edits are introduced; a visual ownership label alone cannot prevent two staff members from acting simultaneously.

For existing paused records, latest-message direction cannot reliably reconstruct human resolution. Plan a conservative migration/review state, and test the operational backlog it may reveal. Avoid fabricating past handoff reasons or staff assignments.

## 13. Validation plan and measurable outcomes

### Meaningful regression scenarios

1. A patient sends a message; emergency handling sends an acknowledgment and pauses the assistant. The case remains actionable in the queue and badge until explicitly handled.
2. The fallback path sends an automated apology. It remains an unresolved human handoff.
3. A pending patient sends three additional messages. Original unresolved age remains; last activity updates independently.
4. A parent and child share a number. Both records show the same assistant mode and the actual message recipient; sending from the child's record uses the shared conversation.
5. Reply eligibility is tested just before, at and after the agreed service-window boundary, plus disconnected/no-number states.
6. A failed or timed-out send retains the draft; repeated clicks and ambiguous provider outcomes do not blindly duplicate it.
7. More than 200 patients and paused conversations remain navigable with globally correct ordering/counts.
8. A patient has a completed past visit, cancelled booking and future live booking. Last attended visit and next appointment are correct.
9. Invalid DUI or birth date preserves all other demographic edits and exposes a field-associated error.
10. Intake and canonical birth date/DUI differ. Review resolves the conflict without deleting provenance.
11. A legitimate household member shares a number. The duplicate review does not imply identity equality; intentional merge displays both records and conflicts.
12. Archive with zero/one/many upcoming appointments previews effects; restore does not imply cancelled visits return.
13. Archived, merged and active records expose appropriate actions; server checks reject inappropriate mutations.
14. New messages arrive while staff read older history or compose. Scroll position and drafts remain stable.
15. Filtering, opening a record, then returning restores query, archived scope, sorting and directory position.

Existing dashboard, records and agent tests cover underlying send, archive, merge and basic queue behavior, but the reviewed queue test uses simple last-message-direction fixtures. Add automated-acknowledgment cases and tests for the new semantics. UI accessibility and interaction checks should cover real keyboard and responsive behavior, not just mirror implementation markup.

### Usability sessions

Test with a small formative sample of reception/assistant staff and doctors, including clinic managers where available. Start with 5–8 participants across roles, and iterate based on observed failures rather than treating that sample as statistically representative.

Tasks should include answering a handoff, locating a duplicate-name patient, responding from a shared-number record, correcting an invalid form, dealing with an expired reply window, booking from a summary, reviewing a suspected duplicate and archiving a patient with a future appointment. Include people using touch and keyboard navigation.

### Metrics and suggested goals

These are initial goals to refine after measuring a baseline, not claimed current performance.

| Metric | Initial goal |
|---|---|
| Handoff acknowledged by automation but missing from actionable work | Zero in regression scenarios |
| Queue → composer access | One explicit opening action, without record-form scrolling |
| Find correct patient in common search task | ≥90% successful completion in formative sessions |
| Identify actual shared-number recipient | All tested participants identify correctly before sending |
| Failed validation/send causing lost input | Zero in covered recovery scenarios |
| Incorrect next/last appointment interpretation | Zero in semantic regression scenarios |
| Repeated logical send from double submission | Zero in covered concurrent/retry scenarios |
| Reply completion time | Meaningful improvement against measured baseline; set target after baseline |
| High-impact action comprehension | Participants accurately name retained record/affected appointments before confirmation |

Use aggregate workflow telemetry where appropriate. Do not include message bodies, DUI values or clinical data in analytics event payloads. No production telemetry or incident frequency was analyzed here.

## 14. Final recommendation

Keep the existing brand foundation and change the workflow structure. Correct the definition of unresolved human work first; give conversations their own operational workspace; make the directory complete and truthful; then introduce deliberate editing and contextual review for record-management actions.

A professional result will be demonstrated by staff being able to identify the patient and recipient, understand the current state, choose the next action and recover from failure without searching the page or losing their work. Visual polish should support those outcomes.
