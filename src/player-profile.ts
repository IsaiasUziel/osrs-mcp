import { z } from 'zod/v3';
import { normalizeRsn } from './hiscores.js';
import { readBoundedText } from './upstream.js';

export const ACCOUNT_TYPE = { UNKNOWN: 'unknown', REGULAR: 'regular', IRONMAN: 'ironman', HARDCORE: 'hardcore', ULTIMATE: 'ultimate' } as const;
type AccountType = (typeof ACCOUNT_TYPE)[keyof typeof ACCOUNT_TYPE];
const FRESHNESS = { UNKNOWN: 'unknown', RECENT: 'recent', STALE: 'stale' } as const;
const LOOKUP = { FOUND: 'found', MISSING: 'not_found', UNAVAILABLE: 'unavailable', INVALID: 'invalid_response' } as const;
const MAX_RECORD_AGE_DAYS = 7;
const profileSchema = z.object({ username: z.string().min(1).max(12), type: z.string().min(1).max(40), updatedAt: z.string().nullable().optional() });

export interface PlayerProfile {
  rsn: string;
  accountType: AccountType;
  reportedAccountType: string | null;
  source: string;
  fetchedAt: string;
  providerUpdatedAt: string | null;
  recordFreshness: (typeof FRESHNESS)[keyof typeof FRESHNESS];
  lookupStatus: (typeof LOOKUP)[keyof typeof LOOKUP];
  maxRecordAgeDays: number;
  confirmationRequired: boolean;
  warnings: string[];
}

export async function getPlayerProfile(rsn: string, fetcher: typeof fetch = fetch, clock = () => new Date()): Promise<PlayerProfile> {
  const normalized = normalizeRsn(rsn);
  const source = `https://api.wiseoldman.net/v2/players/${encodeURIComponent(normalized)}`;
  function unknown(status: PlayerProfile['lookupStatus'], warning: string): PlayerProfile {
    return {
      rsn: normalized, accountType: ACCOUNT_TYPE.UNKNOWN, reportedAccountType: null, source,
      fetchedAt: clock().toISOString(), providerUpdatedAt: null, recordFreshness: FRESHNESS.UNKNOWN,
      lookupStatus: status, maxRecordAgeDays: MAX_RECORD_AGE_DAYS, confirmationRequired: true,
      warnings: ['Provider categories do not establish all account restrictions or membership. Record update time is not a verified account-type check time.', warning]
    };
  }
  let response: Response;
  try {
    response = await fetcher(source, {
      method: 'GET', redirect: 'error', signal: AbortSignal.timeout(10_000),
      headers: { 'User-Agent': 'osrs-mcp/0.3.0 (https://github.com/IsaiasUziel/osrs-mcp; read-only player profile)' }
    });
  } catch { return unknown(LOOKUP.UNAVAILABLE, 'Wise Old Man lookup failed; confirm account type manually.'); }
  if (!response.ok) {
    try { await response.body?.cancel(); } catch { /* Preserve the structured fallback. */ }
    return unknown(response.status === 404 ? LOOKUP.MISSING : LOOKUP.UNAVAILABLE, `Wise Old Man HTTP ${response.status}; no type is inferred and tracking was not created or updated.`);
  }
  let data: unknown;
  try { data = JSON.parse(await readBoundedText(response, 'Wise Old Man')); }
  catch { return unknown(LOOKUP.INVALID, 'Invalid or incomplete Wise Old Man response; confirm account type manually.'); }
  const parsed = profileSchema.safeParse(data);
  const identity = (name: string) => name.replace(/_/g, ' ').toLowerCase();
  if (!parsed.success || identity(parsed.data.username) !== identity(normalized)) {
    return unknown(LOOKUP.INVALID, 'Wise Old Man profile did not match the requested player or expected format.');
  }
  const value = parsed.data;
  const result = unknown(LOOKUP.FOUND, 'Account type is reported by a third party, not independently verified against every game mode.');
  result.reportedAccountType = value.type;
  const date = z.string().datetime({ offset: true }).safeParse(value.updatedAt);
  if (!date.success || !Number.isFinite(Date.parse(date.data))) {
    result.warnings.push('Provider record date is missing or invalid; freshness is unknown.');
    return result;
  }
  result.providerUpdatedAt = date.data;
  const age = Date.parse(result.fetchedAt) - Date.parse(date.data);
  if (age < 0) { result.warnings.push('Provider record date is in the future; freshness is unknown.'); return result; }
  result.recordFreshness = age > MAX_RECORD_AGE_DAYS * 86_400_000 ? FRESHNESS.STALE : FRESHNESS.RECENT;
  const supported = Object.values(ACCOUNT_TYPE).find(type => type === value.type);
  if (result.recordFreshness === FRESHNESS.RECENT && supported && supported !== ACCOUNT_TYPE.UNKNOWN) {
    result.accountType = supported;
    result.confirmationRequired = false;
  } else {
    result.warnings.push('The reported type is unknown, unsupported or older than the seven-day local heuristic; confirm manually.');
  }
  return result;
}
