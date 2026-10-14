import math
from fontTools.ttLib import TTFont
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.boundsPen import BoundsPen
from fontTools.pens.transformPen import TransformPen
PINK="#E6195E"; OUT="/home/claude/playn-help/assets/brand/logo/"
FONT="/tmp/claude-0/-home-claude-playn-help/bce54a3f-f25b-5321-ba58-b17424ecd5aa/scratchpad/fnt/k/yg-jalnan/package/fonts/yg-jalnan-normal.woff"
R=100; SW=24; D=206
def mark(color, cx0=0, cy0=0):
    # circle centers
    c1=(cx0, cy0); c2=(cx0+D, cy0)
    a=math.acos(2*R/D)
    P1=(c1[0]+R*math.cos(a), c1[1]-R*math.sin(a))      # left ring top-right
    P2=(c2[0]-R*math.cos(a), c2[1]+R*math.sin(a))      # right ring bottom-left
    def pt(c,deg): r=math.radians(deg); return (c[0]+R*math.cos(r), c[1]+R*math.sin(r))
    S=pt(c2,-140)   # right ring start cap (top-left)
    E=pt(c1,40)     # left ring end cap (bottom-right)
    f=lambda p:"%.2f %.2f"%p
    path=(f"M {f(S)} A {R} {R} 0 1 1 {f(P2)} L {f(P1)} A {R} {R} 0 1 0 {f(E)}")
    g=[f'<path d="{path}" fill="none" stroke="{color}" stroke-width="{SW}" stroke-linecap="round" stroke-linejoin="round"/>']
    # plus
    L=40
    g.append(f'<path d="M {c1[0]-L} {c1[1]} H {c1[0]+L} M {c1[0]} {c1[1]-L} V {c1[1]+L}" stroke="{color}" stroke-width="{SW+4}" stroke-linecap="round"/>')
    # dots
    for dx,dy in [(0,-37),(37,0),(0,37),(-37,0)]:
        g.append(f'<circle cx="{c2[0]+dx}" cy="{c2[1]+dy}" r="19.5" fill="{color}"/>')
    return "\n".join(g)
# mark bbox: x from -R-SW/2 to D+R+SW/2 ; y -R-SW/2 .. R+SW/2
mx0=-R-SW/2; mx1=D+R+SW/2; my0=-R-SW/2; my1=R+SW/2
MW=mx1-mx0; MH=my1-my0
# wordmark
ft=TTFont(FONT); gs=ft.getGlyphSet(); cmap=ft.getBestCmap(); upm=ft['head'].unitsPerEm
from fontTools.pens.boundsPen import BoundsPen as BP
def gb(ch):
    g=cmap[ord(ch)]; bp=BP(gs); gs[g].draw(bp); return g,bp.bounds
_,pb=gb("P"); capu=pb[3]-pb[1]
capPx=MH*54/81; scale=capPx/capu
REL={"P":0,"l":49/54,"a":69/54,"y":109/54,"N":161/54}
text="PlayN"
def textpath(x0, base, color):
    pen=SVGPathPen(gs); xr=0
    for ch in text:
        g,b=gb(ch)
        x=x0+REL[ch]*capPx - b[0]*scale
        tp=TransformPen(pen,(scale,0,0,-scale,x,base)); gs[g].draw(tp)
        xr=max(xr,x+b[2]*scale)
    return f'<path d="{pen.getCommands()}" fill="{color}"/>', xr
gap=MH*16/81
base=my0+MH*(108-44)/81
tp,xend=textpath(mx1+gap, base, PINK)
W=xend-mx0; pad=20
def svg(w,h,vb,body,bg=None):
    b=f'<rect x="{vb[0]}" y="{vb[1]}" width="{vb[2]}" height="{vb[3]}" fill="{bg}"/>' if bg else ''
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{vb[0]:.1f} {vb[1]:.1f} {vb[2]:.1f} {vb[3]:.1f}" width="{w}" height="{h}">{b}{body}</svg>'
# descender of y goes below; compute bounds
bp=BoundsPen(gs); 
vb=(mx0-pad, my0-pad, W+2*pad, MH+2*pad+MH*0.12)
open(OUT+"playn_logo.svg","w").write(svg(int(vb[2]),int(vb[3]),vb,mark(PINK)+tp))
open(OUT+"playn_logo_white.svg","w").write(svg(int(vb[2]),int(vb[3]),vb,mark("#fff")+textpath(mx1+gap,base,'#fff')[0]))
vbm=(mx0-pad,my0-pad,MW+2*pad,MH+2*pad)
open(OUT+"playn_mark.svg","w").write(svg(int(vbm[2]),int(vbm[3]),vbm,mark(PINK)))
# app icon: pink circle with white mark
cxm=(mx0+mx1)/2; s=MW*1.45
vbi=(cxm-s/2, -s/2, s, s)
icon=f'<circle cx="{cxm}" cy="0" r="{s/2}" fill="{PINK}"/>'+mark("#fff")
open(OUT+"playn_icon.svg","w").write(svg(512,512,vbi,icon))
# square-ish icon for favicon (rounded square)
open(OUT+"playn_icon_sq.svg","w").write(svg(512,512,vbi,f'<rect x="{cxm-s/2}" y="{-s/2}" width="{s}" height="{s}" rx="{s*0.22}" fill="{PINK}"/>'+mark("#fff")))
print("ok", vb)
