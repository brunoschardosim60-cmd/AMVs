import type { ChangeSet } from './changeset.js';
import { chat, type ChatMessage, type FetchLike, type ProviderConfig, type ToolSpec } from './providers.js';
import {
  findLines,
  findScenes,
  findWeakPoints,
  ideas,
  mmss,
  projectSummary,
  proposeAddEffect,
  proposeFasterCuts,
  proposeGenerate,
  proposeRemove,
  proposeReplaceScene,
  proposeSpeechBeforeDrop,
  targetClips,
  type AssistantContext,
} from './tools.js';

export const SYSTEM_PROMPT = `Você é o assistente de edição do AMV Studio, um editor de Anime Music Videos. Fale português do Brasil, curto e direto.
Você vê um resumo do projeto e usa ferramentas para ler detalhes e PROPOR mudanças. Você nunca altera o projeto sozinho: as ferramentas propose_* criam uma proposta que o usuário revisa e aprova.
Quando o usuário pedir uma mudança, chame a ferramenta propose_* certa (não descreva o que faria). Quando pedir opinião, use find_weak_points e responda com tempos concretos.
O resumo pode incluir rótulos de análise visual já existentes para as cenas usadas na timeline. Eles são descrições inferidas com confiança limitada, não quadros que você viu; não afirme ter assistido ao vídeo nem trate os rótulos como fatos certos.
Quando sugerir episódios ou cenas para importar, use o que você sabe do anime informado pelo usuário, dizendo que é sugestão (não afirme números de episódio com certeza). Nunca ofereça baixar episódios ou músicas: o usuário importa os arquivos que tem.
"Essa cena", "esse clipe" = clipes selecionados ou o clipe no playhead.`;

export const TOOLS: ToolSpec[] = [
  { name: 'find_weak_points', description: 'Analisa a montagem e lista problemas com tempo: cortes fora da batida, cenas repetidas, drop fraco, telas pretas, clipes longos em parte forte.', parameters: { type: 'object', properties: {} } },
  { name: 'find_scenes', description: 'Busca cenas nos episódios analisados por etiqueta e intensidade.', parameters: { type: 'object', properties: { tag: { type: 'string', enum: ['ação', 'impacto', 'fala', 'grito', 'calma', 'clarão'] }, minIntensity: { type: 'number' }, limit: { type: 'number' } } } },
  { name: 'find_lines', description: 'Busca falas e gritos nos episódios (texto da legenda quando houver).', parameters: { type: 'object', properties: { kind: { type: 'string', enum: ['fala', 'grito'] }, text: { type: 'string' }, limit: { type: 'number' } } } },
  { name: 'ideas', description: 'Ideias rápidas com base nas análises: gritos, frases de impacto, cenas para o drop e para a intro.', parameters: { type: 'object', properties: {} } },
  { name: 'propose_generate', description: 'Propõe uma montagem nova inteira (substitui a timeline).', parameters: { type: 'object', properties: { style: { type: 'string', enum: ['hype', 'superacao', 'letra', 'discurso', 'emocional'] }, intensity: { type: 'number', description: '0 a 3' }, durationS: { type: 'number' }, seed: { type: 'number' } }, required: ['style'] } },
  { name: 'propose_replace_scene', description: 'Troca a cena dos clipes selecionados (ou do playhead) por outra.', parameters: { type: 'object', properties: { clipIds: { type: 'array', items: { type: 'string' } }, tag: { type: 'string' }, stronger: { type: 'boolean', description: 'true = cena mais forte' } } } },
  { name: 'propose_add_effect', description: 'Adiciona efeito nos clipes escolhidos, ou nos cortes das batidas fortes (onBeats).', parameters: { type: 'object', properties: { effect: { type: 'string', enum: ['flash', 'shake', 'zoom', 'rgb_split', 'blur'] }, clipIds: { type: 'array', items: { type: 'string' } }, onBeats: { type: 'boolean' } }, required: ['effect'] } },
  { name: 'propose_faster_cuts', description: 'Deixa os cortes mais rápidos cortando os clipes nas batidas (selecionados ou um trecho em segundos).', parameters: { type: 'object', properties: { beatsPerCut: { type: 'number' }, fromS: { type: 'number' }, toS: { type: 'number' } } } },
  { name: 'propose_speech_before_drop', description: 'Coloca uma fala/grito marcante terminando exatamente no drop, com legenda e a música abaixando.', parameters: { type: 'object', properties: { text: { type: 'string', description: 'trecho da fala desejada (opcional)' } } } },
  { name: 'propose_remove', description: 'Remove clipes pelo id.', parameters: { type: 'object', properties: { clipIds: { type: 'array', items: { type: 'string' } } }, required: ['clipIds'] } },
];

export interface ToolOutcome {
  /** Texto devolvido ao modelo. */
  content: string;
  proposal: ChangeSet | null;
}

/** Executa uma ferramenta localmente. Nunca muda o projeto. */
export function runTool(ctx: AssistantContext, name: string, args: Record<string, unknown>): ToolOutcome {
  const asProposal = (r: ChangeSet | string): ToolOutcome =>
    typeof r === 'string' ? { content: r, proposal: null } : { content: `Proposta criada: "${r.title}" com ${r.items.length} item(ns): ${r.items.map((i) => i.label).join('; ')}. O usuário vai revisar.`, proposal: r };
  try {
    switch (name) {
      case 'find_weak_points': {
        const f = findWeakPoints(ctx);
        return { content: f.length ? f.slice(0, 15).map((x) => `[${x.severity}] ${mmss(x.atS)} ${x.text}${x.clipId ? ` (clipe ${x.clipId})` : ''}`).join('\n') : 'Nenhum problema encontrado.', proposal: null };
      }
      case 'find_scenes':
        return { content: JSON.stringify(findScenes(ctx, args as Parameters<typeof findScenes>[1])), proposal: null };
      case 'find_lines':
        return { content: JSON.stringify(findLines(ctx, args as Parameters<typeof findLines>[1])), proposal: null };
      case 'ideas':
        return { content: ideas(ctx).join('\n') || 'Sem análises ainda.', proposal: null };
      case 'propose_generate':
        return asProposal(proposeGenerate(ctx, args as Parameters<typeof proposeGenerate>[1]));
      case 'propose_replace_scene':
        return asProposal(proposeReplaceScene(ctx, args));
      case 'propose_add_effect':
        return asProposal(proposeAddEffect(ctx, args as Parameters<typeof proposeAddEffect>[1]));
      case 'propose_faster_cuts':
        return asProposal(proposeFasterCuts(ctx, args));
      case 'propose_speech_before_drop':
        return asProposal(proposeSpeechBeforeDrop(ctx, args));
      case 'propose_remove':
        return asProposal(proposeRemove(ctx, args as { clipIds: string[] }));
      default:
        return { content: `ferramenta desconhecida: ${name}`, proposal: null };
    }
  } catch (e) {
    return { content: `erro: ${(e as Error).message}`, proposal: null };
  }
}

export interface TurnResult {
  reply: string;
  proposals: ChangeSet[];
  /** Histórico atualizado (para a próxima pergunta). */
  messages: ChatMessage[];
  toolsUsed: string[];
  usage: { input: number; output: number };
}

/** Uma pergunta do usuário: conversa com o modelo, roda ferramentas, junta propostas. */
export async function runTurn(opts: {
  cfg: ProviderConfig;
  key: string | null;
  fetch: FetchLike;
  ctx: AssistantContext;
  history: ChatMessage[];
  question: string;
  signal?: AbortSignal;
  maxRounds?: number;
}): Promise<TurnResult> {
  const system = `${SYSTEM_PROMPT}\n\nRESUMO ATUAL DO PROJETO:\n${projectSummary(opts.ctx)}`;
  const messages: ChatMessage[] = [...opts.history.slice(-16), { role: 'user', content: opts.question }];
  const proposals: ChangeSet[] = [];
  const toolsUsed: string[] = [];
  const usage = { input: 0, output: 0 };
  let reply = '';
  for (let round = 0; round < (opts.maxRounds ?? 5); round++) {
    const r = await chat(opts.cfg, opts.key, opts.fetch, system, messages, TOOLS, opts.signal);
    if (r.usage) {
      usage.input += r.usage.input;
      usage.output += r.usage.output;
    }
    messages.push({ role: 'assistant', content: r.text, toolCalls: r.toolCalls.length ? r.toolCalls : undefined });
    reply = r.text || reply;
    if (!r.toolCalls.length) break;
    for (const call of r.toolCalls) {
      const out = runTool(opts.ctx, call.name, call.args);
      toolsUsed.push(call.name);
      if (out.proposal) proposals.push(out.proposal);
      messages.push({ role: 'tool', toolCallId: call.id, name: call.name, content: out.content.slice(0, 6000) });
    }
    // proposta criada: o modelo só precisa comentar, não insistir
  }
  if (!reply && proposals.length) reply = proposals.map((p) => `${p.title}: ${p.reason}`).join('\n');
  return { reply, proposals, messages, toolsUsed, usage };
}

/** Achados em linguagem de gente: agrupa repetições, sem ids. */
export function formatFindings(f: ReturnType<typeof findWeakPoints>): string {
  if (!f.length) return 'Não achei problemas: cortes na batida, sem cenas repetidas e sem tela preta. 👌';
  const groups = new Map<string, typeof f>();
  for (const x of f) {
    const k = x.text.replace(/\(.*\)|\d+([.,]\d+)?\s*(ms|s)\b|\d+:\d+(\.\d)?/g, '').trim();
    groups.set(k, [...(groups.get(k) ?? []), x]);
  }
  const out: string[] = [];
  for (const xs of groups.values()) {
    if (xs.length > 3) {
      const first = xs[0]!;
      out.push(`• ${first.text.replace(/\s*\(.*\)/, '')} — ${xs.length} vezes (${xs.slice(0, 4).map((x) => mmss(x.atS)).join(', ')}…)${/repetida/.test(first.text) ? '. Importe mais episódios ou peça "troque essa cena".' : ''}`);
    } else for (const x of xs) out.push(`• ${mmss(x.atS)} — ${x.text}`);
  }
  return `Achei ${f.length} ponto(s) para melhorar:\n${out.join('\n')}`;
}

/**
 * Sem IA configurada: entende os pedidos mais comuns por palavras-chave e roda
 * as mesmas ferramentas. Assim o chat funciona offline.
 */
export function localTurn(ctx: AssistantContext, question: string): { reply: string; proposals: ChangeSet[] } {
  const q = question.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const prop = (name: string, args: Record<string, unknown> = {}) => {
    const o = runTool(ctx, name, args);
    return o.proposal ? { reply: `${o.proposal.title}: ${o.proposal.reason}. Revise abaixo.`, proposals: [o.proposal] } : { reply: o.content, proposals: [] };
  };
  if (/melhor/.test(q) && /(cena|clipe|aqui|isso)/.test(q)) {
    const clips = targetClips(ctx);
    if (!clips.length) return { reply: 'Selecione um clipe (ou deixe o playhead em cima dele) e pergunte de novo.', proposals: [] };
    const a = Math.min(...clips.map((c) => c.timelineStartUs)) / 1e6 - 0.3;
    const b = Math.max(...clips.map((c) => c.timelineStartUs + c.durationUs)) / 1e6 + 0.3;
    const ids = new Set(clips.map((c) => c.id));
    const local = findWeakPoints(ctx).filter((f) => (f.clipId ? ids.has(f.clipId) : f.atS >= a && f.atS <= b));
    const swap = runTool(ctx, 'propose_replace_scene', { stronger: true });
    const head = local.length ? formatFindings(local) : 'Nesse trecho os cortes estão na batida e a cena não se repete.';
    return { reply: `${head}${swap.proposal ? '\nSe quiser mais impacto, dá para trocar por uma cena mais forte:' : ''}`, proposals: swap.proposal ? [swap.proposal] : [] };
  }
  if (/(ponto|fraco|problema|analis|revis|melhor(ar)?)/.test(q) && !/cena/.test(q)) return { reply: formatFindings(findWeakPoints(ctx)), proposals: [] };
  if (/(rapid|acelera|mais corte)/.test(q)) return prop('propose_faster_cuts', { beatsPerCut: /1 batida|uma batida/.test(q) ? 1 : 2 });
  if (/(fala|grito|frase).*(drop)|(drop).*(fala|grito)/.test(q)) return prop('propose_speech_before_drop', {});
  if (/(troc|outra cena|substitu)/.test(q)) return prop('propose_replace_scene', { stronger: /forte|impacto|intens/.test(q) });
  const fxs = ([['flash', /clarao|flash/], ['shake', /trem|shake/], ['zoom', /zoom/], ['rgb_split', /rgb|glitch/], ['blur', /desfo|blur/]] as const).filter(([, re]) => re.test(q)).map(([f]) => f);
  if (fxs.length) {
    const outs = fxs.map((effect) => runTool(ctx, 'propose_add_effect', { effect, onBeats: /batida|beat/.test(q) }));
    const proposals = outs.flatMap((o) => (o.proposal ? [o.proposal] : []));
    return proposals.length ? { reply: `${proposals.map((p) => p.title).join(' e ')}: revise abaixo.`, proposals } : { reply: outs[0]!.content, proposals: [] };
  }
  const style = /superac|motiva/.test(q) ? 'superacao' : /luta|hype/.test(q) ? 'hype' : /letra/.test(q) ? 'letra' : /discurso/.test(q) ? 'discurso' : /triste|emoc/.test(q) ? 'emocional' : null;
  if (style && /(ger|mont|faz|cria)/.test(q)) return prop('propose_generate', { style, durationS: Number(q.match(/(\d+)\s*s/)?.[1] ?? 30) });
  if (/(ideia|sugest|momento|cena boa|melhores)/.test(q)) return { reply: ideas(ctx).map((x) => `• ${x}`).join('\n') || 'Importe episódios e uma música para eu ter o que sugerir.', proposals: [] };
  return {
    reply: 'Sem um modelo de IA ligado eu entendo pedidos diretos, como: "analise meu AMV", "deixe os cortes mais rápidos", "coloque um grito antes do drop", "troque essa cena por uma mais forte", "clarão nas batidas", "gera um AMV de superação de 30 s", "ideias". Para conversar livremente (e pedir sugestões de episódios), ligue um modelo nas configurações de IA.',
    proposals: [],
  };
}
