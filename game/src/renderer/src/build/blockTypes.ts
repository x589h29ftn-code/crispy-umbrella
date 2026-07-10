// Preset-bouwblokken voor de hotbar. Alles is een 1m-kubus met eigen kleur;
// glas is doorzichtig. Nieuwe soorten toevoegen = één regel erbij.

export interface BlockType {
  id: string
  name: string
  color: number
  transparent?: boolean
  opacity?: number
}

export const BLOCK_TYPES: BlockType[] = [
  { id: 'planks', name: 'Planken', color: 0xb0854a },
  { id: 'stone', name: 'Steen', color: 0x9a9a94 },
  { id: 'glass', name: 'Glas', color: 0xbfe3ee, transparent: true, opacity: 0.45 },
  { id: 'roof', name: 'Dakpannen', color: 0xa8453a },
  { id: 'wood', name: 'Boomstam', color: 0x7a5b38 }
]

export function blockTypeIndex(id: string): number {
  return BLOCK_TYPES.findIndex((b) => b.id === id)
}
