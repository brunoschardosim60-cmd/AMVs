import { listModels, PRESETS, ProviderError } from '@amv/assistant';
import { CheckCircle2, Loader2, XCircle } from 'lucide-react';
import { useEffect, useState } from 'react';
import { isLocal, secretName, type AiSettings } from '../../core/aiSettings';
import { useApp } from '../../store';
import { Button, Dialog } from '../../ui/controls';

/** Central de IA: provedor, modelo, chave (no cofre), teste de conexão e permissões. */
export function AiSettingsDialog({ settings, onSave, onClose }: { settings: AiSettings; onSave: (s: AiSettings) => void; onClose: () => void }) {
  const { platform } = useApp();
  const [s, setS] = useState<AiSettings>(settings);
  const [key, setKey] = useState('');
  const [hasKey, setHasKey] = useState(false);
  const [models, setModels] = useState<string[]>([]);
  const [test, setTest] = useState<{ state: 'idle' | 'running' | 'ok' | 'fail'; msg?: string }>({ state: 'idle' });
  const preset = PRESETS.find((p) => p.id === s.presetId) ?? PRESETS[0]!;

  useEffect(() => {
    setKey('');
    setModels([]);
    setTest({ state: 'idle' });
    if (platform && s.provider.needsKey) void platform.secrets.get(secretName(s.presetId)).then((k) => setHasKey(!!k)).catch(() => setHasKey(false));
    else setHasKey(false);
  }, [s.presetId, s.provider.needsKey, platform]);

  const pick = (id: string) => {
    const p = PRESETS.find((x) => x.id === id)!;
    setS({ ...s, presetId: id, provider: { name: p.name, kind: p.kind, baseUrl: p.baseUrl, model: p.model, needsKey: p.needsKey } });
  };

  const storeKey = async () => {
    if (!platform || !key.trim()) return;
    await platform.secrets.set(secretName(s.presetId), key.trim());
    setKey('');
    setHasKey(true);
  };

  const runTest = async () => {
    if (!platform) return;
    setTest({ state: 'running' });
    try {
      if (key.trim()) await storeKey();
      const k = s.provider.needsKey ? await platform.secrets.get(secretName(s.presetId)) : null;
      const list = await listModels(s.provider, k, platform.http);
      setModels(list);
      const has = !s.provider.model || list.includes(s.provider.model) || !list.length;
      setTest({ state: 'ok', msg: has ? `Conectado. ${list.length} modelo(s) disponível(is).` : `Conectado, mas o modelo "${s.provider.model}" não está na lista. Escolha um abaixo.` });
    } catch (e) {
      setTest({ state: 'fail', msg: e instanceof ProviderError ? e.message : (e as Error).message });
    }
  };

  const external = !isLocal(s);

  return (
    <Dialog
      title="Configurações de IA"
      onClose={onClose}
      width="w-[560px]"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            variant="primary"
            onClick={async () => {
              if (key.trim()) await storeKey();
              onSave(s);
              onClose();
            }}
          >
            Salvar
          </Button>
        </>
      }
    >
      <div className="space-y-4 text-xs">
        <label className="flex items-center gap-2">
          <input type="checkbox" className="accent-violet" checked={s.enabled} onChange={(e) => setS({ ...s, enabled: e.target.checked })} />
          <span className="text-sm">Usar um modelo de IA no assistente</span>
        </label>
        <p className="-mt-2 text-muted">Desligado, o assistente continua funcionando com pedidos diretos ("cortes mais rápidos", "grito antes do drop"…), tudo no seu PC.</p>

        <div className={s.enabled ? '' : 'pointer-events-none opacity-50'}>
          <p className="mb-1 font-medium text-ink-soft">Provedor</p>
          <div className="grid grid-cols-2 gap-1.5">
            {PRESETS.map((p) => (
              <button key={p.id} type="button" onClick={() => pick(p.id)} className={`rounded-md border px-3 py-2 text-left ${s.presetId === p.id ? 'border-violet bg-violet/10' : 'border-line hover:bg-raised'}`}>
                <span className="block text-xs font-semibold">{p.name}</span>
                <span className="block text-2xs text-muted">{p.help}</span>
              </button>
            ))}
          </div>

          <div className="mt-3 grid grid-cols-[90px_1fr] items-center gap-2">
            <span className="text-ink-soft">Endereço</span>
            <input className="h-8 rounded-control border border-line bg-base px-2 outline-none focus:border-violet" value={s.provider.baseUrl} onChange={(e) => setS({ ...s, provider: { ...s.provider, baseUrl: e.target.value } })} />
            <span className="text-ink-soft">Modelo</span>
            <div className="flex gap-1">
              <input list="ai-models" className="h-8 min-w-0 flex-1 rounded-control border border-line bg-base px-2 outline-none focus:border-violet" value={s.provider.model} onChange={(e) => setS({ ...s, provider: { ...s.provider, model: e.target.value } })} />
              <datalist id="ai-models">
                {models.map((m) => (
                  <option key={m} value={m} />
                ))}
              </datalist>
            </div>
            {s.provider.needsKey && (
              <>
                <span className="text-ink-soft">Chave</span>
                <input type="password" autoComplete="off" className="h-8 rounded-control border border-line bg-base px-2 outline-none focus:border-violet" placeholder={hasKey ? '•••••••• (guardada no cofre do sistema)' : 'cole a chave aqui'} value={key} onChange={(e) => setKey(e.target.value)} />
              </>
            )}
          </div>
          {s.provider.needsKey && (
            <p className="mt-1 text-2xs text-muted">
              A chave fica no Gerenciador de Credenciais do Windows, nunca em arquivo.{' '}
              {hasKey && (
                <button type="button" className="underline hover:text-danger" onClick={() => void platform?.secrets.delete(secretName(s.presetId)).then(() => setHasKey(false))}>
                  Apagar chave
                </button>
              )}
            </p>
          )}

          <div className="mt-3 flex items-center gap-2">
            <Button size="sm" onClick={runTest} disabled={test.state === 'running'}>
              Testar conexão
            </Button>
            {test.state === 'running' && <Loader2 size={14} className="animate-spin text-muted" />}
            {test.state === 'ok' && (
              <span className="flex items-center gap-1 text-ok">
                <CheckCircle2 size={14} /> {test.msg}
              </span>
            )}
            {test.state === 'fail' && (
              <span className="flex items-start gap-1 text-danger">
                <XCircle size={14} className="mt-0.5 shrink-0" /> {test.msg}
              </span>
            )}
          </div>

          {external && (
            <label className="mt-4 flex items-start gap-2 rounded-md border border-warn/40 bg-warn/10 p-2">
              <input type="checkbox" className="mt-0.5 accent-violet" checked={s.allowExternal} onChange={(e) => setS({ ...s, allowExternal: e.target.checked })} />
              <span>
                <b>Permitir enviar para a internet.</b> O assistente manda um resumo do projeto (nomes dos arquivos, tempos dos clipes, falas das legendas) para {preset.name}. Vídeo e áudio nunca saem do seu PC.
              </span>
            </label>
          )}
          <p className="mt-3 text-2xs text-faint">
            Uso acumulado: {s.usage.input.toLocaleString('pt-BR')} tokens enviados, {s.usage.output.toLocaleString('pt-BR')} recebidos.
          </p>
        </div>
      </div>
    </Dialog>
  );
}
