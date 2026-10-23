// Synthetic API response; this is not a copy of Wiki content.
export const questResponse = {
  parse: {
    title: 'Synthetic Quest', revid: 123,
    sections: [{ line: 'Walkthrough', anchor: 'Walkthrough' }],
    wikitext: `{{Quest details
|description = A synthetic quest.
|requirements = *{{SCP|Crafting|31|link=yes}} {{Boostable|yes}} {{Questreqstart|no}}
*{{SCP|Woodcutting|36}} {{Boostable|no}}
*[[Another Quest]] and 10 quest points
|recommended = *{{SCP|Magic|50}}
|items = *[[Knife]]
|start = Speak to [[Example NPC|the guide]].
}}
==Walkthrough==
Obtain a [[Knife]] from the example shop.
===A step===
Follow the guide.
==Rewards==
{{Quest rewards|qp = 3|rewards = *Access to [[Example Area]]}}
==Required for completing==
[[A Later Quest]]`
  }
};

export const alternativeQuestResponse = {
  parse: { title: 'Alternative Quest', revid: 124, sections: [], wikitext: '{{Quest details|requirements = Either of the following:\n*{{SCP|Crafting|31}}\n*{{SCP|Magic|30}}}}' }
};
