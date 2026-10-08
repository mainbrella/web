"""Conceptual timelines, not measurements or an implemented renewal path."""
from html import escape
from pathlib import Path

OUT = Path(__file__).resolve().parents[3] / 'public/images/blog/open-your-mainbrella-with-two-hands'
PAPER, INK, MUTED, BLUE, GREEN, RED = '#f7f4ec', '#263238', '#53616a', '#275f85', '#2a6948', '#9b3933'


def text(x, y, label, size=20, color=INK, weight=400):
    return f'<text x="{x}" y="{y}" font-size="{size}" fill="{color}" font-weight="{weight}">{escape(label)}</text>'


def rect(x, y, w, h, color):
    return f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="4" fill="{color}"/>'


def svg(w, h, body):
    return f'<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}" viewBox="0 0 {w} {h}" role="img" aria-labelledby="title desc"><title id="title">Access expires before the machine</title><desc id="desc">A hypothetical timeline. The original machine and its disk outlive the preview endpoint. Renewal could reconnect to that generation. A replacement machine starts with a separate disk. Renewal is proposed, not implemented.</desc><rect width="{w}" height="{h}" fill="{PAPER}"/><g font-family="Helvetica,Arial,sans-serif">{body}</g></svg>'


def desktop():
    b = text(28, 38, 'The address expires. The work is still there.', 25, INK, 600)
    b += text(240, 87, 'Start') + text(528, 87, 'Preview expires', 18, RED, 600) + text(766, 87, 'Hard lease ends', 18)
    b += '<path d="M560 98V340" stroke="#9b3933" stroke-width="2" stroke-dasharray="5 5"/>'
    b += text(28, 141, 'Machine A', 21, INK, 600)
    b += rect(240, 115, 600, 38, BLUE) + text(257, 141, 'Same generation · same disk', 19, '#ffffff')
    b += text(28, 212, 'Preview access', 21)
    b += rect(240, 186, 320, 38, GREEN) + text(257, 212, 'Usable endpoint', 19, '#ffffff')
    b += '<path d="M571 204H832" stroke="#2a6948" stroke-width="3" stroke-dasharray="7 6"/>'
    b += text(588, 189, 'Renewal would go here', 18, GREEN)
    b += text(588, 232, 'Not implemented', 17, MUTED)
    b += text(28, 287, 'Replacement B', 21)
    b += rect(595, 261, 245, 38, '#ece0da') + text(610, 287, 'Separate disk', 19, RED, 600)
    b += text(240, 345, 'Time →    Schematic: the machine lease is longer than the preview.', 17, MUTED)
    return svg(920, 380, b)


def mobile():
    b = text(22, 34, 'Access expires first', 25, INK, 600)
    b += text(22, 65, 'Same work, unreachable address', 19, MUTED)
    b += text(122, 113, 'Start', 17) + text(235, 113, 'Preview', 17, RED, 600) + text(235, 134, 'expires', 17, RED, 600)
    b += '<path d="M258 144V437" stroke="#9b3933" stroke-width="2" stroke-dasharray="5 5"/>'
    b += text(22, 179, 'A', 23, INK, 600) + rect(122, 151, 290, 42, BLUE)
    b += text(135, 178, 'Same machine and disk', 18, '#ffffff')
    b += text(22, 242, 'Access', 19) + rect(122, 215, 136, 40, GREEN)
    b += text(133, 241, 'Endpoint', 18, '#ffffff')
    b += '<path d="M270 235H412" stroke="#2a6948" stroke-width="3" stroke-dasharray="7 6"/>'
    b += text(270, 281, 'Renewal', 18, GREEN, 600) + text(270, 305, 'proposed', 17, GREEN)
    b += text(22, 363, 'B', 23, INK, 600) + rect(270, 335, 142, 42, '#ece0da')
    b += text(279, 362, 'Separate disk', 17, RED, 600)
    b += text(122, 416, 'Time →', 18, MUTED)
    b += text(22, 465, 'Schematic: A stays alive until its hard lease.', 17, MUTED)
    b += text(22, 491, 'Renewal would reconnect to A.', 17, MUTED)
    b += text(22, 517, 'Starting B would not recover A’s files.', 17, MUTED)
    return svg(440, 540, b)


if __name__ == '__main__':
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / 'two-clocks.svg').write_text(desktop())
    (OUT / 'two-clocks-mobile.svg').write_text(mobile())
