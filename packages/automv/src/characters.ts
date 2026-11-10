import { normLabel, type EpisodeVision } from '@amv/analysis';
import type { ProjectCharacter } from '@amv/project';

/** Reconciles model labels with the canonical, user-confirmed names stored in the project. */
export function canonicalizeEpisodeVision(
  vision: EpisodeVision | null | undefined,
  library: ProjectCharacter[],
): EpisodeVision | undefined {
  if (!vision) return undefined;
  const resolve = (label: string) => library.find((character) =>
    [character.name, ...character.aliases].some((alias) => normLabel(alias) === normLabel(label)),
  )?.name ?? label;
  return {
    ...vision,
    shots: Object.fromEntries(Object.entries(vision.shots).map(([key, scene]) => [
      key,
      { ...scene, characters: scene.characters.map(resolve) },
    ])),
  };
}
