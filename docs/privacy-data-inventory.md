# Arenzyra Privacy and Data Inventory

Status: engineering inventory for review. This is not legal advice and does not
replace a counsel-approved privacy notice, terms, data-processing agreement, or
regional compliance analysis.

## Required business inputs

The public legal documents cannot be finalized until the operator supplies:

- legal entity/trading name;
- registered and contact address;
- privacy and support contacts;
- governing law and dispute jurisdiction;
- countries in which Arenzyra actively sells or operates;
- age policy and whether minors' data is intentionally processed;
- approved payment, email, hosting, AI, analytics, and support subprocessors;
- commercial refund, cancellation, trial, support, and service-level policies.

## Data classes

| Data class | Examples | Source | Primary purpose | Sensitivity notes |
| --- | --- | --- | --- | --- |
| Account identity | Name, email, role, password hash, status | Applicant/admin/user | Authentication and account administration | Credential/security data |
| Organization/contact | Organization name, country, Discord username, WhatsApp, website, contact message | Applicant/organizer | Qualification, onboarding, support, billing | Direct contact data |
| Authentication/session | Refresh-token hash, IP, user agent, login/revocation timestamps, impersonation actor | Browser/API | Session security, fraud response, audit | Security telemetry |
| Discord configuration | Guild, channel, role, user and message IDs; command/action records | Discord/API | Registration, staff workflows, result publication | Platform identifiers; may include community members |
| Tournament/team/player | Event names, teams, player names/IGNs, IDs, slots, bans/no-shows | Organizer/Discord/import | Tournament operation and integrity | Can include minors/pseudonyms |
| Player media | Logos, avatars, player photos | Organizer/player/public source | Registration and broadcast output | Biometric-like images are not used for identity matching unless explicitly added |
| Match telemetry | Player/team state, kills, position/map events, device/source metadata | Desktop/provider | Live operation, integrity, replay/debug | High-volume behavioral/game data |
| Results | Screenshots, OCR text/confidence, manual corrections, placements, kills, standings | Organizer/AI/API | Reviewed official result production | Screenshots may contain unrelated visible data |
| Studio/media | Designs, fonts, images, review comments, published assets | Organizer/reviewer | Broadcast creative production | User-created content and possible copyrighted assets |
| YouTube | OAuth tokens, channel/chat/comment/message IDs, automation settings and audit events | YouTube/organizer | Optional channel automation | OAuth and audience interaction data |
| Shop/seller | Seller profile, products, leads, reports, jersey orders, proof links | Seller/customer/admin | Optional marketplace operations | Contact/order/commercial data |
| Billing/support | Plan/add-ons, trial and paid-through status, invoice/payment method, private proof, support request | Organizer/admin/payment service | Access, renewal, reconciliation, support | Financial evidence; avoid card/bank credential storage |
| Operational/audit | Request/correlation ID, actor, resource, action, outcome, redacted error, service health | Services | Reliability, security, incident response | Never log secrets, raw tokens or unnecessary payloads |
| Product funnel | Event name, coarse plan/placement/category/result, timestamp | Browser/server | Aggregate activation and conversion measurement | No email, Discord ID, match payload or free text |

## Processing map

```text
Applicant/browser
  -> Caddy/web/API
  -> PostgreSQL and private object/file storage

Desktop observer
  -> authenticated telemetry ingress
  -> retained raw events / canonical live state
  -> OBS and organizer consumers through scoped tokens

Organizer screenshot
  -> private upload
  -> bounded local preprocessing/OCR
  -> optional disclosed external AI processor
  -> reviewed result

Discord/YouTube
  <-> scoped integration credentials and platform APIs
  -> Arenzyra workflow/audit records

Backups
  -> encrypted off-host recovery storage
```

## Engineering minimization rules

- Do not collect a password with a pending application. Issue an expiring,
  single-use setup invitation only after approval.
- Store refresh, reset, invite, service, broadcast, and API credentials only as
  hashes where the plaintext is not required for an outbound integration.
- Do not put tokens, passwords, OAuth codes, payment evidence, screenshots, or
  free text into analytics or logs.
- Do not store full payment-card, bank-login, wallet-secret, or identity
  document data. Redirect to an approved payment processor where applicable.
- Store only Discord/YouTube scopes and records required for enabled workflows.
- Keep raw telemetry and screenshots for the shortest period needed for
  integrity, correction, replay, billing dispute, and incident investigation.
- Remove EXIF/metadata and re-encode images before durable publication.
- Public publication must be an explicit organizer action or a scoped
  broadcast-token read; tenant IDs and slugs are not publication consent.

## Proposed retention schedule for business approval

These are conservative engineering defaults to validate with legal and business
requirements before production enforcement.

| Record | Proposed default | Deletion/anonymization trigger |
| --- | --- | --- |
| Rejected/pending application | 90 days after final activity | Delete contact/message and unused credential artifacts |
| Password reset/setup token | 30–60 minutes, single use | Delete/revoke on consumption, replacement, or expiry |
| Refresh session | Until configured session expiry | Revoke on logout, reuse, password reset, disable/delete |
| Authentication security event | 180 days | Aggregate or delete after incident/fraud window |
| Audit event for official/admin action | 1–2 years | Retain minimum actor/action proof; redact payloads |
| Raw match telemetry | 30–90 days after event | Keep only approved derived/final facts afterwards |
| Result screenshot/OCR intermediate | 30 days after final approval/dispute close | Delete source and temporary variants |
| Official result/standings | Organization contract/event lifetime | Delete or anonymize under account/event deletion policy |
| Unpublished Studio draft/media | 90 days after workspace/account inactivity | Delete drafts and orphaned assets |
| Published broadcast asset | Until organizer unpublishes/account closes | Revoke token and purge CDN/cache according to capability |
| Discord operational messages/cache | 30–90 days unless needed for an active event | Delete stale reconciliation/import data |
| Product funnel event | 13 months maximum | Aggregate sooner; no user-level profile required |
| Support/billing correspondence | Contract plus applicable accounting/dispute period | Delete sensitive attachments earlier where possible |
| Encrypted backup | 30–90 day rolling schedule | Cryptographic/physical expiry; honor deletion after rotation |

Retention jobs must be idempotent, tenant-aware, dry-run capable, auditable, and
must never delete official results or evidence subject to an active dispute or
legal hold.

## External processor register to complete

Record for each processor: legal entity, service, data classes, purpose,
regions, transfer mechanism, contract/DPA link, retention, security contact,
subprocessor list, incident terms, deletion/export capability, and owner.

Expected categories include:

- production hosting and off-host backups;
- transactional email;
- Discord;
- YouTube/Google OAuth;
- optional OpenAI or other OCR/AI provider;
- payment/invoice provider;
- error monitoring/observability;
- privacy-respecting product analytics;
- customer support and communications.

No processor should receive production data merely because an integration key
exists. Each integration is disabled until configured, approved, scoped, and
documented.

## User and organization operations to support

- Export account, organization, team/player, event, result, media, integration,
  billing, and audit data in a documented portable format.
- Correct account/contact/team/player data without rewriting immutable official
  audit history.
- Revoke sessions, service keys, broadcast URLs, Discord/YouTube connections,
  and OAuth tokens.
- Delete/anonymize an account or organization after authorization, dependency,
  accounting, dispute, and legal-hold checks.
- Delete individual draft media/result screenshots independently of official
  derived results where possible.
- Record request receipt, identity/authority verification, actions, exceptions,
  completion date, and operator without exposing the request publicly.

## Security controls tied to privacy

- Tenant isolation at API, job, WebSocket, storage, cache, and database layers.
- Secure HttpOnly refresh sessions, MFA for platform administrators, bounded
  anonymous endpoints, and atomic token rotation/reuse response.
- Private uploads, signed publication URLs, file validation/re-encoding, SSRF
  protections, and per-tenant AI quotas.
- Encryption in transit and at rest, encrypted off-host backups, tested restore,
  secret rotation, least-privilege containers and database roles.
- Structured security/audit events without secret or payload logging.
- Incident runbook defining detection, containment, evidence preservation,
  processor coordination, legal assessment, notification decision, recovery,
  and post-incident remediation.

## Review cadence

Review this inventory before enabling a new integration or data category, after
a material architecture change, at least annually, and after an incident. Link
each public privacy claim to an implemented control, owner, test, and retention
job.
