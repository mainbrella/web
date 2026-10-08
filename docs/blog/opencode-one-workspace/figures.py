"""Exact topology and schematic lifetimes for the experimental OpenCode adapter.

Run from any directory with python3. Outputs are original editorial diagrams;
the shell-only placement is hypothetical, and time is not a measured scale.
The social PNG is rendered from one-filesystem.svg during the browser QA step.
"""
from html import escape
from pathlib import Path

OUT = Path(__file__).resolve().parents[3] / 'public/images/blog/opencode-one-workspace'
OUT.mkdir(parents=True, exist_ok=True)
INK, MUTED, PAPER = '#263238', '#53616a', '#f7f4ec'
BLUE, GREEN, RED = '#275f85', '#2a6948', '#9b3933'


def text(x, y, label, size=20, color=INK, weight=400, anchor='start'):
    return f'<text x="{x}" y="{y}" fill="{color}" font-size="{size}" font-weight="{weight}" text-anchor="{anchor}">{escape(label)}</text>'


def rect(x, y, w, h, fill, stroke='none', dashed=False):
    return f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="4" fill="{fill}" stroke="{stroke}" stroke-width="2"' + (' stroke-dasharray="6 5"' if dashed else '') + '/>'


def line(x1, y1, x2, y2, color=MUTED, dashed=False, arrow=False, width=2):
    return f'<path d="M{x1} {y1}L{x2} {y2}" fill="none" stroke="{color}" stroke-width="{width}"' + (' stroke-dasharray="6 5"' if dashed else '') + (f' marker-end="url(#{color[1:]})"' if arrow else '') + '/>'


def dot(x, y, color):
    return f'<circle cx="{x}" cy="{y}" r="5" fill="{color}"/>'


def file(x, y, label, revision, color):
    return f'<path d="M{x} {y}h75l18 18v64h-93z M{x+75} {y}v18h18" fill="#fffdf7" stroke="{color}" stroke-width="2"/>' + text(x+10, y+39, label, 18, color, 600) + text(x+10, y+64, revision, 16, color)


def svg(name, w, h, title, description, body):
    markers = ''.join(f'<marker id="{c[1:]}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M0 0L10 5L0 10z" fill="{c}"/></marker>' for c in [MUTED, BLUE, GREEN, RED])
    (OUT / name).write_text(f'<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}" viewBox="0 0 {w} {h}" role="img" aria-labelledby="title desc"><title id="title">{escape(title)}</title><desc id="desc">{escape(description)}</desc><defs>{markers}</defs><rect width="{w}" height="{h}" fill="{PAPER}"/><g font-family="Helvetica,Arial,sans-serif">{body}</g></svg>')


def topology(mobile=False):
    if mobile:
        b = text(20, 33, 'Move only bash (hypothetical)', 21, RED, 600)
        b += rect(20, 52, 185, 220, '#f1e4df', RED) + rect(225, 52, 195, 220, '#edf0f1', MUTED)
        b += text(35, 82, 'Laptop', 21, INK, 600) + text(240, 82, 'Guest', 21, INK, 600)
        b += text(35, 121, 'read · edit', 20, RED) + text(240, 121, 'bash / test', 20)
        b += line(85, 136, 85, 161, RED, arrow=True) + line(290, 136, 290, 161, MUTED, arrow=True)
        b += file(40, 171, 'parser.ts', 'edited', RED) + file(245, 171, 'parser.ts', 'unchanged', MUTED)
        b += text(20, 306, 'Move the server (our PR)', 21, GREEN, 600)
        b += rect(20, 326, 130, 288, '#edf0f1', MUTED) + rect(170, 326, 250, 288, '#e4efe7', GREEN)
        b += text(35, 356, 'Laptop', 21, INK, 600) + text(185, 356, 'Guest', 21, INK, 600)
        b += text(35, 403, 'Interface', 19, BLUE) + line(119, 410, 191, 410, BLUE, arrow=True)
        b += rect(199, 383, 201, 83, '#fffdf7', GREEN) + text(212, 415, 'OpenCode server', 19, GREEN, 600)
        b += text(212, 444, 'read · edit · test', 19, GREEN) + line(292, 470, 292, 497, GREEN, arrow=True)
        b += file(246, 507, 'parser.ts', 'edited', GREEN) + text(20, 644, 'All three tools see the same checkout.', 19, GREEN)
        return b
    b = text(24, 34, 'Move only bash (hypothetical)', 24, RED, 600)
    b += rect(24, 55, 392, 167, '#f1e4df', RED) + rect(456, 55, 400, 167, '#edf0f1', MUTED)
    b += text(42, 85, 'Laptop', 22, INK, 600) + text(474, 85, 'Guest', 22, INK, 600)
    b += text(50, 145, 'read · edit', 22, RED) + line(169, 139, 252, 139, RED, arrow=True)
    b += file(270, 106, 'parser.ts', 'edited', RED)
    b += text(483, 145, 'bash / test', 22) + line(610, 139, 690, 139, MUTED, arrow=True)
    b += file(710, 106, 'parser.ts', 'unchanged', MUTED)
    b += text(24, 263, 'Move the server (our PR)', 24, GREEN, 600)
    b += rect(24, 285, 290, 169, '#edf0f1', MUTED) + rect(354, 285, 502, 169, '#e4efe7', GREEN)
    b += text(42, 315, 'Laptop', 22, INK, 600) + text(372, 315, 'Guest', 22, INK, 600)
    b += text(55, 379, 'Interface', 22, BLUE) + line(165, 371, 392, 371, BLUE, arrow=True)
    b += rect(409, 336, 225, 87, '#fffdf7', GREEN) + text(424, 370, 'OpenCode server', 22, GREEN, 600)
    b += text(424, 401, 'read · edit · test', 21, GREEN) + line(641, 376, 690, 376, GREEN, arrow=True)
    b += file(710, 337, 'parser.ts', 'edited', GREEN)
    b += text(24, 485, 'All three tools see the same checkout.', 20, GREEN)
    return b


description = 'The hypothetical shell-only placement reads and edits the host checkout but tests a separate guest checkout. The PR instead places the OpenCode server and all three tools beside one guest checkout.'
svg('one-filesystem.svg', 880, 500, 'Which checkout does each tool touch?', description, topology())
svg('one-filesystem-mobile.svg', 440, 660, 'Which checkout does each tool touch?', description, topology(True))


def lifetime(mobile=False):
    if mobile:
        b = text(20, 33, 'Same server, renewed address', 22, INK, 600)
        b += text(20, 83, 'Guest server', 20, GREEN, 600) + line(28, 108, 384, 108, GREEN, width=7)
        b += text(20, 155, 'Preview access', 20, BLUE, 600)
        b += line(28, 185, 174, 185, BLUE, width=7) + text(40, 175, 'A', 20, BLUE, 600)
        b += line(209, 185, 384, 185, BLUE, width=7) + text(225, 175, 'B', 20, BLUE, 600)
        b += line(174, 184, 174, 259, MUTED, dashed=True) + dot(174, 185, RED)
        b += line(182, 232, 229, 199, BLUE, arrow=True)
        b += text(20, 281, 'A expires → resolve target again', 19)
        b += text(20, 309, 'Reconnect uses B; files stay put.', 19)
        b += line(384, 66, 384, 231, RED, dashed=True) + text(246, 244, 'Hard deadline', 19, RED, 600)
        b += text(20, 364, 'Renewing B cannot move the deadline.', 18, MUTED)
        return b
    b = text(24, 34, 'Same server, renewed address', 25, INK, 600)
    b += text(24, 99, 'Guest server', 21, GREEN, 600) + line(215, 92, 806, 92, GREEN, width=8)
    b += text(24, 170, 'Preview access', 21, BLUE, 600)
    b += line(215, 163, 453, 163, BLUE, width=8) + text(250, 147, 'A', 21, BLUE, 600)
    b += line(491, 163, 806, 163, BLUE, width=8) + text(526, 147, 'B', 21, BLUE, 600)
    b += line(453, 112, 453, 247, MUTED, dashed=True) + dot(453, 163, RED)
    b += text(240, 226, 'A expires', 20, RED) + line(464, 220, 520, 179, BLUE, arrow=True)
    b += text(526, 226, 'Resolve target again', 20, BLUE, 600) + text(526, 255, 'Reconnect through B', 20, BLUE)
    b += line(806, 57, 806, 270, RED, dashed=True) + text(791, 296, 'Hard deadline', 20, RED, 600, 'end')
    b += text(24, 310, 'Renewing access leaves the machine’s deadline where it was.', 19, MUTED)
    return b


description = 'One guest server runs while preview A expires and preview B is issued. Reconnection resolves the changed target. Preview renewal does not extend the machine hard deadline; an idle deadline may end the server sooner.'
svg('renew-the-address.svg', 880, 330, 'One machine, two preview grants', description, lifetime())
svg('renew-the-address-mobile.svg', 440, 400, 'One machine, two preview grants', description, lifetime(True))
