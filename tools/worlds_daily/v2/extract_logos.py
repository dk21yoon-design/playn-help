#!/usr/bin/env python3
"""공식 하이라이트 끝 결과 화면(1920x1080 프레임)에서 양 팀 로고를 흰색 투명 PNG로 잘라낸다.
사용: python3 extract_logos.py result_frame.jpg LEFT_CODE RIGHT_CODE [outdir]
결과 화면 상단 스코어보드 배치(2026 월드 방송 그래픽): 왼쪽 로고 x270~455, 오른쪽 x1465~1650, y40~215
업로드: playn-media/templates/worlds_logos/<CODE>.png (이미 있으면 덮어쓰지 않아도 됨)"""
import sys
from PIL import Image
import numpy as np
def cut(src, box, out):
    im = Image.open(src).convert("L")
    if im.size != (1920, 1080): im = im.resize((1920, 1080))
    im = im.crop(box); a = np.array(im).astype(float)
    al = np.clip((a - 95) * 2.2, 0, 255).astype("uint8")
    rgba = Image.new("RGBA", im.size, (255, 255, 255, 0)); rgba.putalpha(Image.fromarray(al))
    bb = rgba.getbbox(); rgba.crop(bb).save(out); return out
if __name__ == "__main__":
    f, l, r = sys.argv[1:4]; d = sys.argv[4] if len(sys.argv) > 4 else "."
    print(cut(f, (270, 40, 455, 215), f"{d}/{l}.png"), cut(f, (1465, 40, 1650, 215), f"{d}/{r}.png"))
