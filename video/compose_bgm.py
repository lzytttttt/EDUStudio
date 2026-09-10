# -*- coding: utf-8 -*-
"""EDUStudio 60s 宣传片配乐：程序化合成，节拍与分镜对齐。
段落: 0-10 轻缓 / 10-30 高速推进 / 30-40 略缓看成果 / 40-49 温暖课堂 / 49-56 全奏 / 56-60 收束
"""
import os
import numpy as np, wave, struct, math

SR = 44100
DUR = 60.0
N = int(SR * DUR)
BPM = 100.0
BEAT = 60.0 / BPM          # 0.6s
SX = BEAT / 4              # 十六分音符

rng = np.random.default_rng(7)
mix = np.zeros(N)


def i0_of(t):
    return int(round(t * SR))


def add(i0, sig, gain=1.0):
    """把信号叠加到主混合"""
    if i0 >= N:
        return
    start = max(i0, 0)
    off = start - i0
    n = min(len(sig) - off, N - start)
    if n > 0:
        mix[start:start + n] += sig[off:off + n] * gain


def midi(m):
    return 440.0 * (2.0 ** ((m - 69) / 12.0))


def lowpass(x, fc=2600.0):
    """窗化 sinc FIR 低通"""
    if fc >= SR / 2:
        return x
    M = 61
    n = np.arange(M) - (M - 1) // 2
    h = np.sinc(2 * fc / SR * n) * np.hanning(M)
    h /= h.sum()
    return np.convolve(x, h, mode='same')


def marimba(f, dur=1.1, decay=4.2, gain=0.5):
    n = int(dur * SR)
    tt = np.arange(n) / SR
    env = np.exp(-decay * tt) * (1 - np.exp(-tt / 0.003))
    w = (np.sin(2 * np.pi * f * tt)
         + 0.34 * np.sin(4 * np.pi * f * tt) * np.exp(-6 * tt)
         + 0.11 * np.sin(6 * np.pi * f * tt) * np.exp(-13 * tt))
    return w * env * gain


def pad(freqs, dur, amp=0.24):
    n = int(dur * SR)
    tt = np.arange(n) / SR
    sig = np.zeros(n)
    for f in freqs:
        for det in (0.9965, 1.0, 1.0038):
            sig += np.sin(2 * np.pi * f * det * tt)
        sig += 0.16 * np.sin(4 * np.pi * f * tt)
    sig /= (len(freqs) * 3.16)
    a = np.clip(tt / 0.75, 0, 1)
    r = np.clip((dur - tt) / 1.0, 0, 1)
    sig *= a * np.minimum(1.0, r)
    return lowpass(sig, 2200) * amp


def bass(f, dur, amp=0.30):
    n = int(dur * SR)
    tt = np.arange(n) / SR
    env = np.clip(tt / 0.012, 0, 1) * np.exp(-tt * 2.6)
    w = np.sin(2 * np.pi * f * tt) + 0.28 * np.sin(4 * np.pi * f * tt) + 0.08 * np.sin(6 * np.pi * f * tt)
    return w * env * amp


def kick():
    n = int(0.30 * SR)
    tt = np.arange(n) / SR
    f = 46 + 100 * np.exp(-tt / 0.032)
    ph = 2 * np.pi * np.cumsum(f) / SR
    body = np.sin(ph) * np.exp(-tt * 12.5)
    click = rng.normal(0, 1, n) * np.exp(-tt * 320) * 0.22
    return (body + click) * 0.85


def hat(open_=False):
    n = int((0.16 if open_ else 0.055) * SR)
    tt = np.arange(n) / SR
    nz = rng.normal(0, 1, n)
    nz = np.diff(nz, prepend=0)           # 一阶高通
    return nz * np.exp(-tt * (38 if open_ else 110)) * (0.16 if open_ else 0.11)


def shaker():
    n = int(0.12 * SR)
    tt = np.arange(n) / SR
    nz = rng.normal(0, 1, n)
    nz = np.diff(nz, prepend=0)
    nz = np.diff(nz, prepend=0)
    return nz * np.exp(-tt * 55) * 0.30


def clap():
    n = int(0.19 * SR)
    tt = np.arange(n) / SR
    s = np.zeros(n)
    for d in (0.0, 0.011, 0.023):
        k = int(d * SR)
        m = n - k
        s[k:] += rng.normal(0, 1, m) * np.exp(-np.arange(m) / SR * 95)
    s += rng.normal(0, 1, n) * np.exp(-tt * 26) * 0.35
    return s * 0.20


# ---------------- 和声 ----------------
# C - G - Am - F，明亮正向
PROG = [
    dict(root=48, notes=[60, 64, 67, 71]),   # C
    dict(root=43, notes=[55, 59, 62, 67]),   # G
    dict(root=45, notes=[57, 60, 64, 67]),   # Am
    dict(root=41, notes=[53, 57, 60, 65]),   # F
]
PENTA = [60, 62, 64, 67, 69, 72, 74]      # C 五声

nsteps = int(DUR / SX)
for i in range(nsteps):
    t = i * SX
    beat = t / BEAT
    bar = int(beat // 4)
    ch = PROG[bar % 4]
    inbar = beat - bar * 4                  # 0..4
    is16 = i % 4
    is8 = i % 2

    # ---- 段落判定 ----
    intro = t < 9.8
    drive1 = 9.8 <= t < 18.4
    drive2 = 18.4 <= t < 30.0
    showcase = 30.0 <= t < 40.0
    classrm = 40.0 <= t < 49.0
    skill = 49.0 <= t < 56.2
    outro = t >= 56.2

    # ---- PAD（全程）----
    if is16 == 0 and abs(inbar) < 1e-6:
        amp = 0.20
        if drive2 or skill:
            amp = 0.26
        if classrm:
            amp = 0.28
        if outro:
            amp = 0.30
        dur = BEAT * 4 + 0.9
        if outro and t > 57.0:
            dur = max(dur, DUR - t + 1.6)
        add(i0_of(t), pad([midi(n) for n in ch['notes']], dur, amp))

    # ---- 低音 ----
    if (drive2 or skill or classrm) and not outro:
        if is16 == 0 and (abs(inbar) < 1e-6 or abs(inbar - 2.5) < 1e-6):
            add(i0_of(t), bass(midi(ch['root']), BEAT * 1.6, 0.26))

    # ---- 琶音 marimba ----
    arp_on = drive1 or drive2 or showcase or classrm or skill
    if arp_on:
        dense = (drive2 or skill)
        step = 1 if dense else 2
        if is16 % step == 0:
            seq = ch['notes'] + ch['notes'][-2::-1][:2]
            idx = int((i / step) % len(seq))
            amp = 0.30 if not dense else 0.34
            if showcase:
                amp = 0.26
            add(i0_of(t), marimba(midi(seq[idx] + 12), dur=0.9, decay=5.0, gain=amp))

    # ---- 稀疏点缀（intro）----
    if intro and is16 == 0 and abs(inbar % 2.0) < 1e-6 and t > 0.6:
        add(i0_of(t), marimba(midi(ch['notes'][i % len(ch['notes'])] + 12), dur=1.5, decay=3.4, gain=0.30))

    # ---- 鼓 ----
    if not intro and not outro:
        if drive1 or drive2 or skill:
            if is16 == 0 and (abs(inbar) < 1e-6 or abs(inbar - 2) < 1e-6):
                add(i0_of(t), kick())
            if drive2 or skill:
                if is16 == 0 and abs(inbar - 3.5) < 1e-6:
                    add(i0_of(t), kick(), 0.7)
        if showcase or classrm:
            if is16 == 0 and abs(inbar) < 1e-6:
                add(i0_of(t), kick(), 0.9)
        # hat
        if is8 == 0 and (drive1 or drive2 or showcase or classrm or skill):
            add(i0_of(t), hat(open_=(abs(inbar - 3.5) < 1e-6)), 0.9 if not showcase else 0.75)
        if (drive2 or skill) and is16 % 2 == 1:
            add(i0_of(t), hat(), 0.5)
        # shaker
        if (drive2 or classrm or skill) and is8 == 0:
            add(i0_of(t), shaker(), 0.55)
        # clap
        if (classrm or skill) and is16 == 0 and (abs(inbar - 1) < 1e-6 or abs(inbar - 3) < 1e-6):
            add(i0_of(t), clap())

    # ---- 主旋律 ----
    if showcase:
        mel = [72, 69, 67, 64, 67, 69, 72, 74]
        if is16 == 0 and abs(inbar % 2.0) < 1e-6 and t >= 30.4:
            k = int(round((t - 30.4) / (BEAT * 2))) % len(mel)
            add(i0_of(t), marimba(midi(mel[k]), dur=1.3, decay=2.6, gain=0.34))
    if classrm:
        mel = [64, 67, 69, 67, 64, 62, 64, 67, 69, 72, 69, 67, 64, 62, 60]
        if is16 == 0 and t >= 40.2:
            k = int(round((t - 40.2) / BEAT)) % len(mel)
            add(i0_of(t), marimba(midi(mel[k]), dur=1.4, decay=2.4, gain=0.36))

    # ---- 收束 ----
    if outro:
        if abs(t - 56.2) < 1e-6:
            add(i0_of(t), kick())
        if abs(t - 56.2) < 1e-6:
            # 上行琶音冲向 Logo
            for k, nn in enumerate([60, 64, 67, 72, 76, 79]):
                add(i0_of(t + k * 0.075), marimba(midi(nn), dur=2.0, decay=2.0, gain=0.34))
        if abs(t - 57.9) < 1e-6:
            add(i0_of(t), pad([midi(n) for n in [60, 64, 67, 71]], 3.0, 0.26))

# ---------------- 空间感 / 母带 ----------------
def space(x):
    y = x.copy()
    for dms, g in ((37, 0.22), (53, 0.17), (71, 0.13), (97, 0.09), (131, 0.06)):
        d = int(dms * SR / 1000)
        y[d:] += x[:-d] * g
    return y


wet = space(mix)
out = mix * 0.82 + wet * 0.30

# 柔和削波
out = np.tanh(out * 1.15) * 0.92
# 去除直流
out -= out.mean()
# 整体轻微压低刺耳高频
out = lowpass(out, 12000)

peak = np.max(np.abs(out))
if peak > 0:
    out = out / peak * 0.72

# 淡入 / 淡出
fi = int(0.7 * SR)
out[:fi] *= np.linspace(0, 1, fi)
fo = int(2.4 * SR)
out[-fo:] *= np.linspace(1, 0, fo) ** 1.4

pcm = np.clip(out * 32767, -32768, 32767).astype('<i2')
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'bgm.wav')
with wave.open(OUT, 'wb') as w:
    w.setnchannels(1)
    w.setsampwidth(2)
    w.setframerate(SR)
    w.writeframes(pcm.tobytes())

print('bgm.wav written  duration=%.2fs  peak=%.3f  rms=%.4f' % (len(out) / SR, np.max(np.abs(out)), np.sqrt(np.mean(out ** 2))))
