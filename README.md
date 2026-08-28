# Memory Orb

Memory Orb is a spatial memory PWA where memories become nodes in a living 3D home orb.

## Current stage

### Stage 0 — Foundation
- React + Vite
- Three.js via React Three Fiber
- Supabase client scaffold
- Mobile-first full-screen app shell

### Stage 1 — Home Orb (initial)
- 96 nodes arranged on a 3D sphere
- Sparse relationship lines
- Touch rotation and pinch zoom
- Damped, slow inertial movement

## Planned stages

1. Home Orb visual foundation
2. Elastic / spring-based orb physics
3. Memory data model
4. Relationship graph
5. Spatial zoom navigation
6. AI memory ingestion: orbit while classifying, then settle into the orb
7. Supabase sync and authentication
8. Shared worlds and permissions
9. Clustering and large-graph optimization
10. PWA polish, haptics and final motion tuning

## Environment

Copy `.env.example` and provide:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`

Do not commit private database credentials or service-role keys.
