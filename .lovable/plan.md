
# Fix: ON CONFLICT constraint mismatch in

<lov-plan>

# Fix: ON CONFLICT constraint mismatch in geocode-clients

## Problem

The `geocode-clients` edge function uses `onConflict: "client_id"` but `client_places` has no unique constraint on `client_id` alone. The existing constraints are:
- `UNIQUE (client_id, direccion_principal)`
- `UNIQUE (client_id, lat, long)`

This causes all 48 upserts to fail with "no unique or exclusion constraint matching the ON CONFLICT specification".

## Solution

Two options:

1. **Add a unique constraint on `client_id`** — This is correct because `geocode-clients` is geocoding the primary address, and each client should have one primary place. However, the existing composite constraints suggest multiple places per client were intended.

2. **Change the upsert strategy** — Instead of upsert, first check if a `client_places` row exists for the `client_id`. If yes, update it. If no, insert a new row.

**Recommended: Option 2** — safer, no schema change needed. The edge function should:
- Query existing `client_places` for the client_id
- If exists: `UPDATE` by id
- If not: `INSERT` new row

## File to modify

| File | Change |
|------|--------|
| `supabase/functions/geocode-clients/index.ts` | Replace `.upsert(..., { onConflict: "client_id" })` with check-then-insert/update logic |

## Key code change

```typescript
// Instead of:
await supabase.from("client_places").upsert({ ... }, { onConflict: "client_id" });

// Do:
const { data: existing } = await supabase
  .from("client_places")
  .select("id")
  .eq("client_id", client.client_id)
  .maybeSingle();

if (existing) {
  await supabase.from("client_places").update({ lat, long: lng, ... }).eq("id", existing.id);
} else {
  await supabase.from("client_places").insert({ client_id: client.client_id, lat, long: lng, ... });
}
```

This is a small, targeted fix. No other files need changes.

