# Arenzyra Monetization Decision

Decision date: 2026-08-04; evidence refreshed 2026-08-09

## Decision

Do not start a separate generic app. The recommended commercial hypothesis in
this workspace is **Arenzyra PUBG Production**: an assisted tournament
operations and broadcast workflow for PUBG Mobile organizers.

The planned customer outcome, after the release gates close, is one continuous
job:

> Turn an organizer's Discord or pasted slot list into a controlled match,
> live OBS output, reviewed results, standings, and Discord-ready publishing.

That is more defensible than another bracket manager because it joins the
Discord, observer/telemetry, review, and broadcast stages that organizers
otherwise run in separate tools.

This is a business hypothesis, not a promise of earnings. Validate willingness
to pay with real organizers before investing in more product surface.

## Availability gate

Do not accept payment for candidate software access or event services, or
represent the current candidate as generally available, until the end-to-end
release blockers are closed. Discovery calls and clearly labelled demo-data
walkthroughs can begin earlier, but they must not use customer credentials,
live room data, unsupported telemetry, or an unreviewed production write. Auto
Launcher remains request-only and must not be sold until its producer transport,
approved recording evidence, and installer verification pass the release gates.

## Why this wedge

- Generic competition management is inexpensive: Challonge offers a free tier
  and a Premier plan at $6.99/month when billed annually.
- Direct regional competition is aggressive: Xtallet advertises a free tier,
  a INR 199 per-event option, and INR 499/999 monthly plans with BGMI/PUBG
  registration, result extraction, and broadcast overlays.
- A higher-priced specialist position exists: PROPUBG advertises PUBG/BGMI
  tournament and OBS/vMix workflows starting at $55/month.
- FACEIT's organizer material validates the operational pain: match creation,
  automated results, notifications, moderation, organizer pages, and Discord
  integration are presented as organizer benefits.
- PUBG MOBILE's third-party event guidance makes live broadcast capability
  increasingly relevant at higher event tiers.

Therefore Arenzyra should not lead with "all-in-one tournament software." It
should lead with the harder-to-copy production pipeline and hands-on setup.

## First customer and offer

The first customer is a PUBG Mobile organizer who:

- runs recurring scrims or tournaments through Discord;
- currently moves slot, result, and standings data by hand;
- streams in OBS or wants a professional broadcast package;
- has at least one operator who can run an assisted test event; and
- can approve a small monthly operations expense.

For new candidate offers only, use **PUBG Production - $29.99/month** as the
planned primary founding offer after the release gates close. The intended
seven-day trial would start only when the approved owner successfully completes
secure account setup. The canonical API does not implement that contract yet:
it still requires an application password, lacks account-setup consumption, and
starts its trial at approval. Do not advertise or sell the intended behavior
until the canonical onboarding and held schema dependencies are integrated and
verified.

Treat $29.99 as a founding validation price for the first 5-10 customers, not a
proven permanent price. Arenzyra setup approval is not PUBG MOBILE publisher or
event-license approval; do not invite the organizer to complete account setup
and start the product trial while the workspace or required external
authorization is still unavailable.

Use **Discord Bot Pro - $18.99/month** as the intended low-touch downsell for
organizers who do not need broadcast production, and validate its actual setup
and support load. Use **Auto Launcher - $59.99/month** only as a request-only
private pilot after telemetry, approved-recording, approved-map, packaging, and
signing gates pass. Quote custom integration and live-event operations
separately. These candidate prices do not automatically reprice existing legacy
entitlements or the separate YouTube automation plans.

No commercial PUBG/KRAFTON map raster is currently bundled in the desktop or
Root release-source boundary. Thirteen unproven desktop rasters plus ten legacy
Root source rasters and their unused generator were recoverably quarantined;
the release metadata collector rejects reintroduction of the Root paths, and
production match startup fails closed without an approved selected-map asset.
Any future raster requires reviewed redistribution rights for the exact bytes;
an organizer's event license is not evidence that a SaaS or launcher vendor may
redistribute game assets. The exact Root inventory is preserved in the
[2026-08-09 quarantine record](../codex/ROOT_PUBGM_MAP_SOURCE_QUARANTINE_20260809.md).

The unproven 42-file Production Design visual package was also recoverably
quarantined and stripped from release output. Do not use those visuals in
sales, demos, or customer claims unless their exact-byte rights and branding
provenance are reviewed. These two quarantines do not establish that every
older repository asset is rights-cleared; broader provenance review remains a
release responsibility.

Preserve documented legacy deep links where they remain safe, and provide an
explicit transition path when security changes intentionally unpublish content
or expire credentials. Existing customers require an individual entitlement
inventory and reviewed transition; do not perform automatic repricing or a
blanket entitlement backfill. Reconcile them before the fail-closed candidate
is deployed. Reduce the main landing page to one recommended starting point.
Do not change paid access through an unaudited form submission; billing state
must remain a server-side, audited transition.

## What to build next, one by one

1. **Release safety.** Close authorization, tenant isolation, token, upload,
   dependency, backup, restore, and deployment gates before inviting customers.
2. **Proof package.** Publish one honest 60-second demo, three real product
   screenshots, and one labelled demo case study. Never use invented customer
   counts, uptime, testimonials, or time-saved claims.
3. **Assisted activation.** Give approved organizers a checklist from event
   creation to first reviewed/published result, with a visible support path.
4. **Ten design partners.** Contact qualified organizers directly and help each
   run one test event. Record objections and workflow failures.
5. **Privacy-safe funnel measurement.** Measure landing CTA, application,
   approval, first login, event created, first match controlled, first widget
   opened, first result approved, trial ended, and paid conversion. Do not put
   emails, names, Discord IDs, tokens, or free text in analytics events.
6. **Payment clarity.** Show region-appropriate payment instructions and an
   explicit pending/active/expired state. Automate billing only after the pilot
   proves conversion.
7. **Scale the winning step.** Build automation only for the repeated manual
   bottleneck observed across paying customers.

For every pilot, link the organizer to the current official third-party
tournament guidance. Arenzyra does not grant a tournament license or publisher
approval. Organizers remain responsible for licensing, non-affiliation
notices, broadcast reporting, entry-fee restrictions, sponsorship approval,
branding, and regional rules. Arenzyra remains separately responsible for the
rights and provenance of assets it bundles or distributes in paid software.

## What not to build now

- another general bracket engine;
- a player social network or consumer app;
- more games before PUBG Mobile activation works end to end;
- a marketplace, sponsor network, or affiliate catalog as the main business;
- additional widget styles while onboarding or reliability remains weak; or
- unsupported telemetry features marketed as official integrations.

## Thirty-day validation gate

Track this funnel by source and country:

`qualified contact -> replied -> demo -> applied -> approved -> activated -> paid`

Use these operational targets for the first 30 days:

- 100 carefully selected organizer contacts;
- 15 discovery conversations;
- 10 product demos;
- 5 approved trials;
- 3 organizers reaching a reviewed/published result; and
- at least 2 paying customers or a clearly documented price/workflow objection.

As a continuation gate once 10 customers have paid, require at least 7 of 10 to
renew into month three. Require at least 50% direct contribution margin and no
more than 30 minutes of average recurring support per customer-month; where
those thresholds conflict, the contribution-margin limit controls. Pause live
sales after any security incident, incorrect official publication, or severe
event outage until it is reviewed.

If demos do not convert to trials, revise the promise and target customer. If
trials do not activate, fix onboarding and reliability. If activated customers
will not pay, test packaging and regional per-event pricing before adding more
features.

## Revenue arithmetic

At the recommended price, before payment fees, foreign-exchange costs, hosting,
assisted onboarding/support labor, taxes, refunds, and discounts:

- 10 customers = $299.90 monthly recurring revenue;
- 25 customers = $749.75 monthly recurring revenue;
- 50 customers = $1,499.50 monthly recurring revenue.

The near-term objective is not scale; it is proving that a repeat organizer
will pay after one successful assisted event. Track support time and direct
contribution margin: $29.99 can be unprofitable if hands-on onboarding remains
labor-heavy.
Regional or per-event packaging is a fallback to test only after real organizer
interviews reveal a price or payment-method constraint.

As a sensitivity check, if non-labor direct cost is $5/customer-month and
operator time is valued at $25/hour, a 50% contribution margin at $29.99 allows
only about 24 minutes of direct labor in that customer-month, so this tighter
limit overrides the general 30-minute support ceiling under those assumptions.
Track one-time onboarding separately and either include it fully in first-month
margin or amortize it only across paid months actually realized. If assisted
onboarding remains above 45 minutes after the learning cohort, test a separate
setup fee or a $39.99-$49.99 Production price with a new cohort instead of
silently absorbing the work.

## Sources checked

Accessed 2026-08-05. These comparisons are directional, not like-for-like:
Challonge is a generic annual-billed competitor, Xtallet uses regional INR
pricing, and PROPUBG is a higher-priced specialist. The conclusion that live
broadcast capability becomes more important at higher PUBG MOBILE event tiers
is an inference from the publisher's third-party event guidance.

- [Current live Arenzyra offer (older mixed ladder)](https://arenzyra.com/)
- [PROPUBG product and pricing](https://propubg.com/)
- [Xtallet product and pricing](https://xtallet.com/)
- [Challonge pricing](https://help.challonge.com/pricing)
- [FACEIT PUBG MOBILE organizer guidance](https://support.faceit.com/hc/en-us/articles/10996374256540-How-to-organise-your-own-PUBG-MOBILE-tournaments)
- [PUBG MOBILE Esports Hub guideline](https://esports.pubgmobile.com/Documents/Esports%20Hub%20Guideline.pdf)
- [KRAFTON PUBG content creation guideline](https://www.pubg.com/en/clause/content_creation_guideline)
- [PUBG Developer Portal terms and trademark guidelines](https://developer.pubg.com/tos?locale=en)

Re-check competitor prices and official program terms before using them in
public sales material; they can change without notice.
