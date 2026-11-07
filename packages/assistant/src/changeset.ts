import { applyCommand, findOverlaps, type Command, type Project } from '@amv/project';

/**
 * Proposta da IA: lista de itens; cada item é um grupo de Commands com motivo.
 * O usuário escolhe quais aplicar. Dependências são respeitadas.
 */
export interface ChangeItem {
  id: string;
  kind: 'add' | 'remove' | 'move' | 'modify';
  label: string;
  /** Onde fica na timeline (para pular o playhead). */
  atUs: number | null;
  commands: Command[];
  dependsOn: string[];
}

export interface ChangeSet {
  id: string;
  title: string;
  reason: string;
  items: ChangeItem[];
}

/** Desmarcar um item desmarca quem depende dele (em cadeia). */
export function closeSelection(cs: ChangeSet, selected: Set<string>): Set<string> {
  const out = new Set(selected);
  let changed = true;
  while (changed) {
    changed = false;
    for (const it of cs.items) {
      if (out.has(it.id) && it.dependsOn.some((d) => !out.has(d))) {
        out.delete(it.id);
        changed = true;
      }
    }
  }
  return out;
}

export interface Validation {
  ok: boolean;
  commands: Command[];
  error: string | null;
}

/** Revalida o subconjunto escolhido no projeto ATUAL antes de aplicar. */
export function validateSelection(project: Project, cs: ChangeSet, selected: Set<string>): Validation {
  const chosen = cs.items.filter((it) => selected.has(it.id));
  const commands = chosen.flatMap((it) => it.commands);
  if (!commands.length) return { ok: false, commands, error: 'nada selecionado' };
  try {
    const next = applyCommand(project, { type: 'batch', commands }).project;
    const before = new Set(findOverlaps(project).map(([a, b]) => `${a.id}|${b.id}`));
    const fresh = findOverlaps(next).filter(([a, b]) => !before.has(`${a.id}|${b.id}`));
    if (fresh.length) return { ok: false, commands, error: 'a mudança deixaria clipes um em cima do outro na mesma trilha' };
    return { ok: true, commands, error: null };
  } catch (e) {
    return { ok: false, commands, error: (e as Error).message };
  }
}

export function summarizeChangeSet(cs: ChangeSet): string {
  const n = { add: 0, remove: 0, move: 0, modify: 0 };
  for (const it of cs.items) n[it.kind]++;
  return [n.add && `${n.add} adicionado(s)`, n.remove && `${n.remove} removido(s)`, n.move && `${n.move} movido(s)`, n.modify && `${n.modify} alterado(s)`].filter(Boolean).join(' · ');
}
