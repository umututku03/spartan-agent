# Revision 1 dry-run record (superseded)

Offline mock-planner dry run produced before the Codex review in `../api-replication-review.md`. No API requests were made.
`source-r1/` holds the exact revision-1 runner, client, tests, verifier, cost script and protocol, whose hashes match
`opus/manifest-dryrun.json` and `sol/manifest-dryrun.json`. The review showed this verifier accepted six invalid
mutations. Revision 2 replaced it; this folder is kept unchanged as the reviewed record.

The archived `source-r1/api-replication-client.test.ts` is not runnable in place: its relative imports point at files
that are not archived. Bun's name filter matches it, so run the current tests with explicit paths:
`bun test ./api-replication-client.test.ts ./claude-agent-client.test.ts`.
