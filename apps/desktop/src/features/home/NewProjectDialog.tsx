import { FORMAT_PRESETS, FPS_PRESETS } from '@amv/project';
import { useState } from 'react';
import { useApp } from '../../store';
import { Button, Dialog, Field, inputClass } from '../../ui/controls';

function AspectBox({ w, h, active }: { w: number; h: number; active: boolean }) {
  const scale = 22 / Math.max(w, h);
  return (
    <span className="grid size-7 place-items-center">
      <span
        className={`block rounded-[2px] border ${active ? 'border-violet bg-violet/25' : 'border-faint'}`}
        style={{ width: Math.round(w * scale), height: Math.round(h * scale) }}
      />
    </span>
  );
}

export function NewProjectDialog() {
  // o seletor precisa devolver sempre a mesma coisa (senão o Zustand 5 redesenha em loop)
  const setNewProjectOpen = useApp((s) => s.setNewProjectOpen);
  const close = () => setNewProjectOpen(false);
  const createProject = useApp((s) => s.createProject);
  const [name, setName] = useState('');
  const [format, setFormat] = useState('1080p');
  const [fps, setFps] = useState('30');
  const [busy, setBusy] = useState(false);

  const preset = FORMAT_PRESETS.find((f) => f.id === format)!;
  const rate = FPS_PRESETS.find((f) => f.label === fps)!;
  const valid = name.trim().length > 0;

  const submit = async () => {
    if (!valid || busy) return;
    setBusy(true);
    await createProject(name.trim(), { width: preset.width, height: preset.height, fps: rate.fps });
    setBusy(false);
  };

  return (
    <Dialog
      title="Novo projeto"
      onClose={close}
      width="w-[560px]"
      footer={
        <>
          <Button variant="ghost" onClick={close}>
            Cancelar
          </Button>
          <Button variant="primary" disabled={!valid || busy} onClick={submit}>
            Criar e escolher onde salvar
          </Button>
        </>
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <Field label="Nome">
          <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex.: Luta final — episódio 24" maxLength={120} />
        </Field>

        <fieldset className="mb-4">
          <legend className="mb-1.5 text-xs font-medium text-ink-soft">Formato</legend>
          <div className="grid grid-cols-1 gap-1">
            {FORMAT_PRESETS.map((f) => (
              <label
                key={f.id}
                className={`flex cursor-pointer items-center gap-3 rounded-control border px-2.5 py-1.5 text-sm transition-colors ${
                  format === f.id ? 'border-violet/60 bg-violet/10' : 'border-transparent hover:bg-raised'
                }`}
              >
                <input type="radio" name="format" className="sr-only" checked={format === f.id} onChange={() => setFormat(f.id)} />
                <AspectBox w={f.width} h={f.height} active={format === f.id} />
                <span className="flex-1">{f.label.split(' ')[0]}</span>
                <span className="tnum text-xs text-muted">
                  {f.width}×{f.height}
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        <fieldset>
          <legend className="mb-1.5 text-xs font-medium text-ink-soft">Quadros por segundo</legend>
          <div className="flex gap-1 rounded-control bg-base p-1">
            {FPS_PRESETS.map((f) => (
              <label
                key={f.label}
                className={`tnum flex-1 cursor-pointer rounded-[4px] py-1.5 text-center text-sm transition-colors ${
                  fps === f.label ? 'bg-raised font-semibold text-ink shadow-sm' : 'text-muted hover:text-ink'
                }`}
              >
                <input type="radio" name="fps" className="sr-only" checked={fps === f.label} onChange={() => setFps(f.label)} />
                {f.label}
              </label>
            ))}
          </div>
          <p className="mt-1.5 text-2xs text-muted">Animes costumam estar em 23,976. Dá para mudar depois.</p>
        </fieldset>
      </form>
    </Dialog>
  );
}
