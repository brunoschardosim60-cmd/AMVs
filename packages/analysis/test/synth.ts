const SR = 22050;

export /** Música sintética: bumbo em cada batida, caixa nos tempos 2 e 4, e um "drop" (tudo mais alto + chimbal) em `dropS`. */
function synthForDebug(bpm: number, seconds: number, dropS: number, startOffset = 0): Float32Array {
  const out = new Float32Array(Math.round(seconds * SR));
  const period = 60 / bpm;
  let seed = 1;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
  for (let b = 0; startOffset + b * period < seconds; b++) {
    const t0 = startOffset + b * period;
    const loud = t0 >= dropS ? 1 : 0.3;
    const i0 = Math.round(t0 * SR);
    // bumbo: senoide grave decaindo
    for (let i = 0; i < SR * 0.12 && i0 + i < out.length; i++) out[i0 + i]! += loud * Math.sin(2 * Math.PI * 60 * (i / SR)) * Math.exp(-i / (SR * 0.04));
    // caixa nos tempos 2 e 4: ruído
    if (b % 2 === 1) for (let i = 0; i < SR * 0.08 && i0 + i < out.length; i++) out[i0 + i]! += 0.5 * loud * rnd() * Math.exp(-i / (SR * 0.02));
    // chimbal no contratempo, só depois do drop
    if (t0 >= dropS) {
      const h0 = Math.round((t0 + period / 2) * SR);
      for (let i = 0; i < SR * 0.03 && h0 + i < out.length; i++) out[h0 + i]! += 0.25 * rnd() * Math.exp(-i / (SR * 0.006));
    }
  }
  // "sintetizador" de fundo, também mais alto depois do drop
  for (let i = 0; i < out.length; i++) out[i]! += (i / SR >= dropS ? 0.25 : 0.05) * Math.sin(2 * Math.PI * 220 * (i / SR));
  return out;
}
