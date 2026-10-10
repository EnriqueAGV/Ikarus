# Praxia: completed work and remaining upgrades

Updated: 10 October 2026

This document replaces the status assessment in “Praxia: gaps and upgrades” dated 9 October. It combines that backlog with the repository implementation and [PR #28](https://github.com/EnriqueAGV/Ikarus/pull/28), which GitHub reports as merged on 10 October 2026.

## Current assessment

Dashboard booking and billing are implemented. They are no longer the largest missing features. The patient directory, human-response queue and patient detail have also received substantial workflow improvements, with the original soft visual style preserved.

The highest-priority remaining work is deployment isolation, launch documentation and operational reliability. Voice notes and unsupported attachments are the next important patient-facing improvements. Waitlists, automated after-visit messages and self-service onboarding can follow the initial clinic rollout.

“Implemented” means the feature exists in the code or merged PR history reviewed here. It does **not** mean that deployment, production configuration, vendor settings or real-clinic operation have been verified. No production database, live patient record or external-service configuration was inspected for this document.

## Status definitions

| Status | Meaning |
| --- | --- |
| Implemented | The feature exists in the reviewed code and merged history. |
| Improved in PR #28 | An existing feature received workflow, correctness or presentation improvements. |
| Partial | Supporting behavior exists, but the full requested outcome is incomplete or unverified. |
| Pending | The original item remains open. |
| Configuration unverified | Completion depends on settings or operational evidence outside the repository. |
| Deferred | A deliberate later-stage product enhancement, rather than an initial launch requirement. |

## Completed work

The earlier PR references below follow the supplied backlog and local merged history. Production activation remains a separate check.

| Area | Completed capability | Reference and qualification |
| --- | --- | --- |
| Front desk | Book and reschedule dashboard appointments; block calendar time for calls and walk-ins. | [PR #21](https://github.com/EnriqueAGV/Ikarus/pull/21). |
| Appointment messaging | Dashboard bookings enter the WhatsApp confirmation and reminder flows. | PR #21. Actual sending depends on connected numbers, template approval and operational eligibility. |
| Billing | Bank-transfer invoices, administrator payment recording, configurable free trial, and assistant/reminder suspension after coverage and grace periods expire. | [PR #23](https://github.com/EnriqueAGV/Ikarus/pull/23). Defaults: 30-day trial and 7-day grace. |
| Clinic information | Editable clinic FAQ/information used by the assistant. | PR #23. Clinic staff must supply and maintain the content. |
| No-show follow-up | A follow-up flow when staff mark an appointment “No asistió,” with a clinic setting to disable it. | PR #23. Sending conditions still apply. |
| Patient intake | Full-name and DUI collection, with separate handling for minors and escalation when an adult has no DUI. | PR #23. |
| Patient lifecycle | Archive and restore patients while retaining records. | PR #23; improved in PR #28. |
| Clinical record | Clinical notes linked to appointments and grouped by visit, signing and access history. | PR #23 and existing record implementation. |
| Prescriptions | Doctor-created prescriptions with medication instructions and print output. | [PR #24](https://github.com/EnriqueAGV/Ikarus/pull/24). |
| Record attachments | Doctor-only upload and retrieval of encrypted lab results/images, up to 4 MB per file. | PR #24. This is separate from processing incoming WhatsApp media. |
| Patient identity | Duplicate-record merging and WhatsApp-number editing. | PR #24; improved in PR #28. |
| Clinic reporting | Monthly appointment, no-show, booking and patient numbers in “Números.” | PR #24. This does not provide provider-token costs or margin per clinic. |
| Clinic location | Map coordinates from clinic settings, with location messaging after booking and when directions are requested. | PR #24. |
| Human handoff | “Por responder” queue for the clinic team. | PR #24; correctness and daily workflow improved substantially in PR #28. |
| Booking conversation | Assistant offers available times instead of always asking the patient for a date first. | [PR #22](https://github.com/EnriqueAGV/Ikarus/pull/22). |
| LLM resilience | A stuck LLM request has a default 30-second timeout per attempt, with retries. | [PR #20](https://github.com/EnriqueAGV/Ikarus/pull/20). This is not a 30-second end-to-end reply guarantee. |
| CI | Pull-request and main-push workflow runs migrations, type generation, TypeScript, lint, tests and build against disposable Postgres. | PR #23; [workflow](../../.github/workflows/ci.yml). |
| HTTP security | HSTS, frame protection, MIME-sniffing protection, referrer policy and permissions policy. | PR #23; [configuration](../../next.config.ts). |
| Database transport | Application and migration connection helpers default non-local database URLs to `sslmode=require`, unless an explicit SSL mode is already supplied. | [TLS helper](../../src/db/tls.ts). The original document reports Supabase Enforce SSL enabled; that external setting was not rechecked. |
| Dashboard appearance | Soft surfaces, pill controls, quieter secondary actions and restrained visual hierarchy. | [PR #25](https://github.com/EnriqueAGV/Ikarus/pull/25), agenda refinements in [PR #26](https://github.com/EnriqueAGV/Ikarus/pull/26) and [PR #27](https://github.com/EnriqueAGV/Ikarus/pull/27), and PR #28. |

## What PR #28 delivered

These changes improve existing features; they should not be counted as newly implementing booking, billing, prescriptions or attachments.

| Existing area | Improvement now implemented |
| --- | --- |
| Human-response queue | Explicit pending, follow-up and resolved states independent of assistant pause. Automated acknowledgments do not resolve human work. Handoff reason, urgency and unresolved-case age persist; new inbound messages while paused reopen pending work. |
| Queue completeness | Database pagination, global priority ordering before pagination, consistent counts, manual refresh and truthful empty states. |
| Patient directory | Labeled search, sorting, active/archive scopes, retained navigation context, pagination, and separate next live appointment and last completed visit. |
| Patient detail | Read-only summary with dedicated conversation, appointments, data, clinical and administration views. Inbox links open the conversation directly. |
| Forms and drafts | Entered values survive failed submissions. Validation focuses the failing field; unsaved work has clear save/cancel/navigation behavior. Drafts remain in memory, rather than patient-text browser storage. |
| Staff replies | Actual household recipient and service-window eligibility are visible. Durable submission attempts prevent repeated sends; uncertain outcomes retain drafts and block blind retries. Provider acceptance is not treated as proof of delivery. |
| Conversation history | Latest 50 messages first, reachable older history, preserved reading position, narrower bubbles and explicit patient/assistant/team attribution. |
| Duplicate records | Identity/conflict comparison, explicit same-person confirmation, stale-preview rejection and preservation of signed-document provenance. Shared-phone-only suggestions are removed. |
| Number changes | Review of current/new number and affected household members before confirming. |
| Archive/restore | Review of actual appointments to cancel, atomic archive/cancellation logging, stale-preview protection, actual cancellation counts and a clear warning that restore does not rebook cancelled appointments. |
| Intake reconciliation | Birth-date and DUI differences can be reviewed explicitly. Original answers are preserved separately from canonical decisions and review time. |
| Presentation and recovery | Loading/retry states, accessible review-dialog focus behavior, softer pill controls, restrained badges and readable desktop/mobile spacing. |

PR #28 adds migration `0014_conversation_attention`. Its rollout must apply the migration before the updated application serves requests. Existing paused active holders become pending at migration time; historical handoff times are not reconstructed. Merge status does not verify that this migration or the deployment succeeded in production.

Validation recorded for PR #28: 144 tests in 17 files passed with disposable Postgres and a fake WhatsApp provider; type generation, TypeScript, ESLint and production build passed. Synthetic browser checks covered form recovery, dialog focus and layouts at 320/390 px. Live authenticated Supabase/Kapso end-to-end operation was not exercised. See the [implementation report](../audits/ux-ui-implementation-2026-10-10.md).

## Remaining work: launch and operations

Priorities describe suggested delivery order, not verified legal requirements. Owners are proposed roles, not assigned people.

| ID | Item and current status | Work still needed | Completion evidence | Priority / owner |
| --- | --- | --- | --- | --- |
| OPS-01 | Preview database isolation — pending; external configuration unverified. | Audit Vercel preview and production database variables, including migration credentials. Give previews isolated data/credentials and define a controlled production migration path. | A preview migration demonstrably affects only its isolated database; production changes require the intended release path. | First / engineering + account administrator. |
| OPS-02 | Privacy notice, terms and processing agreements — pending professional review. | Have counsel review the actual data flows, notice, terms, clinic/Praxia agreement and applicable processor/subprocessor arrangements. Publish reviewed versions and track acceptance/versioning requirements. | Approved documents match the implemented product and actual vendors, with ownership and version records. | Before real-clinic launch / counsel + product owner. |
| OPS-03 | Incident and breach procedure — pending. | Write a concise runbook covering triage, containment, evidence, decision owners, vendor contacts and communication channels. Confirm any required notification conditions and deadlines with counsel. | Reviewed runbook, reachable contacts and a tabletop exercise with recorded results. | Before real-clinic launch / operations + counsel. |
| OPS-04 | LLM-provider data terms/settings — configuration unverified. | Identify the deployed endpoint/model/provider chain; review training, logging, retention, access and contractual settings. Reconcile these with the privacy documentation. | Evidence of the actual settings and agreements for every provider receiving data. | Before real-clinic launch / account administrator + counsel. |
| OPS-05 | Operational error alerts — partial. | Extend existing failure logging/handoff with an operator notification or monitoring destination; define severity, routing and noise control. Avoid patient content in alert payloads. | A controlled LLM/provider failure reaches the responsible operator, with useful context and a recovery path. | Early pilot / engineering + operations. |
| OPS-06 | Custom SMTP for device/sign-in codes — configuration unverified. | Verify the current Supabase sender and limits; configure a suitable SMTP service if needed and check delivery/rate behavior. | Successful delivery tests and documented provider/rate configuration. | Before onboarding multiple clinics / account administrator. |
| OPS-07 | Backup restoration — unverified. | Restore a backup into an isolated environment and exercise application access, encrypted records and required storage dependencies. Record recovery objectives and steps. | Dated restore exercise, checklist, results and recovery owner. | Before relying on the service for real records / operations + engineering. |
| OPS-08 | Signed-record encryption-key rotation — pending. | Design a controlled re-encryption mechanism that preserves signed-content immutability and auditability; include all relevant signed record types in the review. Do not broadly disable signature protections. | Authorized rotation succeeds without changing plaintext/signed content; prohibited edits remain blocked; old/new-key recovery is tested. | Before any key retirement / security + engineering. |

Important qualification for OPS-01: [vercel.json](../../vercel.json) currently runs `db:migrate` on every build. This confirms the build behavior, but **does not by itself prove** that previews use production credentials. That requires inspecting the deployed environment mapping.

Important qualification for OPS-05: [Inngest's existing failure handler](../../src/inngest/functions.ts) logs failures and calls the patient handoff fallback. PR #28 makes that human work visible; it does not add an operator alerting service.

The original document's legal statements, including its notification deadline, are not treated here as verified legal advice. Counsel should confirm the applicable rules before they become release requirements or customer commitments.

## Remaining work: patient and product upgrades

| ID | Item and current status | Work still needed | Completion evidence | Priority / owner |
| --- | --- | --- | --- | --- |
| PROD-01 | Voice notes — partial. | Verify Kapso transcript availability and implement a dependable audio/transcription path or explicit fallback. Cover download/access, failures, language, privacy and retention. | A real audio message produces a usable transcript and response; transcription failure produces a clear acknowledgment/handoff rather than silence. | Next patient-facing upgrade / engineering. |
| PROD-02 | Incoming photos/documents — partial storage/display support; acknowledgment workflow pending. | Detect unsupported incoming media, acknowledge receipt once and open human work with useful attachment context. Treat private-media retrieval separately from record uploads. | Image/document-only messages produce acknowledgment and an actionable queue entry, including retry/duplicate handling. | Next patient-facing upgrade / engineering. |
| PROD-03 | Complete patient-record copy — pending. | Add an authorized whole-record export/print flow with a defined scope, including the provenance of merged/signed records and the handling of attachments. | An authorized user can produce the agreed record copy; access is logged and unauthorized users cannot export clinical data. | Early pilot / product + clinical lead + engineering. |
| PROD-04 | Usage and cost per clinic — pending. | Capture available provider usage by run/model, including retries, and aggregate cost/usage per clinic. Define pricing sources and how missing usage is shown. | Per-clinic reports reconcile with sample provider usage and distinguish measured values from estimates. | Early pilot, before plan-pricing decisions / engineering + product owner. |
| PROD-05 | Waitlist and freed-slot offers — deferred. | Define priority, eligibility, consent, offer expiry and concurrent acceptance rules before implementing notifications. | A released slot is offered in the agreed order and cannot be double-booked; declines/timeouts progress safely. | After initial workflow validation / product + engineering. |
| PROD-06 | After-visit/control reminders — deferred. | Define an explicit, doctor-approved follow-up trigger, clinic preferences and message eligibility; avoid guessing clinical intent from free text. | Only eligible approved follow-ups send, without duplicates, with clear cancellation/opt-out behavior. | After initial workflow validation / clinical lead + engineering. |
| PROD-07 | Self-service clinic onboarding — deferred. | Extend the current administrator-led onboarding with account/business validation, setup recovery and the existing WhatsApp connection flow. | A clinic can complete setup without superadmin intervention, with the required account isolation and recovery states. | When manual onboarding volume warrants it / product + engineering. |

Voice-note qualification: [message extraction](../../src/lib/messaging/inbound.ts) already accepts `kapso.transcript.text`. However, no end-to-end transcription service was implemented in PR #28, and actual provider transcript availability was not checked. [Model history](../../src/lib/agent/run.ts) excludes messages without usable text. The gap is a reliable complete audio workflow, rather than an absolute inability to consume transcripts.

Media qualification: the dashboard's “audio/image/document received” labels help staff recognize message types. They do not mean the assistant acknowledges those messages or understands their content.

## Recommended sequence

1. Resolve or verify preview isolation immediately, and verify the production rollout of PR #28 and migration `0014`.
2. Complete the legal/vendor review, incident runbook, sender verification and backup restore exercise before depending on Praxia for real clinic records.
3. Add operator alerts and reliable incoming-media handling, starting with acknowledgment/handoff and then voice transcription.
4. Implement whole-record copies and per-clinic usage/cost reporting during the early pilot.
5. Revisit waitlists, after-visit automation and self-service onboarding with evidence from the first clinics. Prepare and validate key rotation before retiring encryption keys.

## Decisions already made and questions still open

- **Payment approach:** bank transfer is the current MVP choice. A card processor is deferred, not a missing MVP billing implementation.
- **First clinics:** identify the first paying clinics, doctors per clinic, front-desk staffing and expected message volume. These inform operational capacity and later assignment/filter features.
- **Deployment:** identify who owns preview isolation, production migrations and rollout verification.
- **Operational ownership:** identify who receives failure alerts and who leads an incident or restoration.
- **Document ownership:** assign the person responsible for vendor records, reviewed legal documents and the rollout checklist.
- **Pilot measurement:** measure response time, failed sends, identity mistakes and front-desk task completion. Assignment, background polling and advanced queue filters remain research-driven enhancements.

## Evidence and maintenance

Sources: the supplied 9 October gaps document, local repository files and merged history through the PR #28 head commit `d3ce8bd`, GitHub metadata confirming PR #28's merge, and the [UX/UI audit](../audits/ux-ui-audit-2026-10-10.md) and implementation report.

External deployment credentials, SMTP settings, provider contracts, backup history and legal requirements were not verified. Update an item's status when its completion evidence exists; record the PR or operational evidence and date. Keep implementation status separate from production verification so a merged feature is not mistaken for a tested live service.
