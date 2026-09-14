# RFC 014 — Shard Rebalancing

Moving shards between storage nodes without stalling writes, and what happens when a move fails halfway.

## Summary

Basalt splits a stream's data across shards, and shards live on storage nodes. When a node
fills up, or the cluster gains capacity, shards have to move. Today that happens by hand: an
operator runs `basalt-admin rebalance`, watches the output, and intervenes when it stalls.

This RFC replaces that with a loop that runs inside the coordinator. It plans moves from
observed disk pressure, executes at most a fixed number at a time, and can be stopped and
resumed without ever leaving a shard in two places at once.

## Motivation

Three things push us here, and only the first is about convenience.

**Every capacity change is a ticket.** Adding a node means an operator picks shards by hand,
because the tooling has no opinion about which ones should move. They pick badly about a
third of the time — usually by moving the largest shard first, which is the one most likely
to stall under write load.

**Moves are not resumable.** If a rebalance is interrupted at 80%, the operator starts over.
On a 400 GB shard that is several hours of wasted background I/O, and the disk pressure that
prompted the move is still there.

**Nothing bounds concurrency.** Running two rebalances at once is possible today and will
saturate the network on a small cluster. We have seen this cause a write-availability
incident, and the fix was a wiki page telling people not to do it.

## Design

The planner is a pure function of observed state. It holds no history, so a coordinator
restart loses nothing and a new coordinator picks up the same plan.

### Shard placement

Placement is a map from shard to node, held in the coordinator's raft group and versioned
with the rest of the cluster metadata. A node advertises its own free space on every
heartbeat; the coordinator does not probe.

| Signal | Source | Refresh |
| --- | --- | --- |
| Disk utilisation | Node heartbeat | 10s |
| Shard size | Compaction manifest | per compaction |
| Write rate | Coordinator histogram | 30s |

Node-reported free space is advisory. A node can be wrong about its own disk — thin
provisioning, a filesystem that lies about sparse files, a container whose volume is
actually a network mount. The planner therefore treats a move that fails on a full
destination as a signal to lower that node's advertised capacity, not as an error.

### The rebalancing loop

Every tick the planner either emits one move or declines to.

#### Choosing a target

The pair is chosen by pressure difference, not by absolute fill. A cluster where every node
sits at 70% is balanced and should do nothing; a cluster with one node at 85% and the rest
at 40% should move data even though no node is close to full.

```go
func (p *Planner) Next(now time.Time) (Move, bool) {
    if p.inFlight >= p.maxConcurrent {
        return Move{}, false
    }
    src := p.hottest()   // highest disk utilisation, ties broken by shard count
    dst := p.coldest()   // lowest, never the source
    if src.Pressure()-dst.Pressure() < p.threshold {
        return Move{}, false // nothing worth the I/O
    }
    return Move{Shard: src.Largest(), From: src.ID, To: dst.ID}, true
}
```

#### Bounded moves

`max_concurrent_moves` defaults to 1 and is capped at 3. The cap is not about correctness —
the protocol handles any number — it is about leaving headroom for foreground traffic. A
move competes with compaction and with the write path for the same disks.

> **Threshold tuning matters more than the algorithm does.** Set it too low and the cluster
> never stops moving data, spending its whole I/O budget shuffling shards that are already
> balanced. Set it too high and nodes fill up before the planner notices. Start at 0.15 and
> treat it as a per-cluster setting, not a constant.

### Failure handling

A move has three phases, and only the last one is destructive.

1. **Copy.** The destination streams the shard and reports progress. The source keeps serving
   reads and writes. Nothing is committed.
2. **Drain.** The source stops accepting writes for the shard and flushes what it has. This is
   the only window where the shard is unavailable, and it is bounded by the flush, not by the
   shard size.
3. **Commit.** The coordinator writes the new placement to raft and the source deletes its copy.

A failure in phase 1 or 2 leaves the shard exactly where it was. A coordinator crash after
the raft write in phase 3 leaves a stale copy on the source, which the next reaper pass
deletes — the placement map is the only source of truth, and a copy that disagrees with it is
garbage by definition.

## Rollout

Flag-gated, off by default, enabled per cluster. The first clusters should be the ones already
rebalancing by hand, so an operator can compare the planner's choices against their own.

## Alternatives considered

**Consistent hashing with virtual nodes.** Would avoid moves entirely for the common
add-a-node case, but it cannot express "this shard is hot and should move" or "these two
shards must not share a node." We need placement to be a decision, not a function of the key.

**Letting nodes trade shards with each other.** Removes the coordinator from the data path,
but two nodes agreeing to a swap without a shared log is exactly the split-brain we spent
0.9 avoiding.

## Open questions

- Should the threshold adapt to cluster size, or stay an operator setting?
- Do we need a maintenance window concept, so planned moves can exceed the concurrency cap?
- What does the planner do on a cluster where every node is above threshold?
