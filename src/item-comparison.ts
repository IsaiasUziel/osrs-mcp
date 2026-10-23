import { getPlayerStats, normalizeRsn, type PlayerStats } from './hiscores.js';
import { BONUS_KEYS, getItemInfo, normalizeItemTitle, type ItemInfo } from './items.js';

export function compareItemFacts(item: ItemInfo, against: ItemInfo, stats: PlayerStats) {
  const sameSlot = item.slot !== null && item.slot === against.slot;
  return {
    rsn: stats.rsn, playerSkills: stats.skills, statsSource: stats.source, statsFetchedAt: stats.fetchedAt,
    item, against, sameSlot, differenceDirection: 'against_minus_item' as const,
    bonuses: BONUS_KEYS.map(key => {
      const first = item.bonuses[key], second = against.bonuses[key];
      return { key, item: first, against: second, difference: sameSlot && first !== null && second !== null ? second - first : null };
    }),
    equipEligibility: 'unknown' as const, ownership: 'unknown' as const,
    disposalRecommendation: 'unknown' as const, accountType: 'unknown' as const,
    warnings: [
      'Differences are against minus item, only for matching known slots and known literal bonuses; they are not DPS or a best-item ranking.',
      'Read both items\' utility and requirements context alongside public skills. Better combat bonuses do not make another item obsolete.',
      'Skills do not establish quest/diary completion, membership, ownership, reclaim access or account trading restrictions.',
      'No equipment-requirement parser or bank access is provided. Do not infer that an item can be equipped, sold or discarded.'
    ]
  };
}

export async function getItemComparison(itemTitle: string, againstTitle: string, rsn = 'Uzgorak', fetcher: typeof fetch = fetch) {
  // Validate the complete request before any upstream call; reuse adapter normalization.
  const item = normalizeItemTitle(itemTitle), against = normalizeItemTitle(againstTitle), name = normalizeRsn(rsn);
  const first = await getItemInfo(item, fetcher);
  const second = await getItemInfo(against, fetcher);
  return compareItemFacts(first, second, await getPlayerStats(name, fetcher));
}
