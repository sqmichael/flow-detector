# Tests: Watch Disconnect Resilience

## Unit Tests

- [ ] `test_firstConnect_noWarmup` — First connect with disconnectedAt===null → connected immediately
- [ ] `test_shortGap_debounced` — Gap <5s: no warm-up, no gap event
- [ ] `test_mediumGap_warmupNoHistoryClear` — Gap 60s: warm-up entered, history preserved
- [ ] `test_longGap_clearsHistoryAndBaseline` — Gap >5min: history cleared, baseline null
- [ ] `test_warmup_completesAfterBatches` — 2 batches transitions warming_up to connected
- [ ] `test_warmup_blocksDetection` — Disqualifier returned during warming_up
- [ ] `test_staleBackfill_discarded` — Batch >1hr old skipped

## Edge Cases

| Case | Expected | Level |
|------|----------|-------|
| Agent starts disconnected | connectionState="disconnected", no gap on first connect | Unit |
| Multiple rapid reconnects | Each resets batchesSinceReconnect; only gaps >5s log events | Unit |
| 100-batch flood on reconnect | Batches count toward warm-up, stale ones discarded | Unit |
