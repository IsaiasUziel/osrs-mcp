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
- `get_quest_info({ quest: string })`: Wiki quest requirements, recommendations, required items, rewards and available walkthrough context.
- `get_quest_skill_gaps({ quest: string, rsn?: string })`: compare explicitly parsed quest skill requirements with Hiscores base levels and XP.

The RSN defaults to `Uzgorak`. Each result includes source and fetch timestamp. Hiscores do not reveal completed quests, bank contents or Slayer assignments.

## Quest guidance

For example, call `get_quest_info({ "quest": "Lost City" })` for preparation context, then `get_quest_skill_gaps({ "quest": "Lost City" })` for base-level comparisons. The tools use anonymous, on-demand GET requests to the public Wiki and existing official Hiscores endpoint. They never install plugins, inspect RuneLite, read game memory or packets, request game credentials, or control gameplay. WikiSync is not queried. No claim of zero ban risk is made.

Quest text is returned as **wikitext reference data**, with canonical and revision URLs, fetch time, contributor attribution and a content-license link. Only unambiguous standalone `SCP` skill requirements are interpreted. Alternatives, conditional or unsupported markup, prerequisite quests, quest points, boosts, access and inventory remain unverified. Recommended skills are never treated as requirements. `met` means only that a base skill level meets a parsed threshold; **quest eligibility and completion always remain `unknown`**. A missing base level may still be boostable.

Leading prose, group labels and alternative/conditional cues disable automatic skill extraction for that requirement group. This deliberately favors manual review over potentially misleading skill comparisons.

The adapter makes one Wiki request per call, with a 10-second deadline, a 1 MiB response limit and no retries, background polling or persistent cache. Context fields are capped at 12,000 characters with explicit warnings. Missing fields are `null`, not evidence that no requirement exists. Item acquisition is limited to available quest walkthrough context and section links; this is not a complete shop/drop database. A page revision does not freeze transcluded templates, and fetch time is not the page's publication time.

Wiki content has separate licensing from this project's MIT code; see [third-party notices](THIRD_PARTY_NOTICES.md). Retrieved text is untrusted reference material, not instructions to execute.

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
- No persistent data is stored in this version.
- GE prices, broader Wiki lookups and production authentication are future milestones. Character-specific quest completion remains unavailable.
- `tsrs` is the experimental Rust TypeScript compiler used for type checking; Bun handles runtime and bundling.

## tsrs compatibility

`tsrs` targets TypeScript 7.1 development builds and remains experimental. Zod is pinned to the same version used by the MCP SDK, with schemas imported from `zod/v3` to preserve existing tool schemas and validation messages. Tool registration uses `registerTool` without type assertions or suppressed diagnostics. Dependencies are pinned and `bun.lock` is checked with frozen installs in CI. Run `bun install --frozen-lockfile --ignore-scripts && bun run check` to verify MCP SDK and Bun typings.

Transport tests start real stdio and loopback HTTP MCP servers with fixture-backed Hiscores responses. They require no Jagex connection and cover tool discovery, default and explicit RSNs, XP progress, tool errors, authentication, routing, and origin validation.

Quest tests use synthetic Wiki responses, not copied Wiki pages, and cover conservative parsing, unknown conditions, provenance, bounded responses and failures. Both transports exercise the new quest tools while preserving the original tools' schemas and validation messages.

## Contributing

Bug reports and focused pull requests are welcome. Use English for code, documentation, issues, pull requests, labels, tags, and commit messages. Use Conventional Commits and run `bun run check` and `bun run build` before submitting a change. Never include bearer tokens or local `.env` files in reports or commits.

## License

Licensed under the [MIT License](LICENSE). This is an independent community project and is not affiliated with or endorsed by Jagex.
