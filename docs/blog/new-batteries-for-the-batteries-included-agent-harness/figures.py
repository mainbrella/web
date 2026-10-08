"""Draw a hypothetical delayed cleanup across two container generations."""
from pathlib import Path
from html import escape

root = Path(__file__).resolve().parents[3] / 'public/images/blog/new-batteries-for-the-batteries-included-agent-harness'
ink, mute, paper, blue, green, red = '#263238', '#53616a', '#f7f4ec', '#275f85', '#2a6948', '#9b3933'

def text(x, y, value, size=20, color=ink, weight=400, anchor='start'):
    return f'<text x="{x}" y="{y}" font-size="{size}" fill="{color}" font-weight="{weight}" text-anchor="{anchor}">{escape(value)}</text>'

def line(x1, y1, x2, y2, color=mute, dashed=False, arrow=False):
    return f'<path d="M{x1} {y1}L{x2} {y2}" fill="none" stroke="{color}" stroke-width="2.5"' + (' stroke-dasharray="6 6"' if dashed else '') + (' marker-end="url(#arrow)"' if arrow else '') + '/>'

def machine(x, y, w, h, label, generation, fill, color):
    return f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="5" fill="{fill}" stroke="{color}" stroke-width="2"/>' + text(x+w/2, y+32, label, 22, color, 600, 'middle') + text(x+w/2, y+62, generation, 20, color, 400, 'middle')

def svg(w, h, body):
    return f'''<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}" viewBox="0 0 {w} {h}" role="img" aria-labelledby="title desc"><title id="title">A slot is not a machine</title><desc id="desc">A hypothetical cleanup request for generation A is delayed. Slot small is reused for generation B. The request arrives and is rejected because its creation timestamp belongs to A. B continues running.</desc><defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0L10 5L0 10z" fill="{mute}"/></marker></defs><rect width="{w}" height="{h}" fill="{paper}"/><g font-family="Helvetica,Arial,sans-serif">{body}</g></svg>'''

body = text(28, 36, 'Same slot. Different machine.', 25, ink, 600)
body += text(150, 84, 'Old agent', 21, ink, 600, 'middle') + text(727, 84, 'Slot “small”', 21, ink, 600, 'middle')
body += line(150, 105, 150, 420, '#9ba7ac', True) + line(727, 105, 727, 420, '#9ba7ac', True)
body += line(35, 105, 35, 415, mute, False, True) + text(49, 410, 'Time', 17, mute)
body += machine(637, 106, 180, 94, 'CSV job', 'createdAt = A', '#e4eff4', blue)
body += text(839, 158, 'Runs', 18, blue) + text(637, 227, 'A stops; slot is reused', 18, mute)
body += machine(637, 255, 180, 155, 'Next job', 'createdAt = B', '#e4efe7', green)
body += text(727, 383, 'Keeps running', 19, green, 600, 'middle')
body += f'<circle cx="150" cy="142" r="6" fill="{red}"/>' + line(150, 142, 608, 345, red, True)
body += text(226, 138, 'Stop small@A', 22, red, 600) + text(226, 167, 'Message is delayed', 18, mute)
body += line(598, 334, 620, 356, red) + line(620, 334, 598, 356, red)
body += text(307, 372, 'Rejected: A ≠ B', 21, red, 600)
body += text(28, 456, 'A and B stand for two different creation timestamps.', 18, mute)
(root/'a-slot-is-not-a-machine.svg').write_text(svg(920, 480, body))

body = text(22, 34, 'A slot is not a machine', 24, ink, 600)
body += text(22, 67, 'Same name. Different creation time.', 18, mute)
body += text(69, 108, 'Old agent', 19, ink, 600, 'middle') + text(307, 108, 'Slot “small”', 19, ink, 600, 'middle')
body += line(69, 128, 69, 534, '#9ba7ac', True) + line(307, 128, 307, 534, '#9ba7ac', True)
body += machine(225, 130, 164, 94, 'CSV job', 'createdAt = A', '#e4eff4', blue)
body += text(225, 255, 'A stops', 19, mute) + text(225, 281, 'Slot reused', 19, mute)
body += machine(225, 310, 164, 174, 'Next job', 'createdAt = B', '#e4efe7', green)
body += text(307, 454, 'Keeps running', 18, green, 600, 'middle')
body += f'<circle cx="69" cy="153" r="6" fill="{red}"/>' + line(69, 153, 207, 402, red, True)
body += text(22, 332, 'Stop', 19, red, 600) + text(22, 359, 'small@A', 19, red, 600)
body += line(197, 391, 218, 413, red) + line(218, 391, 197, 413, red)
body += text(22, 554, 'Rejected: A ≠ B', 23, red, 600)
body += text(22, 592, 'The request names the old generation.', 19, mute)
body += text(22, 619, 'The replacement stays out of reach.', 19, mute)
(root/'a-slot-is-not-a-machine-mobile.svg').write_text(svg(440, 640, body))
