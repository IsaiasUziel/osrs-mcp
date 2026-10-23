// Synthetic manual snapshot; never copy personal quest progress into tests.
export function questSnapshot(rsn = 'Uzgorak') {
  return {
    schemaVersion: 1, rsn, recordedAt: '2026-10-23T12:00:00Z', observedAt: null,
    provenance: { exhaustiveUnfinishedList: 'user_confirmed', verifiedAgainstGameApi: false },
    observedEntries: [
      { name: 'Synthetic Quest', status: 'in_progress', questKey: 'SYNTHETIC_QUEST', kind: 'P2P' },
      { name: 'Pending Quest', status: 'not_started', questKey: null, kind: 'ACHIEVEMENT_DIARY' }
    ],
    inferredCompletedQuests: [{ name: 'Earlier Quest', status: 'completed', questKey: 'EARLIER_QUEST' }],
    inferencePolicy: { enabled: true, excludedQuestKeys: ['COMPOSITE_QUEST'] },
    questOverrides: [{ name: 'Composite Quest', questKey: 'COMPOSITE_QUEST', status: 'unknown', completion: 'incomplete' }]
  };
}
