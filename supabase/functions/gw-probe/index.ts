const key = Deno.env.get('GOOGLE_MAPS_API_KEY') || '';
const lk = Deno.env.get('LOVABLE_API_KEY') || '';

Deno.serve(async () => {
  const out: Record<string, string> = {};
  const paths = [
    'v1/places:searchText',
    'places/v1/places:searchText',
    'places.googleapis.com/v1/places:searchText',
  ];
  for (const p of paths) {
    try {
      const r = await fetch(`https://connector-gateway.lovable.dev/google_maps/${p}`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${lk}`,
          'X-Connection-Api-Key': key,
          'Content-Type': 'application/json',
          'X-Goog-FieldMask': 'places.id,places.displayName',
        },
        body: JSON.stringify({ textQuery: 'vinoteca palermo buenos aires' }),
      });
      out[p] = `${r.status}: ${(await r.text()).slice(0, 200)}`;
    } catch (e) {
      out[p] = `err ${e}`;
    }
  }
  return new Response(JSON.stringify(out, null, 2), { headers: { 'Content-Type': 'application/json' } });
});
