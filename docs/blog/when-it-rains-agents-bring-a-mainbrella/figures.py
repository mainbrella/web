"""Draw a hypothetical reconnect to one continuing managed execution."""
from html import escape
from pathlib import Path

OUT = Path(__file__).resolve().parents[3] / 'public/images/blog/when-it-rains-agents-bring-a-mainbrella'
PAPER, INK, MUTED, BLUE, GREEN, RED = '#f7f4ec', '#263238', '#53616a', '#275f85', '#2a6948', '#9b3933'


def text(x, y, value, size=20, color=INK, weight=400, anchor='start'):
    return f'<text x="{x}" y="{y}" font-size="{size}" fill="{color}" font-weight="{weight}" text-anchor="{anchor}">{escape(value)}</text>'


def line(x1, y1, x2, y2, color=BLUE, arrow=False, dashed=False):
    marker = 'green' if color == GREEN else 'blue'
    return f'<path d="M{x1} {y1}L{x2} {y2}" fill="none" stroke="{color}" stroke-width="2.5"' + (' stroke-dasharray="6 6"' if dashed else '') + (f' marker-end="url(#{marker})"' if arrow else '') + '/>'


def svg(width, height, body):
    markers = ''.join(f'<marker id="{name}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0L10 5L0 10z" fill="{color}"/></marker>' for name, color in [('blue', BLUE), ('green', GREEN)])
    return f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" viewBox="0 0 {width} {height}" role="img" aria-labelledby="title desc"><title id="title">Reconnect to the same job</title><desc id="desc">Job J runs continuously while the client loses its output stream. Event 2 is retained during the gap. The client reconnects with cursor 1 and receives event 2 and completion without starting J again.</desc><defs>{markers}</defs><rect width="{width}" height="{height}" fill="{PAPER}"/><g font-family="Helvetica,Arial,sans-serif">{body}</g></svg>'


def desktop():
    body = text(28, 36, 'A new stream. The same job.', 25, INK, 600)
    body += text(168, 82, 'Client', 22, INK, 600, 'middle') + text(759, 82, 'Job J', 22, INK, 600, 'middle')
    body += line(168, 104, 168, 426, '#9ba7ac', dashed=True)
    body += '<rect x="704" y="111" width="110" height="315" rx="5" fill="#e4eff4" stroke="#275f85" stroke-width="2"/>'
    body += text(759, 146, 'running', 19, BLUE, 500, 'middle')
    body += line(168, 112, 704, 112, arrow=True) + text(332, 101, 'Start J once', 21, BLUE, 600)
    body += line(704, 180, 168, 180, arrow=True) + text(332, 165, 'Output event 1', 21, BLUE)
    body += '<rect x="80" y="213" width="176" height="68" fill="#f6e8e2" stroke="#9b3933" stroke-width="1.5"/>'
    body += text(168, 240, 'Stream drops', 20, RED, 600, 'middle') + text(168, 265, 'No connection', 18, RED, 400, 'middle')
    body += '<circle cx="759" cy="246" r="7" fill="#275f85"/>'
    body += text(410, 240, 'Event 2 saved', 21, BLUE, 600) + text(410, 265, 'while the client is away', 18, MUTED)
    body += line(168, 314, 704, 314, GREEN, arrow=True) + text(332, 301, 'Resume with cursor 1', 21, GREEN, 600)
    body += line(704, 370, 168, 370, arrow=True) + text(332, 356, 'Output event 2', 21, BLUE)
    body += line(704, 423, 168, 423, GREEN, arrow=True) + text(332, 410, 'Completion', 21, GREEN)
    body += text(28, 455, 'Time ↓', 18, MUTED)
    return svg(920, 470, body)


def mobile():
    body = text(22, 34, 'One job. Two output streams.', 24, INK, 600)
    body += text(82, 92, 'Client', 21, INK, 600, 'middle') + text(350, 92, 'Job J', 21, INK, 600, 'middle')
    body += line(82, 119, 82, 597, '#9ba7ac', dashed=True)
    body += '<rect x="321" y="145" width="58" height="452" rx="5" fill="#e4eff4" stroke="#275f85" stroke-width="2"/>'
    body += line(82, 146, 321, 146, arrow=True) + text(122, 131, 'Start J once', 21, BLUE, 600)
    body += line(321, 216, 82, 216, arrow=True) + text(122, 201, 'Output event 1', 20, BLUE)
    body += '<rect x="22" y="269" width="135" height="70" fill="#f6e8e2" stroke="#9b3933" stroke-width="1.5"/>'
    body += text(89, 297, 'Stream drops', 18, RED, 600, 'middle') + text(89, 322, 'Disconnected', 17, RED, 400, 'middle')
    body += '<circle cx="350" cy="306" r="7" fill="#275f85"/>'
    body += text(187, 295, 'Event 2', 20, BLUE, 600) + text(187, 321, 'saved here', 19, BLUE)
    body += text(187, 354, 'J keeps running', 18, MUTED)
    body += line(82, 416, 321, 416, GREEN, arrow=True) + text(122, 378, 'Resume', 20, GREEN, 600) + text(122, 403, 'with cursor 1', 20, GREEN)
    body += line(321, 496, 82, 496, arrow=True) + text(122, 481, 'Output event 2', 20, BLUE)
    body += line(321, 594, 82, 594, GREEN, arrow=True) + text(122, 577, 'Completion', 20, GREEN)
    body += text(22, 632, 'Time ↓', 18, MUTED)
    return svg(440, 650, body)


if __name__ == '__main__':
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / 'same-job.svg').write_text(desktop())
    (OUT / 'same-job-mobile.svg').write_text(mobile())
