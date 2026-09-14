# Basalt 3.0 — launch post, edit pass 2

Draft for the announcement. Cuts in ~~strikethrough~~, additions in ++underline++, anything needing a source or a decision in ==highlight==.

## Headline

~~Basalt 3.0 is here~~

Basalt 3.0: ~~faster~~ ++predictable++ reads under failure

==Check whether we can claim "predictable" without a benchmark table in the post. If not, use "steadier."==

## Opening

Two years ago we started rebuilding the read path around a simple observation: ~~most of our
customers have replicas that are slow, not dead~~ ++the replicas that hurt you are the ones
that answer late, not the ones that stop answering++. A dead replica drops out of the quorum
and costs nothing. A slow one stays in it, and every read that touches it waits.

3.0 is the release where we stopped treating those as the same failure.

## The problem

Under load, p~99~ read latency was 3x the p~50~ on clusters nobody would describe as
unhealthy. ==Get the real numbers from the 3.0 benchmark run, the 3x figure is from the Q~2~
incident review and was measured on a different workload.== Our own engineers could not
explain it from the dashboards, which is usually a sign the dashboard is measuring the wrong
thing.

The fix was not a faster code path. It was a health check that measures latency instead of
liveness, so a replica answering in 400 ms leaves the quorum the same way a dead one does.

## What shipped

- **Latency-aware health checks.** Replicas are removed from quorums on response time, not on
  missed heartbeats.
- **Hedged reads, off by default.** Issue to ~r~ + 1 replicas and take the first ~r~ answers.
  Costs about 38% more read load; pulls p~99~ down by roughly half.
- **Shard rebalancing in the coordinator.** No more hand-picking shards when you add a node.[^1]
- **Streaming snapshots.** A backup no longer needs the disk headroom of a full copy.

We sustained 10^6^ writes per second on a nine-node cluster during the benchmark, with p~99~
write latency under 9 ms. ==Confirm the node count — the run I saw was five nodes, and the
nine-node number came from the pre-release build.==

## Closing

3.0 is available today, and upgrading is a rolling restart. The migration runbook covers the
full procedure.[^2] If you are on 2.6 or older, ++check which SDK your clients are on++ before
you start — it is the one step people skip and the one that causes the call.

~~We think this is our best release yet.~~

==Cut the line above, it reads as filler. End on the runbook link instead.==

[^1]: RFC 014 if you want the design rationale. Shorter version: the planner is a pure function of observed disk pressure, so a coordinator restart loses nothing.

[^2]: Link the runbook from the docs site, not from the repo — the repo path will move when we split the operator guide out.
