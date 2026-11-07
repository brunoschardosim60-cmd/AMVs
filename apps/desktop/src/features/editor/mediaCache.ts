import { decodeWaveform, type ThumbStripPlan, type Waveform } from '@amv/media';
import { useEffect, useState } from 'react';
import type { ProjectSession } from '../../core/session';
import type { Platform } from '../../platform/types';

/** Waveforms e planos de miniaturas carregados do cache em disco, uma vez por arquivo. */
const waveforms = new Map<string, Promise<Waveform | null>>();
const plans = new Map<string, Promise<ThumbStripPlan | null>>();

export function loadWaveform(platform: Platform, path: string): Promise<Waveform | null> {
  let p = waveforms.get(path);
  if (!p) {
    p = platform.fs
      .readFile(path)
      .then(decodeWaveform)
      .catch(() => null);
    waveforms.set(path, p);
  }
  return p;
}

export function loadStripPlan(platform: Platform, stripPath: string): Promise<ThumbStripPlan | null> {
  const planPath = stripPath.replace(/\.jpg$/, '.json');
  let p = plans.get(planPath);
  if (!p) {
    p = platform.fs
      .readFile(planPath)
      .then((b) => JSON.parse(new TextDecoder().decode(b)) as ThumbStripPlan)
      .catch(() => null);
    plans.set(planPath, p);
  }
  return p;
}

export function useWaveform(platform: Platform, session: ProjectSession, assetId: string | null): Waveform | null {
  const path = assetId ? session.assetRuntime(assetId).artifacts?.waveformPath : null;
  const [w, setW] = useState<Waveform | null>(null);
  useEffect(() => {
    let alive = true;
    if (!path) {
      setW(null);
      return;
    }
    void loadWaveform(platform, path).then((x) => alive && setW(x));
    return () => {
      alive = false;
    };
  }, [platform, path]);
  return w;
}

export function useStrip(platform: Platform, session: ProjectSession, assetId: string | null): { url: string; plan: ThumbStripPlan } | null {
  const path = assetId ? session.assetRuntime(assetId).artifacts?.stripPath : null;
  const [r, setR] = useState<{ url: string; plan: ThumbStripPlan } | null>(null);
  useEffect(() => {
    let alive = true;
    if (!path) {
      setR(null);
      return;
    }
    void loadStripPlan(platform, path).then((plan) => alive && setR(plan ? { url: platform.fileUrl(path), plan } : null));
    return () => {
      alive = false;
    };
  }, [platform, path]);
  return r;
}
