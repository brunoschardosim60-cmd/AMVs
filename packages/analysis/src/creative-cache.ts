/**
 * Cache determinístico em memória (e serializável) para análises profundas do
 * AMV Creative Intelligence Engine, indexado por hash do arquivo original.
 * Permite reaproveitar compreensão visual e musical entre múltiplas gerações
 * e múltiplos projetos sem reprocessar episódios ou músicas idênticos.
 */

export interface CacheStats {
  visualHits: number;
  visualMisses: number;
  musicHits: number;
  musicMisses: number;
}

export class CreativeAnalysisCache<TVisual = unknown, TMusic = unknown> {
  private readonly visualStore = new Map<string, TVisual>();
  private readonly musicStore = new Map<string, TMusic>();
  private stats: CacheStats = {
    visualHits: 0,
    visualMisses: 0,
    musicHits: 0,
    musicMisses: 0,
  };

  getVisual(cacheKey: string): TVisual | undefined {
    const found = this.visualStore.get(cacheKey);
    if (found !== undefined) {
      this.stats.visualHits++;
      return found;
    }
    this.stats.visualMisses++;
    return undefined;
  }

  setVisual(cacheKey: string, value: TVisual): TVisual {
    this.visualStore.set(cacheKey, value);
    return value;
  }

  getOrComputeVisual(cacheKey: string, compute: () => TVisual): { value: TVisual; fromCache: boolean } {
    const existing = this.visualStore.get(cacheKey);
    if (existing !== undefined) {
      this.stats.visualHits++;
      return { value: existing, fromCache: true };
    }
    this.stats.visualMisses++;
    const computed = compute();
    this.visualStore.set(cacheKey, computed);
    return { value: computed, fromCache: false };
  }

  getMusic(cacheKey: string): TMusic | undefined {
    const found = this.musicStore.get(cacheKey);
    if (found !== undefined) {
      this.stats.musicHits++;
      return found;
    }
    this.stats.musicMisses++;
    return undefined;
  }

  setMusic(cacheKey: string, value: TMusic): TMusic {
    this.musicStore.set(cacheKey, value);
    return value;
  }

  getOrComputeMusic(cacheKey: string, compute: () => TMusic): { value: TMusic; fromCache: boolean } {
    const existing = this.musicStore.get(cacheKey);
    if (existing !== undefined) {
      this.stats.musicHits++;
      return { value: existing, fromCache: true };
    }
    this.stats.musicMisses++;
    const computed = compute();
    this.musicStore.set(cacheKey, computed);
    return { value: computed, fromCache: false };
  }

  getStats(): CacheStats {
    return { ...this.stats };
  }

  clear(): void {
    this.visualStore.clear();
    this.musicStore.clear();
    this.stats = { visualHits: 0, visualMisses: 0, musicHits: 0, musicMisses: 0 };
  }
}

export const defaultCreativeAnalysisCache = new CreativeAnalysisCache();
