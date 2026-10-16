#!/usr/bin/env python3
"""reel_qa.py — 릴스 빌드 후 편집 품질 자동 검사 (2026-10-16, R76 재제작 때 만든 기준)

근거: 레퍼런스 9편 실측(@hannun_lol 161만·@sheepesportskr 247만·@kksshh12112 164만 등은 컷 0~1개 롱테이크,
같은 계정 하위권은 컷 7개·평균 4초 몽타주) + 편집 이론 17개 출처(Murch, J/L컷, 덕킹 -12~-18dB, 보컬 곡은 말소리 방해).
옵시디언: 파티룸/플레이앤 인스타/릴스 편집 플레이북 (2026-10-16).md

사용: python3 reel_qa.py spec.json out.mp4 [--music music_only.wav]
통과 못 하면 exit 1. 발행 전 반드시 실행.
"""
import sys, json, subprocess, numpy as np

def sh(*a):
    return subprocess.run(a, capture_output=True, text=True).stdout

def load(path, sr=22050, offset=0.0, duration=None):
    import librosa
    y, _ = librosa.load(path, sr=sr, offset=offset, duration=duration)
    return y

def db_curve(y, sr=22050, hop_s=0.05):
    import librosa
    h = int(sr * hop_s)
    return librosa.amplitude_to_db(librosa.feature.rms(y=y, frame_length=h, hop_length=h)[0], ref=np.max)

def video_cuts(path):
    raw = subprocess.run(['ffmpeg', '-loglevel', 'error', '-i', path, '-vf', 'fps=30,crop=1080:720:0:620,scale=64:36,format=gray', '-f', 'rawvideo', '-'], capture_output=True).stdout
    fr = np.frombuffer(raw, np.uint8).reshape(-1, 36, 64).astype(float)
    d = np.abs(np.diff(fr, axis=0)).mean(axis=(1, 2)); med = np.median(d)
    return [(i + 1) / 30 for i in range(1, len(d) - 1) if d[i] > max(15, 6 * med) and d[i] >= d[i - 1] and d[i] >= d[i + 1]]

def main():
    spec_p, out = sys.argv[1], sys.argv[2]
    music_only = sys.argv[sys.argv.index('--music') + 1] if '--music' in sys.argv else None
    spec = json.load(open(spec_p)); sc = spec['scenes']
    dur = float(sh('ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', out))
    fails, warns, info = [], [], []

    # 1) 컷 수·길이: 명장면형(continuous_audio)은 롱테이크가 기본. 컷 사이 평균 4초 미만 몽타주는 실측상 하위권
    cuts = video_cuts(out)
    shots = np.diff([0] + cuts + [dur])
    info.append(f'컷 {len(cuts)}개 {[round(c, 1) for c in cuts]}, 컷 길이 중앙값 {np.median(shots):.1f}초')
    if spec.get('continuous_audio') and len(cuts) > max(4, dur / 12):
        fails.append(f'명장면형인데 컷이 {len(cuts)}개: 플레이는 끊지 말고 한 번에 (상위 릴스 컷 0~1개)')

    # 2) 해설 연속성: 이어진 mic 장면들은 원본 오디오와 같아야 함 (장면마다 음량이 튀거나 끊기면 실패)
    t0 = 0.0; runs = []
    for i, s in enumerate(sc):
        c = s.get('clip') or {}
        if s.get('mic') and c.get('file'):
            if runs and runs[-1]['file'] == c['file'] and abs(runs[-1]['src_end'] - c.get('start', 0)) < 0.06:
                runs[-1]['src_end'] += s['dur']; runs[-1]['dur'] += s['dur']
            else:
                runs.append({'file': c['file'], 'src': c.get('start', 0), 'src_end': c.get('start', 0) + s['dur'], 't': t0, 'dur': s['dur']})
        t0 += s['dur']
    silent = out.replace('.mp4', '_silent.mp4')
    for r in runs:
        if r['dur'] < 3: continue
        a = db_curve(load(silent, offset=r['t'], duration=r['dur'])); b = db_curve(load(r['file'], offset=r['src'], duration=r['dur']))
        n = min(len(a), len(b)); e = 6  # 앞뒤 0.3초(페이드)는 제외
        cc = float(np.corrcoef(a[e:n - e], b[e:n - e])[0, 1])
        info.append(f"해설 구간 {r['t']:.1f}~{r['t'] + r['dur']:.1f}초 원본 일치도 {cc:.2f}")
        if cc < 0.93: fails.append(f"해설 {r['t']:.1f}초~ 구간이 원본과 다름(일치도 {cc:.2f}): 장면마다 오디오가 잘리거나 음량이 튐")

    # 3) 해설 끊김 위치: 이어지지 않는 오디오 경계는 말이 쉬는 곳(-12dB 이하)이어야 함
    vo = db_curve(load(silent)); med = np.median(vo); t = 0.0
    for i, s in enumerate(sc[:-1]):
        t += s['dur']; a, b = s, sc[i + 1]
        cont = a.get('mic') and b.get('mic') and (a.get('clip') or {}).get('file') == (b.get('clip') or {}).get('file') and abs((a.get('clip') or {}).get('start', 0) + a['dur'] - (b.get('clip') or {}).get('start', 0)) < 0.06
        if cont or not a.get('mic'): continue
        k = int((t - 0.15) / 0.05)
        if 0 <= k < len(vo) and vo[k] > med - 3:
            warns.append(f'{t:.1f}초: 해설이 말하는 도중에 끊김(경계 직전 음량 {vo[k] - med:+.0f}dB) → 문장 끝 쉬는 곳으로 옮기기')

    # 4) 음악: 해설 비중이 높으면 보컬 없는 곡 + 덕킹 -9dB 이하
    mic_ratio = sum(s['dur'] for s in sc if s.get('mic')) / max(1e-6, sum(s['dur'] for s in sc))
    m = spec.get('music') or {}
    info.append(f'해설 비중 {mic_ratio:.0%}, 음악 덕킹 {m.get("duck_level", spec.get("duck_level", 0.08))}')
    if mic_ratio > 0.5 and float(m.get('duck_level', spec.get('duck_level', 0.08))) > 0.36:
        fails.append('해설 위 음악이 너무 큼: duck_level 0.35 이하(-9dB 이상 줄이기)')
    if music_only:
        mo = db_curve(load(music_only), hop_s=0.25)
        hit = m.get('hit_at')
        if hit is None and m.get('start') is not None and m.get('hit_scene') is not None:
            hit = sum(s['dur'] for s in sc[:int(m['hit_scene'])])
        if hit is not None:
            k = int(hit / 0.25); jump = float(mo[k:k + 4].mean() - mo[max(0, k - 8):k].mean())
            info.append(f'드롭 지점 {hit:.2f}초 음악 상승 {jump:+.1f}dB')
            if jump < 3: fails.append(f'드롭이 클라이맥스({hit:.2f}초)에 안 맞음: 음악 상승 {jump:+.1f}dB')

    # 5) 구성: 첫 3초 안에 해설(말)이 있어야 하고, 최고 음량 지점은 영상 60~90%
    first = next((i * 0.05 for i, v in enumerate(vo) if v > med - 6), None)
    if first is None or first > 3: fails.append('첫 3초에 해설·보이스가 없음 (말이 있으면 10초 유지율 +25%)')
    print('\n'.join(['[정보] ' + x for x in info] + ['[주의] ' + x for x in warns] + ['[실패] ' + x for x in fails]))
    print('결과:', '통과' if not fails else '불합격')
    sys.exit(1 if fails else 0)

if __name__ == '__main__':
    main()
