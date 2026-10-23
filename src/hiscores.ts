export const SKILLS = [
  'Overall','Attack','Defence','Strength','Hitpoints','Ranged','Prayer','Magic','Cooking','Woodcutting',
  'Fletching','Fishing','Firemaking','Crafting','Smithing','Mining','Herblore','Agility','Thieving',
  'Slayer','Farming','Runecraft','Hunter','Construction','Sailing'
] as const;

export type Skill = { name: string; rank: number | null; level: number; xp: number };
export type PlayerStats = { rsn: string; fetchedAt: string; source: string; skills: Skill[] };

export function parseHiscores(csv: string): Skill[] {
  const rows = csv.trim().split(/\r?\n/);
  if (rows.length < SKILLS.length) throw new Error(`Unexpected Hiscores format: ${rows.length} rows`);
  return SKILLS.map((name, index) => {
    const values = rows[index]?.split(',');
    if (!values || values.length !== 3) throw new Error(`Invalid row for ${name}`);
    const [rank, level, xp] = values.map(Number);
    if (![rank, level, xp].every(Number.isSafeInteger) || level < 1 || xp < 0) {
      throw new Error(`Invalid stats for ${name}`);
    }
    return { name, rank: rank < 0 ? null : rank, level, xp };
  });
}

export function normalizeRsn(rsn: string): string {
  const normalized = rsn.trim();
  if (!normalized || normalized.length > 12 || !/^[a-zA-Z0-9 _-]+$/.test(normalized)) {
    throw new Error('Invalid RSN');
  }
  return normalized;
}

export async function getPlayerStats(rsn: string, fetcher: typeof fetch = fetch): Promise<PlayerStats> {
  const normalized = normalizeRsn(rsn);
  const url = `https://secure.runescape.com/m=hiscore_oldschool/index_lite.ws?player=${encodeURIComponent(normalized)}`;
  const response = await fetcher(url, { signal: AbortSignal.timeout(10000), headers: { 'User-Agent': 'osrs-mcp/0.1.0 (personal OSRS assistant)' } });
  if (response.status === 404) throw new Error(`Player not found: ${normalized}`);
  if (!response.ok) throw new Error(`Hiscores HTTP ${response.status}`);
  return { rsn: normalized, fetchedAt: new Date().toISOString(), source: url, skills: parseHiscores(await response.text()) };
}

export function xpForLevel(level: number): number {
  if (!Number.isInteger(level) || level < 1 || level > 126) throw new Error('Target level must be 1..126');
  let points = 0;
  for (let i = 1; i < level; i++) points += Math.floor(i + 300 * 2 ** (i / 7));
  return Math.floor(points / 4);
}

export function getSkillProgress(stats: PlayerStats, skillName: string, targetLevel: number) {
  const skill = stats.skills.find(s => s.name.toLowerCase() === skillName.toLowerCase());
  if (!skill || skill.name === 'Overall') throw new Error(`Unknown skill: ${skillName}`);
  const targetXp = xpForLevel(targetLevel);
  return { rsn: stats.rsn, skill: skill.name, currentLevel: skill.level, currentXp: skill.xp, targetLevel, targetXp, xpRemaining: Math.max(0, targetXp - skill.xp), fetchedAt: stats.fetchedAt };
}
