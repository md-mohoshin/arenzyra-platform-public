# Redis reliability and distributed request protection

The API owns Redis through one global `RedisModule`. Feature modules import that
module and consume the same `RedisService`; they must not declare their own
`RedisService` provider.

## Redis client lifecycle and pub/sub

`RedisService` keeps separate publisher and subscriber clients for the lifetime
of the Nest application. A transient error marks a client unavailable but does
not discard it, allowing ioredis to reconnect normally. Channel reconciliation
serializes subscribe/unsubscribe changes and rechecks the current listener set,
so an unsubscribe followed immediately by a resubscribe cannot lose the new
listener. Failed Redis subscription operations use one bounded, unref'd retry
timer per channel.

The lightweight `RedisService.publish` pub/sub helper is intentionally
best-effort and local-first. It isolates synchronous and asynchronous local
handler failures, tags Redis publications with an instance identifier, and
ignores its own Redis echo. This helper is not a durable event transport and a
Redis publish failure is not reported as a successful cross-instance delivery.

In the candidate source, `/health/ready` requires the publisher, subscriber,
and all active pub/sub channels to have converged when Redis is required. This
health contract is not yet deployed to the live production release.

## EventBus activation and publication contract

EventBus uses Redis Streams, not Redis pub/sub. A default subscription has an
explicit asynchronous activation barrier:

1. `subscribe()` immediately returns a callable unsubscribe handle with a
   `ready` promise.
2. The stream reader captures the current latest stream ID with `XREVRANGE`.
3. `ready` resolves with `{ mode: "distributed", boundary: "<stream-id>" }`
   only after that concrete cursor is installed and locally queued events have
   either been attempted or transferred to bounded Redis-stream catch-up.
4. Events committed at or before the returned boundary predate activation and
   are not promised to that subscriber. Every valid EventBus-produced entry
   after the boundary is read from the concrete cursor while it remains
   retained in the stream; malformed externally written entries are rejected.

The synchronous return from `subscribe()` is therefore not a no-loss barrier;
callers that need an active concrete cursor must await `subscription.ready`.
All eight currently inventoried application EventBus subscriptions do this
from async `onModuleInit` hooks. A static inventory test fails if a new source
consumer is added without an explicit awaited `.ready` barrier. Consumers
register all their subscriptions first and then await all activation promises,
so Nest startup cannot complete while a configured distributed consumer is
inactive. If Redis is configured but unavailable, those hooks remain pending
until activation.

The pre-activation local queue is capped at 256 entries. If a burst fills that
queue, the subscriber switches to bounded stream catch-up: it clears the local
payload queue, retains only scalar attempted/catch-up high-water IDs, and lets
`XREAD` deliver retained post-boundary same-instance entries that were not
already attempted locally. Normal self-echo suppression resumes after the
high-water mark. Activation does not wait for that retained backlog to be fully
handled, so `ready` means the concrete reader is active, not that every
post-boundary event has already finished processing.

When Redis is intentionally disabled, `ready` resolves immediately in
`local-only` mode. An explicit `fromStart` subscription resolves at boundary
`0-0`. Unsubscribe or shutdown settles a still-pending activation as
`cancelled`.

Publication follows these rules:

- Event type, timestamp, retry metadata, JSON serialization, and UTF-8 payload
  size are validated before any dispatch.
- With configured Redis, `XADD` with approximate bounded `MAXLEN` completes
  before same-process delivery. An exception or missing stream ID raises
  `EventBusPublishError`; local handlers are not run.
- `XADD` is never retried automatically. A timeout can be ambiguous because
  Redis may have committed the append before the connection failed; retrying
  could create a duplicate event. Callers must surface or reconcile that
  uncertainty rather than replay an entire business mutation.
- With intentionally disabled Redis, publication is local-only.

An EventBus append is not atomic with a PostgreSQL business transaction and is
not a transactional outbox. A caller that needs database-and-event atomicity
must use a durable outbox/reconciliation design rather than treating `XADD` as
part of the database commit.

Handler retry is per subscriber. A successful subscriber is not invoked again
because another subscriber failed. Only the failed handler is retried directly,
with bounded exponential delay, bounded unref'd timers, and cancellation on
unsubscribe or shutdown. A nested `EventBusPublishError` or
`EventBusPayloadError` is terminal for that handler attempt, preventing an
automatic replay of business work that ran before the failed nested publish.

These retries are in memory; they are not a persisted consumer acknowledgement
or dead-letter queue. A same-process Redis reconnect resumes the last concrete
cursor. A full process restart establishes a new default boundary, so default
subscriptions do not replay events produced while the process was down.
Approximate stream trimming can also remove an event before a sufficiently slow
reader reaches it. The resulting guarantee is an at-least-attempt delivery for
retained post-activation events during the active process, not exactly-once
processing or durable consumer recovery.

## Capacity policy

EventBus payloads default to 512 KiB and are capped at 1 MiB. Streams default to
an approximate maximum of 10,000 entries and are capped at 50,000. Local
activation queues and subscriber retry queues also have hard per-subscription
limits. If an activation queue reaches its limit, it is cleared and the reader
uses a bounded stream-ID high-water mark to catch up retained same-instance
events from Redis; the normal self-echo suppression resumes after that mark.

The supported production Compose candidate configures Redis with a finite
`maxmemory` and `maxmemory-policy noeviction`. Evicting security rate-limit keys
or event-stream entries under generic LRU pressure is forbidden. Candidate
readiness checks Redis `INFO memory` and fails when memory is unbounded, the
policy is not `noeviction`, the response is invalid, or usage reaches the
configured readiness ratio. Once Redis reaches its hard memory ceiling, writes
fail explicitly; operators must add capacity or reduce load, not prune
persistent volumes.

## Rate-limit policies

All rate-limit Redis and local keys are SHA-256 digests of a versioned
namespace, scope, and request identity. Raw emails, IP addresses, invite tokens,
refresh tokens, reservation inputs, Redis URLs, and client error strings are
not written to rate-limit keys or availability logs.

| Policy               | Redis unavailable in production                           | Intended surfaces                                                                                                                  |
| -------------------- | --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `security-sensitive` | Fail closed before database lookup or mutation            | Login, MFA, password reset/setup, organization applications, tournament invite lookup/acceptance, seller applications, and reports |
| `session-refresh`    | Use the bounded in-process fixed window                   | Refresh rotation; database compare-and-set, family reuse detection, expiry, and revocation remain authoritative                    |
| `low-risk`           | Use the bounded in-process fixed window/reservation store | Anonymous shop click tracking and similar non-security telemetry                                                                   |

Local fallbacks have hard capacities. They are deliberately not cross-instance
state and must not be used for production security-sensitive writes.

## Runtime requirements

Production should set:

```dotenv
NODE_ENV=production
ENABLE_REDIS=true
REDIS_URL=redis://redis:6379
DISTRIBUTED_RATE_LIMIT_REQUIRED=true
REDIS_MAXMEMORY=768mb
REDIS_READY_MAX_MEMORY_RATIO=0.85
EVENT_BUS_MAX_PAYLOAD_BYTES=524288
EVENT_BUS_STREAM_MAXLEN=10000
```

The publish preflight requires and bounds these settings. Under the candidate
contract, a required Redis deployment is ready only when `/health/ready`
returns HTTP 200 after client, subscription, capacity, and policy checks pass.
