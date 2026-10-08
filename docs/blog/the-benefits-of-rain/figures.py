from pathlib import Path
from html import escape

# Schematic topology from the adjacent backend's account and runtime controllers.
# Filled state survives stopping Linux; dashed compute is stopped, not a metric.
root = Path(__file__).resolve().parents[3] / 'public/images/blog/the-benefits-of-rain'
ink, blue, mute, paper, line = '#263238', '#275f85', '#53616a', '#f7f4ec', '#92a0a7'

def text(x, y, s, size=18, color=ink, weight=400, anchor='start'):
    return f'<text x="{x}" y="{y}" font-size="{size}" fill="{color}" font-weight="{weight}" text-anchor="{anchor}">{escape(s)}</text>'

def path(d, color=blue, dash=False):
    dashed = ' stroke-dasharray="5 5"' if dash else ''
    return f'<path d="{d}" fill="none" stroke="{color}" stroke-width="2"{dashed}/>'

def rect(x, y, w, h, fill, stroke=ink, dash=False, rx=5):
    dashed = ' stroke-dasharray="5 5"' if dash else ''
    return f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{rx}" fill="{fill}" stroke="{stroke}" stroke-width="1.5"{dashed}/>'

def disk(x, y):
    return f'<path d="M{x-13} {y}v17c0 8 26 8 26 0V{y}" fill="#cce0e9" stroke="{blue}" stroke-width="1.5"/><ellipse cx="{x}" cy="{y}" rx="13" ry="4" fill="#e4eff4" stroke="{blue}" stroke-width="1.5"/>'

def controller(cx, y):
    return rect(cx-52, y, 104, 34, '#e4eff4', blue) + text(cx, y+23, 'Controller', 17, blue, 600, 'middle')

def linux(cx, y, live=True):
    if live:
        return rect(cx-46, y, 92, 52, '#ffffff', blue) + path(f'M{cx-28} {y+14}l7 7-7 7m13 0h13') + text(cx, y+43, 'Linux', 15, blue, 600, 'middle')
    return rect(cx-46, y, 92, 52, 'none', line, True) + text(cx, y+31, 'Stopped', 15, mute, 400, 'middle')

def account(x, y, w, label, second=False):
    s = rect(x, y, w, 312, '#efede6', '#a8b2b6', rx=8)
    s += text(x+18, y+30, label, 20, ink, 600)
    c = x+w/2
    s += rect(c-104, y+58, 208, 67, '#e4eff4', blue) + text(c-80, y+83, 'Account coordinator', 17, blue, 600) + disk(c-79, y+96) + text(c-58, y+114, 'Shared usage', 15, blue)
    s += path(f'M{c} {y+125}v21M{c-75} {y+146}h150M{c-75} {y+146}v17M{c+75} {y+146}v17')
    for i, off in enumerate([-75, 75]):
        cx = c+off
        s += controller(cx, y+163)
        s += path(f'M{cx} {y+197}v23', line if second and i==1 else blue, second and i==1)
        s += linux(cx, y+220, not(second and i==1))
    s += text(c, y+295, 'Stored state survives a stop', 17, mute, 400, 'middle')
    return s

def svg(w, h, body, title, desc):
    return f'<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}" viewBox="0 0 {w} {h}" role="img" aria-labelledby="title desc"><title id="title">{title}</title><desc id="desc">{desc}</desc><rect width="{w}" height="{h}" fill="{paper}"/><g font-family="Helvetica,Arial,sans-serif">{body}</g></svg>'

body = text(26, 32, 'Two customers, separate budgets', 22, ink, 600)
body += rect(349, 53, 222, 48, '#ffffff', blue) + text(460, 83, 'API Worker', 20, blue, 600, 'middle')
body += text(26, 84, 'Sessions + API keys', 16, mute) + text(722, 84, 'Account / billing in D1', 16, mute)
body += account(26, 142, 426, 'Customer A') + account(468, 142, 426, 'Customer B', True)
body += path('M349 77H239V200M571 77H681V200')
(root/'account-boundaries.svg').write_text(svg(920, 480, body, 'Account records outlive Linux compute', 'The API routes to separate account coordinators. Each account shares usage across two workspace controllers. One Linux machine is stopped; its controller and shared usage record remain.'))

body = text(20, 31, 'One customer’s shared budget', 21, ink, 600)
body += rect(105, 54, 230, 47, '#ffffff', blue) + text(220, 84, 'API Worker', 20, blue, 600, 'middle')
body += text(220, 126, 'Sessions + keys · D1 account data', 15, mute, 400, 'middle')
body += account(20, 158, 400, 'Customer account', True)
body += path('M220 140V216')
body += text(24, 508, 'Stop the Linux machine.', 20, ink, 600) + text(24, 538, 'Its controller and the account’s', 18, mute) + text(24, 565, 'usage records remain in storage.', 18, mute)
body += disk(49, 593) + text(78, 613, 'Persistent state', 16, blue) + rect(28, 638, 40, 30, 'none', line, True) + text(78, 660, 'Stopped compute', 16, mute)
(root/'account-boundaries-mobile.svg').write_text(svg(440, 700, body, 'An account budget survives a stopped machine', 'The API routes to one account coordinator and two workspace controllers. One Linux machine is stopped. Persistent state remains above the disposable Linux compute.'))
