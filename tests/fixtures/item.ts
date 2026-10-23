// Synthetic item pages, not copied Wiki text.
export function itemResponse(title = 'Synthetic utility hood', bonuses = '+2', slot = 'head') {
  return { parse: { title, revid: 456, sections: [{ line: 'Benefits', anchor: 'Benefits' }], wikitext: `{{Infobox Item
|name = ${title}
|id = 999999
|members = Yes
|tradeable = No
|equipable = Yes
|quest = No
}}
A synthetic hood. Requires a quest; recovery depends on access.
==Combat stats==
{{Infobox Bonuses|str = ${bonuses}|prayer = 0|dstab = +4|slot = ${slot}}}
==Benefits==
Works as a synthetic utility while carried, not only when worn.
==Changes==
Historical benefit that no longer applies.` } };
}
