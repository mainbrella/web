"""Draw a schematic of clearToStart's wrapped-line operation; no measured timings."""
from html import escape
from pathlib import Path

ROOT = Path(__file__).parent
COMMAND = "$ printf '%s\\n' alpha beta gamma"
ROWS = [COMMAND[:20], COMMAND[20:]]
INK = '#263238'
BLUE = '#175c91'
GREEN = '#185d3b'
PAPER = '#f7f4ec'

def text(x, y, value, size=17, color=INK, mono=False, bold=False):
    font = 'Menlo, Consolas, monospace' if mono else 'Arial, Helvetica, sans-serif'
    weight = 'font-weight="600"' if bold else ''
    return f'<text x="{x}" y="{y}" fill="{color}" font-family="{font}" font-size="{size}" {weight}>{escape(value)}</text>'

def rect(x,y,w,h,fill,stroke='none',dash=''):
    return f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="3" fill="{fill}" stroke="{stroke}" {dash}/>'

def panel(x,y,after=False,w=356):
    parts=[text(x,y,'After Command-K' if after else 'Before Command-K',20,bold=True)]
    y+=22
    parts.append(rect(x,y,w,43,'#e7ecea' if after else '#f1dfd8'))
    parts.append(text(x+12,y+27,'scrollback empty' if after else 'older scrollback',16,color=INK))
    y+=59
    parts.append(rect(x,y,w,166,'#fff',stroke='#b5bcb7'))
    lines=ROWS+['',''] if after else ['build: finished']+ROWS+['']
    offset=0 if after else 1
    for i,line in enumerate(lines):
        row_y=y+i*40+6
        if offset<=i<offset+2:
            parts.append(rect(x+31,row_y,w-39,36,'#e4f0e8'))
        elif line:
            parts.append(rect(x+31,row_y,w-39,36,'#f6e8e3'))
        parts.append(text(x+10,row_y+25,str(i),14,color='#59666a',mono=True))
        parts.append(text(x+42,row_y+25,line,17,mono=True,color=GREEN if offset<=i<offset+2 else INK))
    # Cursor at column 5 of the continuation row, retained in that column.
    cursor_y=y+(offset+1)*40+9
    parts.append(f'<path d="M{x+42+5*10.2} {cursor_y}v29" stroke="{BLUE}" stroke-width="2.5"/>')
    # A bracket joins the two physical rows that belong to one logical line.
    brace_y=y+offset*40+12
    parts.append(f'<path d="M{x+w+7} {brace_y}h8v60h-8" fill="none" stroke="{GREEN}" stroke-width="2"/>')
    parts.append(text(x,y+196,'same command · same cursor column',16,color=GREEN) if after else text(x,y+196,'two rows · one logical line',16,color=GREEN))
    return ''.join(parts)

def draw(mobile=False):
    w,h=(390,686) if mobile else (880,410)
    parts=[f'<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}" viewBox="0 0 {w} {h}"><title>Command-K keeps the entire wrapped command</title>',rect(0,0,w,h,PAPER)]
    if mobile:
        parts.append(panel(20,35,w=332))
        parts.append(text(20,340,'Move the wrapped line together',17,color=BLUE,bold=True))
        parts.append(panel(20,382,True,w=332))
    else:
        parts.append(panel(28,45))
        parts.append(panel(494,45,True))
        parts.append('<path d="M410 196h49m-8-7 8 7-8 7" fill="none" stroke="#175c91" stroke-width="2"/>')
        parts.append(text(28,376,'The emulator changes its buffer. No Control-L goes to the shell.',17,color=BLUE))
    parts.append('</svg>')
    return ''.join(parts)

for mobile in [False,True]:
    path=ROOT/('clear-wrapped-line-mobile.svg' if mobile else 'clear-wrapped-line.svg')
    path.write_text(draw(mobile)+'\n')
