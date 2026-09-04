// Fixed per-upstream network budget (Q3b). One value for both providers:
// Fugle hangs > 3s -> eligible fallback; MIS hangs > 3s -> final failure.
// Worst sequential case ~6s, fine for a local demo. Not configurable — no
// ConfigModule, no env, no policy object — until a concrete requirement says so.
export const UPSTREAM_TIMEOUT_MS = 3000;
