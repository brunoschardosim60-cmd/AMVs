import { DEFAULT_CREATIVE_PROFILES, isBuiltInCreativeProfile, parseCreativeProfiles, type CreativeProfile } from '@amv/automv';
import { joinPath } from '@amv/media';
import type { Platform } from '../platform/types';

const FILE = 'perfis-criativos.json';

async function profileFile(platform: Platform): Promise<string> {
  return joinPath(await platform.dataDir(), FILE);
}

export async function loadCreativeProfiles(platform: Platform): Promise<CreativeProfile[]> {
  const file = await profileFile(platform);
  if (!(await platform.fs.exists(file))) return [...DEFAULT_CREATIVE_PROFILES];
  try {
    const stored = JSON.parse(new TextDecoder().decode(await platform.fs.readFile(file))) as unknown;
    const custom = parseCreativeProfiles(stored);
    const names = new Set(DEFAULT_CREATIVE_PROFILES.map((profile) => profile.name.toLowerCase()));
    if (custom.some((profile) => names.has(profile.name.toLowerCase()))) {
      throw new Error('Um perfil personalizado tem o mesmo nome de um perfil padrão.');
    }
    return [...DEFAULT_CREATIVE_PROFILES, ...custom];
  } catch (error) {
    throw new Error(`Não foi possível carregar perfis criativos: ${(error as Error).message}`);
  }
}

export async function saveCreativeProfiles(platform: Platform, profiles: CreativeProfile[]): Promise<void> {
  const customProfiles = profiles.filter((profile) => !isBuiltInCreativeProfile(profile));
  const validated = parseCreativeProfiles(customProfiles);
  const names = new Set(DEFAULT_CREATIVE_PROFILES.map((profile) => profile.name.toLowerCase()));
  for (const profile of validated) {
    const name = profile.name.toLowerCase();
    if (names.has(name)) throw new Error(`Já existe um perfil chamado "${profile.name}".`);
    names.add(name);
  }
  const file = await profileFile(platform);
  await platform.fs.mkdir(await platform.dataDir());
  const temporary = `${file}.tmp`;
  await platform.fs.writeFile(temporary, new TextEncoder().encode(JSON.stringify(validated, null, 2)));
  await platform.fs.rename(temporary, file);
}
