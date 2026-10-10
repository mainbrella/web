from pathlib import Path
from html import escape

OUT = Path(__file__).parent
PAPER = '#f7f4ec'
INK = '#263238'
MUTED = '#52616a'
BLUE = '#27659a'
BLUE_PALE = '#dce9f2'
LINE = '#aeb8ba'
GREEN = '#356b56'
GREEN_PALE = '#e0ebe3'
GOLD = '#8b641c'
GOLD_PALE = '#f1e8d2'
FONT = 'Arial, Helvetica, sans-serif'
MONO = 'SFMono-Regular, Menlo, Consolas, monospace'

def svg(w, h, title, desc, body):
    return f'''<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}" viewBox="0 0 {w} {h}" role="img" aria-labelledby="title desc">
<title id="title">{escape(title)}</title><desc id="desc">{escape(desc)}</desc>
<defs>
  <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0L10 5L0 10Z" fill="{MUTED}"/></marker>
  <marker id="blue-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0L10 5L0 10Z" fill="{BLUE}"/></marker>
</defs>
<rect width="100%" height="100%" fill="{PAPER}"/>
{body}
</svg>'''

def t(x, y, text, size=16, color=INK, weight=400, family=FONT, anchor='start'):
    return f'<text x="{x}" y="{y}" fill="{color}" font-family="{family}" font-size="{size}" font-weight="{weight}" text-anchor="{anchor}">{escape(text)}</text>'

def rect(x,y,w,h,fill='none',stroke=LINE,sw=1,r=0):
    return f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{r}" fill="{fill}" stroke="{stroke}" stroke-width="{sw}"/>'

def line(x1,y1,x2,y2,color=LINE,sw=1,dash=None,marker=None):
    d = f' stroke-dasharray="{dash}"' if dash else ''
    m = f' marker-end="url(#{marker})"' if marker else ''
    return f'<path d="M{x1} {y1}L{x2} {y2}" fill="none" stroke="{color}" stroke-width="{sw}"{d}{m}/>'

# Figure 1: a schematic comparison of selection extent before and after clear.
def terminal_panel(x, y, w, title, previous=False):
    parts = [t(x, y, title, 18, INK, 600)]
    top = y + 17
    h = 260 if previous else 220
    parts.append(rect(x, top, w, h, '#fffdf8', '#9da9aa', 1, 3))
    # restrained terminal chrome
    for i, c in enumerate(('#b96c5d','#c69a42','#6b9a75')):
        parts.append(f'<circle cx="{x+15+i*14}" cy="{top+14}" r="3.3" fill="{c}"/>')
    parts.append(t(x+13, top+39, 'Schematic terminal buffer', 12, MUTED, 500))
    row_y = top + 61
    row_h = 20
    if previous:
        for idx, content in enumerate(('old build log …', 'old error output …')):
            yy = row_y + idx*row_h
            parts.append(rect(x+10, yy-15, w-20, row_h, BLUE_PALE, 'none', 0))
            parts.append(t(x+17, yy, content, 14, BLUE, 400, MONO))
        row_y += 40
    rows = ['~/project $ cat file.txt', '', 'alpha', 'beta', 'gamma', '~/project $', '']
    for idx, content in enumerate(rows):
        yy = row_y + idx*row_h
        parts.append(rect(x+10, yy-15, w-20, row_h, BLUE_PALE, 'none', 0))
        if content:
            parts.append(t(x+17, yy, content, 14, BLUE, 400, MONO))
    # Bracket is geometrically aligned to every selected row, including retained output.
    y1 = top + 61 - 15
    y2 = row_y + (len(rows)-1)*row_h + 5
    bx = x+w-10
    parts.append(f'<path d="M{bx-8} {y1}H{bx}V{y2}H{bx-8}" fill="none" stroke="{BLUE}" stroke-width="1.5"/>')
    return ''.join(parts)

body = [t(30, 34, 'Cmd+A follows what remains in the buffer', 23, INK, 600),
        t(30, 57, 'Schematic example · the desired scope is file.txt plus two rows above and two below', 14, MUTED)]
body.append(terminal_panel(30, 91, 397, 'Earlier output retained', True))
body.append(terminal_panel(453, 91, 397, 'After Cmd+K clears output', False))
body.append(t(30, 393, 'Blue fill marks selected rows · the clear panel shows two rows around the file.', 14, MUTED))
(OUT/'clear-selection.svg').write_text(svg(880,415,'Clearing output narrows the selection','Schematic terminal buffers compare selecting all while earlier output remains with selecting after Cmd+K clears it. The desired example includes the file contents and exactly two surrounding rows on each side.', ''.join(body)))

body = [t(22, 36, 'Clear output; narrow selection', 22, INK, 600),
        t(22, 60, 'Schematic · file.txt and two rows on each side', 14, MUTED)]
body.append(terminal_panel(22, 91, 346, 'Earlier output retained', True))
body.append(terminal_panel(22, 397, 346, 'After Cmd+K clears output', False))
body.append(t(22, 660, 'Blue fill = selected rows', 13, MUTED))
(OUT/'clear-selection-mobile.svg').write_text(svg(390,684,'Clearing output narrows the selection','Stacked schematic terminal buffers compare selecting all while earlier output remains with selecting after Cmd+K clears it. The desired example includes the file contents and exactly two surrounding rows on each side.', ''.join(body)))

# Figure 2: the selection is a retained value even after its source cells redraw.
def cells(x, y, vals, selected=False, mobile=False):
    gap = 4 if mobile else 6
    cw = 43 if mobile else 48
    ch = 40 if mobile else 44
    p=[]
    for i,v in enumerate(vals):
        xx=x+i*(cw+gap)
        p.append(rect(xx,y,cw,ch,BLUE_PALE if selected else '#fffdf8',BLUE if selected else '#9da9aa',1.3,2))
        if v:
            p.append(t(xx+cw/2,y+27,v,21 if mobile else 23,BLUE if selected else INK,500,MONO,'middle'))
    return ''.join(p)

def snapshot_desktop():
    p=[t(30,35,'The cells can change while the selection stays put',23,INK,600),
       t(30,58,'Schematic redraw sequence',14,MUTED)]
    # event labels and cells
    p += [t(30,94,'Selected cells',16,INK,600),t(30,119,'h e l l o',13,MUTED,400,MONO)]
    p.append(cells(30,132,list('hello'),True))
    p.append(t(310,94,'TUI erases and redraws',16,INK,600))
    p.append(t(310,119,r'\r  ESC[2K',16,BLUE,500,MONO))
    p.append(line(296,154,306,154,MUTED,1.5,marker='arrow'))
    p.append(cells(310,132,['']*5,False))
    p.append(line(578,154,586,154,MUTED,1.5,marker='arrow'))
    p.append(t(620,94,'Live cells now blank',16,INK,600))
    p.append(cells(590,132,['']*5,False))
    # Stored snapshot is independent from live cells, then copied.
    p.append(line(83,184,83,220,BLUE,1.5,marker='blue-arrow'))
    p.append(rect(30,232,390,72,BLUE_PALE,BLUE,1.2,3))
    p.append(t(46,258,'Selection snapshot',14,BLUE,600))
    p.append(t(46,286,'hello',22,BLUE,500,MONO))
    p.append(line(432,267,557,267,BLUE,1.6,marker='blue-arrow'))
    p.append(rect(572,232,278,72,'#fffdf8','#9da9aa',1,3))
    p.append(t(711,260,'Clipboard',15,INK,600,'Arial, Helvetica, sans-serif','middle'))
    p.append(t(711,286,'hello',21,BLUE,500,MONO,'middle'))
    p.append(t(30,340,'Copy reads the saved selection; the visible row has already been cleared.',14,MUTED))
    return ''.join(p)
(OUT/'selection-snapshot.svg').write_text(svg(880,365,'A saved selection survives a terminal redraw','Five selected cells containing hello are erased by a carriage return and clear-line sequence. The selection snapshot remains available to the copy action even though the live cells are blank.',snapshot_desktop()))

p=[t(22,35,'Cells change; selection stays',21,INK,600),
   t(22,58,'Schematic redraw sequence',14,MUTED),
   t(22,94,'1 · Selected cells',15,INK,600),
   cells(22,106,list('hello'),True,True),
   line(134,160,134,184,MUTED,1.4,marker='arrow'),
   t(22,210,'2 · TUI erases and redraws',15,INK,600),
   t(22,234,r'\r  ESC[2K',16,BLUE,500,MONO),
   cells(22,247,['']*5,False,True),
   line(134,294,134,320,MUTED,1.4,marker='arrow'),
   t(22,346,'3 · Live cells now blank',15,INK,600),
   cells(22,359,['']*5,False,True),
   line(134,407,134,436,BLUE,1.5,marker='blue-arrow'),
   rect(22,450,346,89,BLUE_PALE,BLUE,1.2,3),
   t(38,476,'Selection snapshot',14,BLUE,600),
   t(38,514,'hello',22,BLUE,500,MONO),
   line(195,539,195,573,BLUE,1.5,marker='blue-arrow'),
   rect(22,586,346,66,'#fffdf8','#9da9aa',1,3),
   t(195,612,'Clipboard',14,INK,600,'Arial, Helvetica, sans-serif','middle'),
   t(195,640,'hello',20,BLUE,500,MONO,'middle')]
(OUT/'selection-snapshot-mobile.svg').write_text(svg(390,675,'A saved selection survives a terminal redraw','A vertical schematic sequence shows selected hello cells erased by a redraw while the saved selection remains available to copy.', ''.join(p)))

# Figure 3: source-derived actor lanes and chronology, without invented timings.
def topology_desktop():
    p=[t(30,35,'Terminal input and output cross threads',23,INK,600),
       t(30,59,'Reconstructed from disassembly · schematic sequence',14,MUTED)]
    lane_x=[185,452,701]; lane_w=[220,210,156]
    labels=['Main thread','I/O thread','PTY + shell']
    for x,w,label in zip(lane_x,lane_w,labels):
        p.append(t(x+w/2,94,label,16,INK,600,anchor='middle'))
        p.append(line(x+w/2,111,x+w/2,530,'#c4cbca',1,'4 5'))
    # Keyboard bytes are queued on main, then written by the I/O thread.
    p += [rect(185,119,220,52,GOLD_PALE,GOLD,1.2,3),t(295,141,'Encode key input',15,INK,500,anchor='middle'),t(295,161,'queue PTY write',13,MUTED,400,anchor='middle')]
    p.append(rect(452,194,210,52,GREEN_PALE,GREEN,1.2,3));p.append(t(557,216,'Write queued bytes',15,INK,500,anchor='middle'));p.append(t(557,236,'partial writes',13,MUTED,400,anchor='middle'))
    p.append(rect(701,269,156,54,'#fffdf8','#66757a',1.2,3));p.append(t(779,292,'Shell',16,INK,600,anchor='middle'));p.append(t(779,313,'echo + output',13,MUTED,400,anchor='middle'))
    p.append(rect(452,344,210,52,GREEN_PALE,GREEN,1.2,3));p.append(t(557,366,'Read PTY output',15,INK,500,anchor='middle'));p.append(t(557,386,'background I/O',13,MUTED,400,anchor='middle'))
    p.append(rect(185,419,220,52,BLUE_PALE,BLUE,1.2,3));p.append(t(295,441,'Decode bytes',15,INK,500,anchor='middle'));p.append(t(295,461,'VT100 parser',13,MUTED,400,anchor='middle'))
    p.append(rect(185,494,220,52,BLUE_PALE,BLUE,1.2,3));p.append(t(295,516,'Mark rows dirty',15,INK,500,anchor='middle'));p.append(t(295,536,'draw updated rows',13,MUTED,400,anchor='middle'))
    p.append(line(405,145,446,216,MUTED,1.5,marker='arrow'))
    p.append(line(662,220,695,292,MUTED,1.5,marker='arrow'))
    p.append(line(701,310,668,368,MUTED,1.5,marker='arrow'))
    p.append(line(452,370,411,445,MUTED,1.5,marker='arrow'))
    p.append(line(295,471,295,487,MUTED,1.5,marker='arrow'))
    return ''.join(p)
(OUT/'echo-roundtrip.svg').write_text(svg(880,570,'Terminal input and output cross thread boundaries','Reconstructed from disassembly. Key input is encoded and queued on the main thread, written by the I/O thread in partial writes, echoed by the shell, read on the I/O thread, then decoded, parsed, and drawn on the main thread. Sequence is schematic.',topology_desktop()))

p=[t(22,34,'Terminal I/O crosses thread boundaries',18,INK,600),
   t(22,58,'Reconstructed from disassembly · schematic',14,MUTED),
   # clear lanes vertically with events
   t(22,94,'MAIN THREAD',13,BLUE,600),
   rect(22,105,346,54,GOLD_PALE,GOLD,1.2,3),t(36,128,'Encode key input',15,INK,500),t(36,149,'queue PTY write',13,MUTED),
   line(195,159,195,182,MUTED,1.4,marker='arrow'),
   t(22,205,'I/O THREAD',13,GREEN,600),
   rect(22,216,346,54,GREEN_PALE,GREEN,1.2,3),t(36,239,'Write queued bytes',15,INK,500),t(36,259,'partial writes',13,MUTED),
   line(195,270,195,293,MUTED,1.4,marker='arrow'),
   t(22,316,'PTY + SHELL',13,INK,600),
   rect(22,327,346,50,'#fffdf8','#66757a',1.2,3),t(195,358,'Shell echoes output',15,INK,500,anchor='middle'),
   line(195,377,195,400,MUTED,1.4,marker='arrow'),
   t(22,423,'I/O THREAD',13,GREEN,600),
   rect(22,434,346,50,GREEN_PALE,GREEN,1.2,3),t(195,465,'Read PTY output',15,INK,500,anchor='middle'),
   line(195,484,195,507,MUTED,1.4,marker='arrow'),
   t(22,530,'MAIN THREAD',13,BLUE,600),
   rect(22,541,346,54,BLUE_PALE,BLUE,1.2,3),t(36,564,'Decode → VT100 parser',15,INK,500),t(36,584,'mark dirty rows; draw',13,MUTED),]
(OUT/'echo-roundtrip-mobile.svg').write_text(svg(390,615,'Terminal input and output cross thread boundaries','Reconstructed from disassembly. A vertical schematic shows encoded input queued on main, written by the I/O thread in partial writes, echoed by the shell, read on I/O, then decoded, parsed, and drawn on main.', ''.join(p)))
