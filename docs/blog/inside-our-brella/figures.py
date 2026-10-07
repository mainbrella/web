"""Rebuild the article's schematic figures. Python standard library only.

The intervals encode ordering, not measured time. Desktop and mobile versions
show the same decisions with different geometry. Source evidence lives in
containers/container-account-core.js, user-container-core.js and workspaces.js
in the adjacent backend repository.
"""
from html import escape
from pathlib import Path

OUT = Path(__file__).resolve().parents[3] / 'public/images/blog/inside-our-brella'
INK, MUTED, BLUE, GREEN, RED, PAPER = '#242d35', '#58636d', '#315f82', '#27624e', '#a23832', '#f5f3ed'


class Drawing:
    def __init__(self, width, height, title, description):
        self.width, self.height = width, height
        self.parts = [f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" viewBox="0 0 {width} {height}" role="img" aria-labelledby="title desc">',
                      f'<title id="title">{escape(title)}</title><desc id="desc">{escape(description)}</desc>',
                      '<defs>']
        for name, color in [('ink', INK), ('blue', BLUE), ('red', RED), ('muted', MUTED)]:
            self.parts.append(f'<marker id="{name}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="{color}"/></marker>')
        self.parts.extend(['</defs>', f'<rect width="{width}" height="{height}" fill="{PAPER}"/>'])

    def text(self, x, y, value, size=22, color=INK, anchor='start', weight='400', rotate=None):
        transform = f' transform="rotate({rotate} {x} {y})"' if rotate else ''
        self.parts.append(f'<text x="{x}" y="{y}" fill="{color}" font-family="Arial, Helvetica, sans-serif" font-size="{size}" font-weight="{weight}" text-anchor="{anchor}"{transform}>{escape(str(value))}</text>')

    def path(self, path, color=INK, dashed=False, arrow=None, width=2):
        dash = ' stroke-dasharray="7 6"' if dashed else ''
        marker = f' marker-end="url(#{arrow})"' if arrow else ''
        self.parts.append(f'<path d="{path}" fill="none" stroke="{color}" stroke-width="{width}"{dash}{marker}/>')

    def rect(self, x, y, w, h, fill, stroke='none', radius=0):
        self.parts.append(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{radius}" fill="{fill}" stroke="{stroke}" stroke-width="2"/>')

    def circle(self, x, y, r=5, fill=INK):
        self.parts.append(f'<circle cx="{x}" cy="{y}" r="{r}" fill="{fill}"/>')

    def cross(self, x, y, color=RED, r=8):
        self.path(f'M{x-r} {y-r} L{x+r} {y+r} M{x-r} {y+r} L{x+r} {y-r}', color, width=3)

    def check(self, x, y):
        self.path(f'M{x-7} {y} l5 5 l10 -12', GREEN, width=3)

    def receipt(self, x, y, width, height, handle, mobile=False):
        self.parts.append(f'<path d="M{x} {y} H{x+width-20} l20 20 V{y+height} H{x} Z" fill="#fffefd" stroke="{MUTED}" stroke-width="2"/>')
        self.path(f'M{x+width-20} {y} v20 h20', MUTED)
        f = 20 if mobile else 24
        self.text(x+16, y+39, 'save: a7…', f)
        self.text(x+16, y+76, 'handle:', f, MUTED)
        if handle:
            self.text(x+16, y+109, 'snap: b9…', f, BLUE)
        else:
            self.path(f'M{x+16} {y+105} h{width-32}', MUTED, dashed=True)

    def save(self, name):
        OUT.mkdir(parents=True, exist_ok=True)
        (OUT / name).write_text('\n'.join(self.parts + ['</svg>']) + '\n')


def admission(mobile=False):
    d = Drawing(440 if mobile else 920, 640 if mobile else 420,
                'Sequential reservations, overlapping boots',
                'The account saves each reservation in sequence, then independent runtimes boot concurrently. Time is schematic.')
    if mobile:
        d.text(24, 35, 'Reserve in order; boot in parallel', 23, weight='600')
        d.text(24, 63, 'Schematic time ↓', 18, MUTED)
        for x, label in [(70, 'Account'), (182, 'c17'), (277, 'c18'), (372, 'c19')]:
            d.text(x, 106, label, 20, anchor='middle')
        d.path('M70 125 V570', MUTED, dashed=True, arrow='muted')
        starts, ends = [175, 270, 365], [450, 530, 495]
        for i, (x, start, end) in enumerate(zip([182, 277, 372], starts, ends), 1):
            d.path(f'M87 {start} H{x}', BLUE, arrow='blue')
            d.rect(52, start-18, 36, 36, INK, radius=2)
            d.text(70, start+7, i, 20, PAPER, 'middle')
        for x, start, end in zip([182, 277, 372], starts, ends):
            d.rect(x-23, start+8, 46, end-start-8, '#dce6ed', BLUE, 2)
            d.text(x+6, (start+end)/2, 'boot', 20, BLUE, 'middle', rotate=-90)
            d.check(x, end+16)
            d.text(x, end+47, 'ready', 18, GREEN, 'middle')
        d.text(24, 610, '■ = reservation committed to storage', 19, MUTED)
    else:
        d.text(32, 38, 'Reserve in order; boot in parallel', 25, weight='600')
        d.path('M248 68 H867', MUTED, arrow='muted')
        d.text(867, 53, 'Schematic time', 18, MUTED, 'end')
        d.text(32, 139, 'Account lock', 22)
        for i, x in enumerate([285, 385, 485], 1):
            d.rect(x-18, 109, 36, 36, INK, radius=2)
            d.text(x, 135, i, 23, PAPER, 'middle')
        for y, x, end, label in [(191, 310, 730, 'c17'), (261, 410, 800, 'c18'), (331, 510, 755, 'c19')]:
            d.text(32, y+27, label, 22)
            d.rect(x, y, end-x, 40, '#dce6ed', BLUE, 2)
            d.text((x+end)/2, y+27, 'boot + readiness', 22, BLUE, 'middle')
            d.check(end+23, y+20)
            d.text(end+42, y+27, 'ready', 20, GREEN)
        d.text(32, 402, '■ = durable reservation. Each boot begins after its own commit.', 19, MUTED)
    d.save('admission-mobile.svg' if mobile else 'admission.svg')


def fence(mobile=False):
    d = Drawing(440 if mobile else 920, 690 if mobile else 560,
                'A delayed boot reaches a reused slot',
                'Cancel 41 precedes boot 42. Delayed boot 41 is rejected and late cancel 41 leaves the replacement running. Time runs down.')
    if mobile:
        a, r = 64, 303
        d.text(24, 36, 'The older message arrives last', 23, weight='600')
        d.text(24, 65, 'Schematic time ↓', 18, MUTED)
        d.text(a, 107, 'Account', 20, anchor='middle')
        d.text(r, 107, 'c17 runtime', 20, anchor='middle')
        d.path(f'M{a} 126 V643', MUTED, dashed=True)
        d.path(f'M{r} 126 V643', MUTED, dashed=True)
        d.rect(r-8, 330, 16, 305, '#cce2d6')
        d.path(f'M{a} 145 C190 145 181 465 {r} 465', RED, dashed=True, arrow='red')
        d.text(154, 140, 'boot 41', 20, RED)
        d.text(154, 164, 'delayed', 18, RED)
        for y, label, color, marker in [(220, 'cancel 41', INK, 'ink'), (330, 'boot 42', BLUE, 'blue'), (570, 'cancel 41', MUTED, 'muted')]:
            d.path(f'M{a} {y} H{r}', color, arrow=marker)
            d.text(235, y-13, label, 20, color, 'middle')
        d.text(325, 244, 'fenced', 18, MUTED)
        d.text(325, 268, '≤ 41', 19, MUTED)
        d.text(325, 354, 'accept', 18, GREEN)
        d.text(325, 378, '42', 20, GREEN)
        d.cross(r, 465)
        d.text(325, 459, 'reject', 18, RED)
        d.text(325, 483, '41', 20, RED)
        d.text(325, 596, 'ignore', 18, MUTED)
        d.text(325, 620, '41', 20, MUTED)
        d.text(24, 671, 'Replacement 42 remains running.', 20, GREEN)
    else:
        a, r = 152, 694
        d.text(32, 38, 'The older message arrives last', 25, weight='600')
        d.text(32, 67, 'Schematic time ↓', 18, MUTED)
        d.text(a, 96, 'Account', 22, anchor='middle')
        d.text(r, 96, 'Runtime · c17', 22, anchor='middle')
        d.path(f'M{a} 110 V510', MUTED, dashed=True)
        d.path(f'M{r} 110 V510', MUTED, dashed=True)
        d.rect(r-9, 250, 18, 260, '#cce2d6')
        d.path(f'M{a} 120 C405 120 442 350 {r} 350', RED, dashed=True, arrow='red')
        d.text(275, 116, 'boot 41 · delayed in transit', 21, RED)
        for y, label, color, marker in [(175, 'cancel 41', INK, 'ink'), (250, 'boot 42', BLUE, 'blue'), (447, 'cancel 41 · late cleanup', MUTED, 'muted')]:
            d.path(f'M{a} {y} H{r}', color, arrow=marker)
            d.text(520, y-14, label, 21, color, 'middle')
        d.text(724, 181, 'canceled: 41', 21, MUTED)
        d.text(724, 256, 'accepted: 42', 21, GREEN)
        d.cross(r, 350)
        d.text(724, 346, 'reject boot 41', 21, RED)
        d.text(724, 375, '41 ≤ 42', 20, RED)
        d.text(724, 453, 'ignore stop 41', 21, MUTED)
        d.text(724, 482, '41 < 42', 20, MUTED)
        d.text(32, 540, 'The green interval is the replacement’s lifetime; old messages cannot take ownership.', 19, GREEN)
    d.save('reservation-fence-mobile.svg' if mobile else 'reservation-fence.svg')


def snapshot(mobile=False):
    d = Drawing(440 if mobile else 920, 740 if mobile else 590,
                'A saved handle separates recovery from uncertainty',
                'A retry recovers a saved provider handle. If only capture intent remains, the operation stays unresolved and capture is not repeated.')
    if mobile:
        d.text(24, 35, 'What survived the lost answer?', 23, weight='600')
        d.text(220, 91, 'Provider capture attempt', 20, anchor='middle')
        d.path('M220 110 V148')
        d.path('M220 148 H112 V222', arrow='ink')
        d.path('M220 148 H325 V222', arrow='ink')
        d.text(111, 186, 'Handle saved', 19, GREEN, 'middle')
        d.text(325, 186, 'Handle missing', 19, RED, 'middle')
        d.receipt(37, 231, 150, 132, True, True)
        d.receipt(250, 231, 150, 132, False, True)
        d.text(220, 401, 'Durable runtime receipts', 19, MUTED, 'middle')
        d.path('M112 418 V464', arrow='blue', color=BLUE)
        d.path('M325 418 V464', arrow='ink')
        d.text(112, 497, 'Read handle', 20, BLUE, 'middle')
        d.text(112, 526, 'Commit at account', 18, BLUE, 'middle')
        d.text(325, 497, '503', 23, RED, 'middle', '600')
        d.text(325, 526, 'Unresolved', 20, RED, 'middle')
        d.path('M325 551 H426 V91 H362', RED, dashed=True, arrow='red')
        d.cross(426, 205, r=7)
        d.text(325, 580, 'No recapture', 18, RED, 'middle')
        d.rect(103, 613, 18, 18, GREEN)
        d.parts.append(f'<path d="M317 610 l21 12 l-21 12 Z" fill="{GREEN}"/>')
        d.text(112, 662, 'Stop allowed', 20, GREEN, 'middle')
        d.text(325, 657, 'Save leaves', 20, GREEN, 'middle')
        d.text(325, 685, 'source intact', 20, GREEN, 'middle')
        d.text(24, 721, 'Both branches start with a saved intent.', 19, MUTED)
    else:
        d.text(32, 38, 'What survived the lost answer?', 25, weight='600')
        d.text(460, 95, 'Provider capture attempt', 22, anchor='middle')
        d.path('M460 112 V148')
        d.path('M460 148 H232 V212', arrow='ink')
        d.path('M460 148 H688 V212', arrow='ink')
        d.text(232, 184, 'Handle saved before reply loss', 22, GREEN, 'middle')
        d.text(688, 184, 'Handle lost before durable write', 22, RED, 'middle')
        d.receipt(112, 223, 240, 133, True)
        d.receipt(568, 223, 240, 133, False)
        d.text(460, 392, 'Durable runtime receipts', 20, MUTED, 'middle')
        d.path('M232 414 V441', BLUE, arrow='blue')
        d.path('M688 414 V441', arrow='ink')
        d.text(232, 474, 'Retry reads handle; account commits', 22, BLUE, 'middle')
        d.text(688, 474, 'Retry returns 503 · unresolved', 22, RED, 'middle')
        d.path('M808 289 H877 V88 H620', RED, dashed=True, arrow='red')
        d.cross(877, 203)
        d.text(688, 511, 'No recapture', 20, RED, 'middle')
        d.rect(145, 532, 18, 18, GREEN)
        d.text(180, 549, 'Stop allowed', 22, GREEN)
        d.parts.append(f'<path d="M565 532 l20 10 l-20 10 Z" fill="{GREEN}"/>')
        d.text(601, 549, 'Save leaves source intact', 22, GREEN)
        d.text(32, 580, 'The dashed return path is blocked: a saved intent is not permission to repeat capture.', 19, MUTED)
    d.save('snapshot-receipt-mobile.svg' if mobile else 'snapshot-receipt.svg')


if __name__ == '__main__':
    for make in (admission, fence, snapshot):
        make()
        make(mobile=True)
