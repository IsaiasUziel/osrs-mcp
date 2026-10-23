import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod/v3';
import { getPlayerStats, getSkillProgress } from './hiscores.js';
import { getQuestInfo } from './quests.js';

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
  return server;
}
