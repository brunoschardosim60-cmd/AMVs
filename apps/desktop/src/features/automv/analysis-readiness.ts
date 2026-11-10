export interface SelectedAnalysis {
  id: string;
  name: string;
  ready: boolean;
  error?: string;
}

export interface AnalysisReadiness {
  pending: SelectedAnalysis[];
  failed: SelectedAnalysis[];
  canGenerate: boolean;
}

export function getAnalysisReadiness(selected: SelectedAnalysis[]): AnalysisReadiness {
  const pending = selected.filter((item) => !item.ready && !item.error);
  const failed = selected.filter((item) => !item.ready && !!item.error);
  return { pending, failed, canGenerate: selected.length > 0 && pending.length === 0 && failed.length === 0 };
}
