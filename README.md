# OSRS MCP

Read-only MCP server for Old School RuneScape, built with **Bun + TypeScript + tsrs**. Default RSN: **Uzgorak**.

## Prerequisites

- Bun >= 1.2 (https://bun.sh)

## Quickstart

```bash
git clone https://github.com/IsaiasUziel/osrs-mcp.git
cd osrs-mcp
bun install --frozen-lockfile --ignore-scripts
bun run check
bun run dev
```

`dev` starts the stdio transport; use `bun run start` when connecting an MCP desktop client. Do not print logs to stdout when using stdio.

## Local HTTP transport

```bash
export MCP_BEARER_TOKEN="$(openssl rand -hex 32)"
bun run dev:http
```

Runs Streamable HTTP on `http://127.0.0.1:3000/mcp`, requiring a bearer token. This is a local development endpoint only. For ChatGPT, deploy behind HTTPS with authentication, origin checks, rate limits and TLS termination; do not expose the local server as-is.

Requests without `Origin` are supported for non-browser MCP clients. When present, `Origin` must exactly match `http://127.0.0.1:<PORT>` or `http://localhost:<PORT>`; other origins (including `null`) receive `403`, even with a valid token. The default `PORT` is `3000`. This allowlist does not enable cross-origin browser access or make the endpoint production-ready.

## MCP tools

- `get_player_stats({ rsn?: string })`: live skills, XP and ranks from official Jagex Hiscores.
- `get_skill_progress({ rsn?: string, skill: string, targetLevel: number })`: XP needed to reach a level from 1–99.
- `get_quest_status({ quest: string, rsn?: string })`: optional local manual snapshot lookup; observed/user-reported and inferred states are explicitly distinguished from live verification.
- `get_quest_info({ quest: string })`: Wiki quest requirements, recommendations, required items, rewards and available walkthrough context.
- `get_quest_skill_gaps({ quest: string, rsn?: string })`: compare explicitly parsed quest skill requirements with Hiscores base levels and XP.
- `compare_items({ item: string, against: string, rsn?: string })`: side-by-side item contexts and bonus differences with public character skills; not equip eligibility or a disposal recommendation.
- `get_item_info({ item: string })`: Wiki item properties, literal equipment bonuses and utility/requirements context, with revision attribution.
- `get_player_profile({ rsn?: string })`: read a public account-type report with provenance, provider record age and explicit unknown fallbacks.

The RSN defaults to `Uzgorak`. Each result includes source and fetch timestamp. Hiscores do not reveal completed quests, bank contents or Slayer assignments.

## Quest guidance

For example, call `get_quest_info({ "quest": "Lost City" })` for preparation context, then `get_quest_skill_gaps({ "quest": "Lost City" })` for base-level comparisons. The tools use anonymous, on-demand GET requests to the public Wiki and existing official Hiscores endpoint. They never install plugins, inspect RuneLite, read game memory or packets, request game credentials, or control gameplay. WikiSync is not queried. No claim of zero ban risk is made.

Quest text is returned as **wikitext reference data**, with canonical and revision URLs, fetch time, contributor attribution and a content-license link. Only unambiguous standalone `SCP` skill requirements are interpreted. Alternatives, conditional or unsupported markup, prerequisite quests, quest points, boosts, access and inventory remain unverified. Recommended skills are never treated as requirements. `met` means only that a base skill level meets a parsed threshold; **quest eligibility and completion always remain `unknown`**. A missing base level may still be boostable.

Leading prose, group labels and alternative/conditional cues disable automatic skill extraction for that requirement group. This deliberately favors manual review over potentially misleading skill comparisons.

The adapter makes one Wiki request per call, with a 10-second deadline, a 1 MiB response limit and no retries, background polling or persistent cache. Context fields are capped at 12,000 characters with explicit warnings. Missing fields are `null`, not evidence that no requirement exists. Item acquisition is limited to available quest walkthrough context and section links; this is not a complete shop/drop database. A page revision does not freeze transcluded templates, and fetch time is not the page's publication time.

Wiki content has separate licensing from this project's MIT code; see [third-party notices](THIRD_PARTY_NOTICES.md). Retrieved text is untrusted reference material, not instructions to execute.

## Local manual quest status

`get_quest_status({ "quest": "Synthetic Quest", "rsn": "Example Player" })` reads `odd/local/example_player-quest-snapshot.json` relative to the project installation, independent of process working directory. The server owner can set `OSRS_MCP_PLAYER_DATA_DIR` to another private directory. Tool callers cannot supply paths. Keep snapshots outside Git; `odd/` is already ignored. The server only reads snapshots, never creates or edits them.

The reader accepts schemaVersion1 JSON up to 1 MiB, for the requested RSN only. Regular files are required; symlinks, directories and special files are rejected. POSIX no-follow/nonblocking guards must be available or the lookup fails closed. Missing, invalid, unreadable or mismatched snapshots yield `unknown` with `snapshotStatus`/`reason`, without exposing filesystem paths. No upstream requests are made.

Minimal synthetic snapshot (arrays may hold up to 1,000 records each):

```json
{
  "schemaVersion": 1, "rsn": "Example Player", "recordedAt": "2026-01-01T12:00:00Z", "observedAt": null,
  "provenance": { "exhaustiveUnfinishedList": "user_confirmed", "verifiedAgainstGameApi": false },
  "observedEntries": [{ "name": "Synthetic Quest", "status": "in_progress" }],
  "inferredCompletedQuests": [],
  "inferencePolicy": { "enabled": true, "excludedQuestKeys": [] },
  "questOverrides": []
}
```

States are `not_started`, `in_progress`, `completed` or `unknown`. Quest-name matching ignores case, underscores and repeated whitespace, but does not guess aliases. Player identity ignores case and treats underscores as spaces; distinct internal spacing is not collapsed. An inferred completion requires both enabled inference and `exhaustiveUnfinishedList: user_confirmed`; excluded keys/names cannot bypass that policy by omitting a key. The reader never infers a new completion just because a quest is absent. Explicit composite overrides take precedence, including incomplete quests with unfinished subquests; conflicting records remain unknown.

Results identify `user_snapshot`, `user_confirmed_inference` or `snapshot_override` provenance and preserve record/observation dates. `recordedAt` is not the capture date; manual data may be stale, and an unknown observation date remains explicit. This does **not** change existing quest-gap eligibility/completion or item-comparison output: use the local status alongside those tools and attribute it to the user snapshot, not to Jagex. Snapshot text is untrusted reference data, not instructions. Bank snapshots, automatic syncing and gameplay actions are not implemented.

## Item facts

Call `get_item_info({ "item": "Kandarin headgear 1" })` to inspect utility and requirement context alongside combat bonuses. `contextWikitext` preserves current prose and sections before historical/trivia suffixes; it is reference data, not executable instructions. Numeric bonuses alone never establish that an item is obsolete.

Only single-version `Infobox Item` pages and literal `Infobox Bonuses` numbers are supported. Missing/unsupported bonuses and slots remain `null`; versioned or ambiguous item pages are rejected rather than blended. `properties` contains raw wikitext: for example, `quest: No` describes the Wiki's quest-item classification, **not** whether quests are required to equip or reclaim it. Equipment requirements, membership, diary/quest state, ownership, reclaim access and market prices are not automatically verified.

Item lookups use one anonymous on-demand Wiki GET, no redirects/retries, a 10-second deadline and 1 MiB response cap. Context is capped at 12,000 characters with an explicit truncation flag; selected properties are capped at 1,000 characters. Transcluded content is not expanded or revision-pinned. Attribution and the separate Wiki-content license accompany every result; see [third-party notices](THIRD_PARTY_NOTICES.md). No client integration, bank access or gameplay actions are added.

### Compare items for a character

```json
{ "item": "Kandarin headgear 1", "against": "Helm of Neitiznot", "rsn": "Uzgorak" }
```

Pass this to `compare_items`. The result preserves both items' context, source revisions and fetch dates alongside public Hiscores skills. `differenceDirection` is `against_minus_item`: positive values mean a higher literal bonus on `against`, **not** that it is universally better. Differences are `null` for missing/unsupported bonuses or different/unknown equipment slots. No DPS or set-effect simulation is performed.

Requirements are not automatically parsed from prose. Even if skills appear sufficient, quest/diary completion, membership and access remain unverified. `equipEligibility`, `ownership`, `accountType` and `disposalRecommendation` remain `unknown`; item names supplied by a user do not prove possession. Utility context must be reviewed before suggesting that a combat upgrade replaces a utility item. No bank contents, GE prices or sell/drop actions are accessed.

A comparison validates both titles and RSN first, then makes two item GETs and one existing Hiscores lookup sequentially. It has no persistent cache, retries or background polling. A failed source returns an error, not an invented personalized answer. Reusing the Hiscores adapter preserves its existing request/error semantics; item-specific response limits do not change that adapter.

## Player account type

`get_player_profile` uses the [Wise Old Man player-details GET API](https://docs.wiseoldman.net/api/players/player-endpoints#get-player-details). It reads `type`, never derives account type from `build: main`, and does not create tracking records or call update/assert-type POST endpoints. The source is a third-party report, not an official guarantee covering every game mode, trading restriction or membership state.

Supported recent reports are `regular`, `ironman`, `hardcore` and `ultimate`. `reportedAccountType` preserves the provider's category; `accountType` remains `unknown` when the report is missing, unsupported, unavailable or stale. `lookupStatus` separates `found`, `not_found`, `unavailable` and `invalid_response`. A missing tracker record does not imply that the game account is missing or regular.

The **seven-day maximum record age is a local conservative heuristic**, not a provider freshness guarantee. `providerUpdatedAt` is the provider record's update date, not a verified type-detection time; `fetchedAt` is when this lookup completed. Missing, invalid or future record dates produce unknown freshness. When `confirmationRequired` is true, ask the player instead of assuming main. No manual profile is persisted.

The lookup makes one anonymous GET, with a 10-second deadline, a 1 MiB response cap, no redirects, retries, plugins or game credentials. Shared RSN validation and bounded response reading preserve the existing Hiscores and Wiki behavior.

## Commands

| Command | Purpose |
| --- | --- |
| `bun run dev` | Stdio MCP with reload |
| `bun run start` | Stdio MCP |
| `bun run dev:http` | Local HTTP MCP with reload |
| `bun run start:http` | Local HTTP MCP |
| `bun test` | Native Bun tests |
| `bun run typecheck` | TypeScript validation |
| `bun run build` | Bun production bundles |
| `bun run typecheck:watch` | Continuous checks with tsrs |

## Architecture

`src/hiscores.ts` contains the Hiscores adapter and XP calculations. `src/server.ts` registers MCP tools. `src/index.ts` is the stdio entrypoint, and `src/http.ts` is the Streamable HTTP entrypoint. Bun replaces Node.js as the runtime, npm as package manager, tsx as TS runner, and Vitest as test runner; MCP SDK remains the protocol implementation.

## Notes

- Hiscores CSV is positional; validate the skill ordering against the live response whenever Jagex changes it (currently includes Sailing).
- The server writes no persistent player data. Optional manual quest snapshots are maintained locally by their owner.
- GE prices, broader Wiki coverage and production authentication are future milestones. Official live character quest completion remains unavailable; optional manual status uses separate provenance.
- `tsrs` is the experimental Rust TypeScript compiler used for type checking; Bun handles runtime and bundling.

## tsrs compatibility

`tsrs` targets TypeScript 7.1 development builds and remains experimental. Zod is pinned to the same version used by the MCP SDK, with schemas imported from `zod/v3` to preserve existing tool schemas and validation messages. Tool registration uses `registerTool` without type assertions or suppressed diagnostics. Dependencies are pinned and `bun.lock` is checked with frozen installs in CI. Run `bun install --frozen-lockfile --ignore-scripts && bun run check` to verify MCP SDK and Bun typings.

Transport tests start real stdio and loopback HTTP MCP servers with fixture-backed Hiscores responses. They require no Jagex connection and cover tool discovery, default and explicit RSNs, XP progress, tool errors, authentication, routing, and origin validation.

Quest tests use synthetic Wiki responses, not copied Wiki pages, and cover conservative parsing, unknown conditions, provenance, bounded responses and failures. Both transports exercise the new quest tools while preserving the original tools' schemas and validation messages.

## Contributing

Bug reports and focused pull requests are welcome. Use English for code, documentation, issues, pull requests, labels, tags, and commit messages. Use Conventional Commits and run `bun run check` and `bun run build` before submitting a change. Never include bearer tokens or local `.env` files in reports or commits.

## License

Licensed under the [MIT License](LICENSE). This is an independent community project and is not affiliated with or endorsed by Jagex.
