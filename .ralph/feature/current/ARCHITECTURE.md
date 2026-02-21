# Architecture

## Components
- `README.md` (new): repo-level entrypoint for purpose, quick start, and navigation.
- `docs/README.md` (new): docs taxonomy and status map.
- `docs/architecture.md` (updated): current system architecture narrative.
- `docs/WATCH-BRIDGE-PLAN.md` (updated): historical marker to prevent misuse.
- `server/calling/SETUP.md` (updated): runnable setup instructions.

## Data Flow
1. User lands in `README.md`.
2. User follows links into `docs/README.md` for doc selection.
3. User uses current architecture/setup docs to run relevant services.
4. User avoids superseded SensorServer path due explicit labeling.

## Interfaces / Contracts
- `README.md` must reference existing docs and runnable commands.
- `docs/README.md` must classify docs by operational status.
- `docs/architecture.md` must match implemented runtime seams.
- Historical docs must declare superseded status near the top.
- Setup docs must avoid references to non-existent templates.

## Failure Modes
- Stale references remain in untouched docs and reintroduce confusion.
- New docs drift from code as architecture evolves.
- Contributors bypass index docs and continue using old links.
