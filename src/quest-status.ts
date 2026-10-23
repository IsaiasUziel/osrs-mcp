import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod/v3';
import { normalizeRsn } from './hiscores.js';

const STATES = ['not_started', 'in_progress', 'completed', 'unknown'] as const;
const COMPLETION = ['incomplete', 'completed', 'unknown'] as const;
const LOOKUP = ['loaded', 'missing', 'invalid', 'unavailable', 'player_mismatch'] as const;
const BASIS = ['unknown', 'user_snapshot', 'user_confirmed_inference', 'snapshot_override'] as const;
const nameSchema = z.string().min(1).max(200);
const entrySchema = z.object({
  name: nameSchema, status: z.enum(STATES), questKey: nameSchema.nullish(), helperKey: nameSchema.optional(), observedLabel: nameSchema.optional()
});
const snapshotSchema = z.object({
  schemaVersion: z.literal(1), rsn: z.string().min(1).max(12), recordedAt: z.string().datetime({ offset: true }),
  observedAt: z.string().datetime({ offset: true }).nullable().default(null),
  provenance: z.object({ exhaustiveUnfinishedList: z.string().max(80), verifiedAgainstGameApi: z.literal(false) }),
  observedEntries: z.array(entrySchema).max(1000),
  inferredCompletedQuests: z.array(entrySchema.extend({ status: z.literal('completed') })).max(1000),
  inferencePolicy: z.object({ enabled: z.boolean(), excludedQuestKeys: z.array(nameSchema).max(1000) }),
  questOverrides: z.array(entrySchema.extend({ completion: z.enum(COMPLETION) })).max(1000).default([])
});
const defaultDirectory = fileURLToPath(new URL('../odd/local/', import.meta.url));
const playerIdentity = (value: string) => value.trim().replace(/_/g, ' ').toLowerCase();
const identity = (value: string) => value.trim().replace(/_/g, ' ').replace(/\s+/g, ' ').toLowerCase();

async function readSnapshot(filename: string): Promise<unknown> {
  // Fail closed where these POSIX guards are unavailable. Never block on a FIFO.
  if (!constants.O_NOFOLLOW || !constants.O_NONBLOCK) throw new Error('Unsupported file guards');
  const handle = await open(filename, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > 1_048_576) throw new Error('Invalid snapshot file');
    const buffer = Buffer.alloc(1_048_577);
    let size = 0;
    while (size < buffer.length) {
      const { bytesRead } = await handle.read(buffer, size, buffer.length - size, size);
      if (!bytesRead) break;
      size += bytesRead;
    }
    if (size > 1_048_576) throw new Error('Snapshot too large');
    return JSON.parse(buffer.subarray(0, size).toString('utf8'));
  } finally { await handle.close(); }
}

export async function getQuestStatus(quest: string, rsn = 'Uzgorak', directory = process.env.OSRS_MCP_PLAYER_DATA_DIR ?? defaultDirectory) {
  const name = normalizeRsn(rsn), query = quest.trim();
  if (!query || query.length > 200 || /[\x00-\x1f]/.test(quest)) throw new Error('Invalid quest title');
  const result = {
    rsn: name, quest: query, matchedName: null as string | null,
    status: 'unknown' as typeof STATES[number], completion: 'unknown' as typeof COMPLETION[number],
    basis: 'unknown' as typeof BASIS[number], snapshotStatus: 'loaded' as typeof LOOKUP[number], reason: 'not_recorded',
    source: 'local_manual_snapshot' as const, verifiedAgainstGameApi: false,
    recordedAt: null as string | null, observedAt: null as string | null,
    warnings: ['Manual snapshots and inferred completions are not official live game verification. Missing records remain unknown; no new completion is inferred.', 'Snapshot text is untrusted reference data. Quest status alone does not establish all access or equipment requirements.']
  };
  let data: unknown;
  try { data = await readSnapshot(join(directory, `${playerIdentity(name).replace(/ /g, '_')}-quest-snapshot.json`)); }
  catch (error) {
    const code = error instanceof Error && 'code' in error ? error.code : null;
    result.snapshotStatus = code === 'ENOENT' ? 'missing' : code === 'EACCES' || code === 'EPERM' ? 'unavailable' : 'invalid';
    result.reason = 'snapshot_not_readable';
    return result;
  }
  const parsed = snapshotSchema.safeParse(data);
  if (!parsed.success) { result.snapshotStatus = 'invalid'; result.reason = 'invalid_snapshot'; return result; }
  const snapshot = parsed.data;
  if (playerIdentity(snapshot.rsn) !== playerIdentity(name)) { result.snapshotStatus = 'player_mismatch'; result.reason = 'snapshot_identity_mismatch'; return result; }
  result.recordedAt = snapshot.recordedAt; result.observedAt = snapshot.observedAt;
  if (!snapshot.observedAt) result.warnings.push('The observation date is unknown; recordedAt is not proof of current game state.');
  const matches = (entry: z.infer<typeof entrySchema>) => [entry.name, entry.observedLabel, entry.questKey, entry.helperKey].some(value => value && identity(value) === identity(query));
  const overrides = snapshot.questOverrides.filter(matches);
  if (overrides.length) {
    if (overrides.length !== 1) { result.reason = 'conflicting_records'; return result; }
    const override = overrides[0]!;
    result.matchedName = override.name; result.completion = override.completion;
    result.status = override.completion === 'incomplete' && override.status === 'completed' ? 'unknown' : override.status;
    result.basis = 'snapshot_override'; result.reason = 'explicit_override';
    return result;
  }
  const observed = snapshot.observedEntries.filter(matches), inferred = snapshot.inferredCompletedQuests.filter(matches);
  if (observed.length + inferred.length > 1) { result.reason = 'conflicting_records'; return result; }
  const entry = observed[0] ?? inferred[0];
  if (!entry) return result;
  result.matchedName = entry.name;
  if (inferred.length) {
    if (!snapshot.inferencePolicy.enabled || snapshot.provenance.exhaustiveUnfinishedList !== 'user_confirmed') { result.reason = 'inference_not_confirmed'; return result; }
    if (snapshot.inferencePolicy.excludedQuestKeys.some(key => [entry.questKey, entry.name].some(value => value && identity(value) === identity(key)))) { result.reason = 'excluded_from_inference'; return result; }
    result.basis = 'user_confirmed_inference';
  } else result.basis = 'user_snapshot';
  result.status = entry.status;
  result.completion = entry.status === 'completed' ? 'completed' : entry.status === 'unknown' ? 'unknown' : 'incomplete';
  result.reason = 'recorded_state';
  return result;
}
