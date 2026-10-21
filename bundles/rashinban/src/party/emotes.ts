export const PARTY_EMOTES = [
  { tag: ':gg:', name: 'GG', slug: 'gg' },
  { tag: ':happy:', name: 'Happy', slug: 'happy' },
  { tag: ':mindblown:', name: 'Mind blown', slug: 'mindblown' },
  { tag: ':wave:', name: 'Wave', slug: 'wave' },
  { tag: ':confused:', name: 'Confused', slug: 'confused' },
  { tag: ':cry:', name: 'Cry', slug: 'cry' },
  { tag: ':cool:', name: 'Cool', slug: 'cool' },
  { tag: ':goat:', name: 'GOAT', slug: 'goat' },
  { tag: ':luckyguess:', name: 'Lucky guess', slug: 'luckyguess' },
  { tag: ':beenthere:', name: 'Been there', slug: 'beenthere' },
  { tag: ':goodguess:', name: 'Good guess', slug: 'goodguess' },
  { tag: ':thankyou:', name: 'Thank you', slug: 'thankyou' },
] as const;
export function unlockedEmotes(inventory: unknown, elite: boolean): string[] {
  if (!Array.isArray(inventory)) return [];
  return PARTY_EMOTES.filter(emote => inventory.some(asset => asset && asset.slot === 24 && asset.unlocked === true
    && (!asset.isEliteExclusive || elite) && asset.type === `EMOTE_${emote.slug.toUpperCase()}`)).map(emote => emote.tag);
}
