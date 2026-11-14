import { normLabel, type EpisodeVision } from '@amv/analysis';
import type { ProjectCharacter } from '@amv/project';

/**
 * Reconciles model labels only with names explicitly confirmed by the user.
 * Unconfirmed suggestions remain untouched and duplicate aliases collapse to one
 * canonical label within a shot; the cached vision object is never mutated.
 */
export function canonicalizeEpisodeVision(
  vision: EpisodeVision | null | undefined,
  library: ProjectCharacter[],
): EpisodeVision | undefined {
  if (!vision) return undefined;

  const canonicalByLabel = new Map<string, string>();
  for (const character of library) {
    if (!character.confirmed) continue;
    for (const alias of [character.name, ...character.aliases]) {
      const key = normLabel(alias);
      if (key && !canonicalByLabel.has(key)) canonicalByLabel.set(key, character.name);
    }
  }

  return {
    ...vision,
    shots: Object.fromEntries(Object.entries(vision.shots).map(([key, scene]) => {
      const seen = new Set<string>();
      const characters = scene.characters.flatMap((label) => {
        const canonical = canonicalByLabel.get(normLabel(label)) ?? label;
        const identity = normLabel(canonical);
        if (!identity || seen.has(identity)) return [];
        seen.add(identity);
        return [canonical];
      });
      return [key, { ...scene, characters }];
    })),
  };
}
