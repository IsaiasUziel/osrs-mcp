import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod/v3';
import { getPlayerStats, getSkillProgress } from './hiscores.js';
import { getQuestInfo, getQuestSkillGaps } from './quests.js';
import { getPlayerProfile } from './player-profile.js';
import { getItemInfo } from './items.js';
import { getItemComparison } from './item-comparison.js';
import { getQuestStatus } from './quest-status.js';
import { getPlayerProgress, refreshPlayerSnapshot, SNAPSHOT_SECTIONS } from './player-snapshot.js';

export function createServer() {
  const server = new McpServer({ name: 'osrs-mcp', version: '0.1.0' });
  server.registerTool('get_player_stats', {
    description: 'Fetch live OSRS Hiscores skills, levels and XP for a character',
    inputSchema: { rsn: z.string().default('Uzgorak') }
  }, async ({ rsn }) => {
    try { return { content: [{ type: 'text', text: JSON.stringify(await getPlayerStats(rsn)) }] }; }
    catch (error) { return { isError: true, content: [{ type: 'text', text: String(error) }] }; }
  });
  server.registerTool('get_skill_progress', {
    description: 'Calculate XP remaining to a target skill level',
    inputSchema: { rsn: z.string().default('Uzgorak'), skill: z.string(), targetLevel: z.number().int().min(1).max(99) }
  }, async ({ rsn, skill, targetLevel }) => {
    try { return { content: [{ type: 'text', text: JSON.stringify(getSkillProgress(await getPlayerStats(rsn), skill, targetLevel)) }] }; }
    catch (error) { return { isError: true, content: [{ type: 'text', text: String(error) }] }; }
  });
  server.registerTool('get_quest_info', {
    description: 'Read OSRS Wiki quest requirements, rewards and item context with source attribution; does not read quest completion',
    inputSchema: { quest: z.string().min(1).max(200) }, annotations: { readOnlyHint: true }
  }, async ({ quest }) => {
    try { return { content: [{ type: 'text', text: JSON.stringify(await getQuestInfo(quest)) }] }; }
    catch (error) { return { isError: true, content: [{ type: 'text', text: String(error) }] }; }
  });
  server.registerTool('get_quest_skill_gaps', {
    description: 'Compare explicit quest skill requirements with Hiscores base levels and XP; quest eligibility and completion remain unknown',
    inputSchema: { quest: z.string().min(1).max(200), rsn: z.string().default('Uzgorak') }, annotations: { readOnlyHint: true }
  }, async ({ quest, rsn }) => {
    try { return { content: [{ type: 'text', text: JSON.stringify(getQuestSkillGaps(await getQuestInfo(quest), await getPlayerStats(rsn))) }] }; }
    catch (error) { return { isError: true, content: [{ type: 'text', text: String(error) }] }; }
  });
  server.registerTool('get_player_profile', {
    description: 'Read a public Wise Old Man account-type report with source dates; stale, missing or unsupported reports remain unknown and require confirmation',
    inputSchema: { rsn: z.string().default('Uzgorak') }, annotations: { readOnlyHint: true }
  }, async ({ rsn }) => {
    try { return { content: [{ type: 'text', text: JSON.stringify(await getPlayerProfile(rsn)) }] }; }
    catch (error) { return { isError: true, content: [{ type: 'text', text: String(error) }] }; }
  });
  server.registerTool('get_item_info', {
    description: 'Read attributed Wiki item properties, literal equipment bonuses and utility/requirements context; does not confirm ownership or equip eligibility',
    inputSchema: { item: z.string().min(1).max(200) }, annotations: { readOnlyHint: true }
  }, async ({ item }) => {
    try { return { content: [{ type: 'text', text: JSON.stringify(await getItemInfo(item)) }] }; }
    catch (error) { return { isError: true, content: [{ type: 'text', text: String(error) }] }; }
  });
  server.registerTool('compare_items', {
    description: 'Compare two Wiki item contexts and literal bonuses alongside public character skills; does not rank overall usefulness or confirm equip eligibility, ownership or disposal',
    inputSchema: { item: z.string().min(1).max(200), against: z.string().min(1).max(200), rsn: z.string().default('Uzgorak') }, annotations: { readOnlyHint: true }
  }, async ({ item, against, rsn }) => {
    try { return { content: [{ type: 'text', text: JSON.stringify(await getItemComparison(item, against, rsn)) }] }; }
    catch (error) { return { isError: true, content: [{ type: 'text', text: String(error) }] }; }
  });
  server.registerTool('get_quest_status', {
    description: 'Read a local manual quest snapshot with explicit user-reported/inferred provenance; not official live game verification, no completion inferred for missing records',
    inputSchema: { quest: z.string().min(1).max(200), rsn: z.string().default('Uzgorak') }, annotations: { readOnlyHint: true }
  }, async ({ quest, rsn }) => {
    try { return { content: [{ type: 'text', text: JSON.stringify(await getQuestStatus(quest, rsn)) }] }; }
    catch (error) { return { isError: true, content: [{ type: 'text', text: String(error) }] }; }
  });
  server.registerTool('get_player_progress', {
    description: 'Read a local WikiSync-derived section snapshot only; reports three-day expiry and unknown upstream freshness without network calls. Explicit manual quest overrides take precedence.',
    inputSchema: { rsn: z.string().default('Uzgorak'), section: z.enum(SNAPSHOT_SECTIONS) }, annotations: { readOnlyHint: true }
  }, async ({ rsn, section }) => {
    try { return { content: [{ type: 'text', text: JSON.stringify(await getPlayerProgress(section, rsn)) }] }; }
    catch (error) { return { isError: true, content: [{ type: 'text', text: String(error) }] }; }
  });
  server.registerTool('refresh_player_snapshot', {
    description: 'Explicitly refresh selected local player snapshot sections from one anonymous WikiSync GET. Skips sections retrieved within three days unless force=true; writes private local snapshots, never game state. No scheduling or retries.',
    inputSchema: { rsn: z.string().default('Uzgorak'), sections: z.array(z.enum(SNAPSHOT_SECTIONS)).min(1).max(3), force: z.boolean().default(false) },
    annotations: { readOnlyHint: false, destructiveHint: false }
  }, async ({ rsn, sections, force }) => {
    try {
      const result = await refreshPlayerSnapshot(sections, rsn, force);
      return { ...(!['fresh', 'refreshed'].includes(result.outcome) ? { isError: true } : {}), content: [{ type: 'text', text: JSON.stringify(result) }] };
    } catch (error) { return { isError: true, content: [{ type: 'text', text: String(error) }] }; }
  });
  return server;
}
