# UX/UI audit implementation — 10 October 2026

This records the implementation of the [audit](ux-ui-audit-2026-10-10.md). Changes are in the local working tree. No production migration, deployment, real patient update or real WhatsApp send was performed.

## Delivered

| Audit findings | Changes |
| --- | --- |
| IN-01, IN-03, IN-04 | Human work has explicit pending, follow-up and resolved states, independent of assistant pause and message direction. Handoff reasons, urgency and unresolved-case age persist. Automated acknowledgments retain human work; incoming messages while paused reopen it. Resolution rejects a stale message preview. |
| IN-02, IN-05 | Truthful empty states, consistent menu counts, manual refresh with a loaded timestamp, status filters and global ordering before pagination. |
| PT-01–PT-05 | Named page header and prominent creation action; labeled search and sort; active/archive scopes; clear no-results recovery; preserved directory context; real next live appointment and last completed visit; separate conversation/assistant badges; 25-row database pagination. |
| PD-01, PD-02 | Read-only summary by default; dedicated views for conversation, appointments, data, clinical record and administration. Inbox opens the conversation directly. Demographic editing is an explicit disclosure. |
| PD-03 | Structured action results preserve entered values, pending submissions lock controls, validation focuses the failing field, and save/cancel/unsaved-work states are visible. |
| PD-04, PD-05 | Actual household recipient and phone remain visible in the messaging workspace. Shared-number effects and the 24-hour eligibility deadline are explained before sending. Archived/merged records are read-only. |
| PD-06, PD-07 | Latest 50 messages load first, previous history is reachable, earlier reading position is preserved, and new messages do not automatically pull readers away. Bubbles have bounded widths, author labels, date separators and safe link rendering. The composer remains separate from the scrolling history. |
| PD-08 | Intake differences for birth date and DUI can be reviewed explicitly. Received answers stay unchanged; the canonical decision and review time are stored separately, encrypted and access-logged. |
| PD-09 | Upcoming appointments and history are separated; doctor, status and agenda links provide operational context. |
| PD-10 | Same-phone-only suggestions are removed. Merge previews compare identifying/demographic values, expose conflicts and shared-contact effects, require same-person confirmation, and reject changed records. Signed documents retain their origin. |
| PD-11 | Archive review lists the actual future appointments to cancel. Cancellation, archive and audit logging are transactional; stale appointment lists are rejected. The outcome reports the cancellation count. Restore explains that cancelled appointments remain cancelled. |
| PD-12 | Number changes require a review with current/new phone, patient identity and affected household members. Existing protections against accidental family combination remain in place. |
| Shared UI | Consistent primary/secondary controls, improved labels and contrast, wrapped detail navigation, accessible native review dialogs with focus return, reduced-motion support, loading and recoverable error states. Global navigation remeasures its active indicator on resize. |

## Messaging recovery and state contract

- `agent_paused` controls future automated replies; `attention_status` represents outstanding human work.
- A successful staff send means the provider accepted the message. It does not assert delivery or reading.
- A durable, actor-scoped attempt token prevents repeated submissions from duplicating a logical send. Its content digest prevents reusing the token for different text.
- Pending or uncertain attempts retain the draft and block automatic retry. Staff can refresh and inspect WhatsApp before deliberately preparing another attempt.
- Drafts stay in component memory; no patient message text is persisted in browser storage. Navigation/reload warns about unsent work, but drafts do not survive closing the page.
- Queue freshness uses manual refresh. Background polling and team assignment were not added without the staffing and volume research recommended by the audit.

## Database release requirement

Run the repository migration process before serving the updated application. `drizzle/0014_conversation_attention.sql` adds encrypted intake review and handoff reason fields, explicit attention state, its queue index, and the RLS-enabled staff submission-attempt table.

Existing paused active holders become pending at migration time. That timestamp is deliberately a review baseline; it is not presented as a reconstructed historical handoff time. Existing intake answers are not inferred to have been reviewed.

The migration was exercised on a disposable Postgres 16 database, including an existing paused contact migrated from the previous schema. The final migration also passed from an empty database. Production was not changed.

## Verification

- All 144 tests in 17 files passed against an isolated, migrated Postgres database and fake WhatsApp provider.
- Regressions cover automated acknowledgment retention, urgency/age preservation, incoming-message reopening, stale resolution, more than 200 patients, global queue priority, appointment metadata, shared-holder status, stale archive and merge rejection, intake provenance, repeated/content-changed/uncertain sends, and the exact service-window boundary.
- Type generation, TypeScript, ESLint and the production build passed. Build checks used disposable database settings and placeholder external-service credentials.
- Browser interactions exercised the real reusable form and conversation components using synthetic fixtures: failed-send draft retention, invalid-field focus, preservation of other edits, review-dialog focus return, latest-message positioning, and no horizontal overflow at 390 px and 320 px. The temporary fixture route and server were removed.
- Authenticated end-to-end use with live Supabase/Kapso was not exercised. Existing role/access tests passed; clinical sections remain role-gated.

## Research and rollout validation

The audit's usability sessions, baseline metrics, live assistive-technology testing and staffing research remain validation work, rather than implemented product features. Test realistic reception workflows and household cases before deciding on assignment, advanced filters or terminology changes such as renaming “Números.” Measure time to find/reply to a case, failed sends and mistaken identity selections after rollout.

## Visual refinement after review

Restored the original restrained appearance while retaining the workflow changes: pill controls, soft form outlines, white selected segments on grey navigation tracks, sentence-case list headings, increased card spacing, and fewer decorative status badges. Secondary information uses quiet text; blue is reserved for primary actions and navigation links. Merge and intake review actions use neutral buttons; archiving uses a restrained red action. Labels, keyboard focus rings, pending states, confirmation dialogs and shared-contact context remain visible.

Desktop visual review used synthetic fixtures and the shared production styles/components. Narrow layouts were checked at 390 px and 320 px without horizontal overflow; the conversation timeline retained a readable bounded height. The temporary preview route was removed. This pass changes presentation, not the database or workflow state contract.
