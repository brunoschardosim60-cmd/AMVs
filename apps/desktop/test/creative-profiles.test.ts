import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_CREATIVE_PROFILES, type CreativeProfile } from '@amv/automv';
import { loadCreativeProfiles, saveCreativeProfiles } from '../src/core/creativeProfiles';
import { nodePlatform } from './node-platform';

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'amv-creative-profiles-'));
});

afterEach(() => rmSync(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 }));

describe('persistência dos perfis criativos', () => {
  it('carrega modelos padrão e persiste perfis do usuário sem duplicar os modelos', async () => {
    const platform = nodePlatform(root);
    const defaults = await loadCreativeProfiles(platform);
    expect(defaults).toEqual(DEFAULT_CREATIVE_PROFILES);

    const custom: CreativeProfile = {
      ...DEFAULT_CREATIVE_PROFILES[0]!,
      id: 'custom:my-amv',
      name: 'Meu AMV',
      actionEmphasis: 72,
      emotionEmphasis: 61,
    };
    await saveCreativeProfiles(platform, [...defaults, custom]);

    const reopened = await loadCreativeProfiles(platform);
    expect(reopened).toEqual([...DEFAULT_CREATIVE_PROFILES, custom]);

    const updated = { ...custom, name: 'Meu AMV revisado', intensity: 1 as const };
    await saveCreativeProfiles(platform, [...defaults, updated]);
    expect(await loadCreativeProfiles(platform)).toEqual([...DEFAULT_CREATIVE_PROFILES, updated]);

    await saveCreativeProfiles(platform, defaults);
    expect(await loadCreativeProfiles(platform)).toEqual(DEFAULT_CREATIVE_PROFILES);
  });

  it('recusa arquivo inválido sem sobrescrevê-lo silenciosamente', async () => {
    const platform = nodePlatform(root);
    await platform.fs.mkdir(await platform.dataDir());
    const file = join(await platform.dataDir(), 'perfis-criativos.json');
    const invalid = new TextEncoder().encode('{"not":"a list"}');
    await platform.fs.writeFile(file, invalid);

    await expect(loadCreativeProfiles(platform)).rejects.toThrow('Não foi possível carregar perfis criativos');
    expect(await platform.fs.readFile(file)).toEqual(invalid);
  });
});
