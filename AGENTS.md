# AGENTS.md

- Maps are created only through `useGoogleMap`; when Google Maps rejects or fails to load, it installs the Leaflet shim in `src/lib/mapFallback.ts` as `window.google.maps`. Why: map assignment must never be blocked by a Google key, quota or domain problem.
- Any new `google.maps.*` API used by a map screen must also be implemented in `src/lib/mapFallback.ts`. Why: otherwise that screen breaks exactly when the fallback is active.
