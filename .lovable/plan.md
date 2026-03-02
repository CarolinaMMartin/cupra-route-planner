

# Analysis: Context Window Usage in generate-recommendations

## Current Data Sent to AI

| Data | Volume | Est. Tokens |
|------|--------|-------------|
| System prompt | ~3K chars | ~800 |
| 80 clients (JSON, 15+ fields each) | ~40-50K chars | ~12K |
| 30 prospects (JSON, 15+ fields each) | ~15K chars | ~4K |
| Vendors + filters + instructions | ~3K chars | ~800 |
| **Total** | **~65K chars** | **~18K tokens** |

Gemini 2.5 Flash supports ~1M tokens, so technically we're not hitting the limit. **But that's not the real problem.**

## The Real Problem: The AI Is Doing Work That Code Should Do

Right now the AI receives 110 candidates and must:
1. Figure out which clients belong to which seller (text matching)
2. Calculate geographic proximity (it guesses from barrio names)
3. Apply business rules (rotation, exclusion, score thresholds)
4. Select 8 per vendor
5. Generate justifications

Steps 1-3 are **deterministic** -- they don't need AI judgment. Sending all that raw data forces the AI to do math and filtering it's bad at, which explains why it sometimes returns 12 instead of 14.

## Proposed Architecture: Pre-Score + AI Selection

```text
CURRENT:  DB → 110 raw candidates → AI does everything → results

PROPOSED: DB → deterministic pre-scoring → 20-25 top candidates per vendor → AI picks 8 + justifies
```

### What code should do (before AI call):
1. **Seller-client mapping**: Match `vendedor_principal`/`vendedor_actual` to seller UUID deterministically
2. **Geographic scoring**: Use Haversine (already exists in the function!) to calculate actual distances between candidates
3. **Cluster detection**: Group candidates into geographic clusters per vendor zone
4. **Business scoring**: Apply recency, volume, rotation scores numerically
5. **Pre-rank**: Sort candidates by composite score, send top ~20 per vendor

### What AI should do (reduced scope):
1. From 20 pre-ranked candidates per vendor, select the best 8
2. Optimize the route/cluster coherence
3. Generate human-readable justifications
4. Flag edge cases (e.g., "this client changed vendors recently")

### Impact:
- AI context drops from ~18K tokens to ~5K tokens (faster, cheaper, more reliable)
- Deterministic scoring guarantees correct count (no more 12 vs 14)
- AI focuses on what it's good at: judgment and language
- Pre-scored data includes computed distances (not guessed from barrio names)

## Implementation Changes

| Component | Change |
|-----------|--------|
| Edge function (lines 470-560) | Add `preScoreCandidates()` function that computes numeric scores + distances before AI call |
| Edge function (lines 566-613) | Reduce prompt to only pre-scored top candidates with computed metrics |
| Edge function (system prompt) | Simplify: "Pick 8 from these pre-ranked candidates and justify" |
| DB migration | Add `vendedor_actual` to `clientes` for deterministic seller mapping |

## Do you want me to implement this refactor?

The key decision: should we do this as part of Phase 1 (the vendor-centric rewrite), or as a standalone optimization first?

My recommendation: **merge it into Phase 1**. The vendor-centric rewrite already requires restructuring the edge function, so adding pre-scoring at the same time avoids touching the file twice.

