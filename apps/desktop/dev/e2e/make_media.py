"""Gera mídia sintética para os testes de interface: episódio de 150 s (2 lutas + 2 trechos calmos)
e uma música de 128 BPM com drop em ~32 s. Requer ffmpeg. Saída em /tmp/media."""
import math, os, random, struct, subprocess, wave

random.seed(7)
os.makedirs('/tmp/media', exist_ok=True)
os.chdir('/tmp/media')

def seg(dur, noise, i, hue):
    f = f'/tmp/media/s{i:03d}.mp4'
    vf = f"geq=r='128+100*sin(X/40+{hue})':g='128+100*sin(Y/30+{hue*2})':b='128+100*cos((X+Y)/50+{hue})',noise=alls={noise}:allf=t+u"
    subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-f', 'lavfi', '-i', f'color=c=black:s=640x360:r=24:d={dur}', '-vf', vf, '-an', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', f], check=True)
    return f

plan = []
for lo, hi, kind in [(0, 50, 'fight'), (50, 65, 'calm'), (65, 120, 'fight'), (120, 150, 'calm')]:
    x = lo
    while x < hi - 0.1:
        d = round(random.uniform(1.0, 2.2), 2) if kind == 'fight' else round(random.uniform(3, 5), 2)
        d = min(d, hi - x)
        plan.append((d, 90 if kind == 'fight' else 5))
        x += d
files = [seg(d, n, i, random.random() * 6) for i, (d, n) in enumerate(plan)]
open('list.txt', 'w').write(''.join(f"file '{f}'\n" for f in files))
subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', 'list.txt', '-c', 'copy', 'v.mp4'], check=True)

sr = 22050
def write_wav(path, samples):
    w = wave.open(path, 'wb'); w.setnchannels(1); w.setsampwidth(2); w.setframerate(sr)
    w.writeframes(b''.join(struct.pack('<h', int(max(-1, min(1, x)) * 20000)) for x in samples)); w.close()

n = sr * 150
a = [0.0] * n
for i in range(n):
    s = i / sr
    fight = s < 50 or 65 <= s < 120
    a[i] = random.uniform(-1, 1) * (0.35 if fight else 0.01)
write_wav('ep_audio.wav', a)
subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-i', 'v.mp4', '-i', 'ep_audio.wav', '-c:v', 'copy', '-c:a', 'aac', '-shortest', 'episodio.mp4'], check=True)

per = 60 / 128
n = sr * 80
m = [0.0] * n
beat = 0
while beat * per < 80:
    t0 = beat * per
    drop = t0 >= 32
    for k in range(int(0.12 * sr)):
        i = int(t0 * sr) + k
        if i >= n: break
        m[i] += math.sin(2 * math.pi * (55 + 60 * math.exp(-k / 600)) * k / sr) * math.exp(-k / 1500) * (0.9 if drop else 0.35)
    beat += 1
for i in range(n):
    m[i] += 0.08 * math.sin(2 * math.pi * 220 * i / sr) * (1 if i / sr >= 32 else 0.4)
write_wav('m.wav', m)
subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-i', 'm.wav', '-b:a', '192k', 'musica_128bpm.mp3'], check=True)
print('ok: /tmp/media/episodio.mp4 e musica_128bpm.mp3')
