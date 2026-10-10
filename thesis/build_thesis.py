"""Builds the individual thesis (.docx) in the SLIIT format.

Run:  python thesis/build_thesis.py
Output: thesis/Individual_Thesis_DRAFT.docx

Formatting rules applied (SLIIT "Guidelines on Documentation and Submission of Dissertations"):
  A4; margins left/bottom 40 mm, top/right 25 mm; Times New Roman; 1.5 line spacing (single for
  abstract, tables, captions); chapter headings ALL CAPS 14 pt bold (each on a new page); section
  headings Title Case 12 pt bold; sub-section headings Sentence case 12 pt bold; body 12 pt;
  preliminary pages numbered i, ii ... centred at the bottom (title page unnumbered); body and
  appendices numbered 1, 2 ... at the bottom right.
Content lives in thesis/chapters/*.md (simple markup, see parse_chapter()).
"""
import os
import re
import sys

from docx import Document
from docx.enum.section import WD_SECTION
from docx.enum.table import WD_TABLE_ALIGNMENT
from docx.enum.text import WD_ALIGN_PARAGRAPH, WD_COLOR_INDEX
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Mm, Pt, RGBColor, Cm

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from refs import REFS  # noqa: E402

CH_DIR = os.path.join(HERE, 'chapters')
FIG_DIR = os.path.join(HERE, 'figures')
OUT = os.path.join(HERE, 'Individual_Thesis_DRAFT.docx')
FONT = 'Times New Roman'

# ----------------------------------------------------------------------------
# Placeholders for the title page / declaration (edit here, or in Word)
# ----------------------------------------------------------------------------
META = {
    'title': 'MINDPULSE: A PERSONALISED MULTIMODAL STRESS MONITORING SYSTEM',
    'component': 'Personalised stress detection from HRV and GSR using a smart ring',
    'name': 'Wehara Soyza',
    'student_id': '[STUDENT ID]',
    'group_id': '[GROUP ID]',
    'degree': 'Bachelor of Science (Hons) in Information Technology',
    'spec': '[SPECIALISATION]',
    'department': 'Department of Information Technology',
    'month_year': '[MONTH YEAR OF SUBMISSION]',
    'supervisor': '[SUPERVISOR NAME]',
    'cosupervisor': '[CO-SUPERVISOR NAME]',
}


# ----------------------------------------------------------------------------
# Low-level helpers
# ----------------------------------------------------------------------------
def set_run_font(run, size=None, bold=None, italic=None, color=None):
    run.font.name = FONT
    rpr = run._r.get_or_add_rPr()
    rfonts = rpr.find(qn('w:rFonts'))
    if rfonts is None:
        rfonts = OxmlElement('w:rFonts')
        rpr.append(rfonts)
    for a in ('w:ascii', 'w:hAnsi', 'w:eastAsia', 'w:cs'):
        rfonts.set(qn(a), FONT)
    if size:
        run.font.size = Pt(size)
    if bold is not None:
        run.font.bold = bold
    if italic is not None:
        run.font.italic = italic
    if color:
        run.font.color.rgb = RGBColor(*color)


def style_font(style, size, bold=False, italic=False):
    style.font.name = FONT
    style.font.size = Pt(size)
    style.font.bold = bold
    style.font.italic = italic
    style.font.color.rgb = RGBColor(0, 0, 0)
    rpr = style.element.get_or_add_rPr()
    rfonts = rpr.find(qn('w:rFonts'))
    if rfonts is None:
        rfonts = OxmlElement('w:rFonts')
        rpr.append(rfonts)
    for a in ('w:ascii', 'w:hAnsi', 'w:eastAsia', 'w:cs'):
        rfonts.set(qn(a), FONT)
    for a in ('w:asciiTheme', 'w:hAnsiTheme', 'w:eastAsiaTheme', 'w:cstheme'):
        if rfonts.get(qn(a)) is not None:
            del rfonts.attrib[qn(a)]


def add_field(par, instr, cached=''):
    def fc(kind):
        r = par.add_run()
        el = OxmlElement('w:fldChar')
        el.set(qn('w:fldCharType'), kind)
        r._r.append(el)
        return r
    fc('begin')
    r = par.add_run()
    it = OxmlElement('w:instrText')
    it.set(qn('xml:space'), 'preserve')
    it.text = f' {instr} '
    r._r.append(it)
    fc('separate')
    rr = par.add_run(cached)
    set_run_font(rr, 12)
    fc('end')


def set_pg_num(section, fmt, start=1):
    sect = section._sectPr
    for old in sect.findall(qn('w:pgNumType')):
        sect.remove(old)
    el = OxmlElement('w:pgNumType')
    el.set(qn('w:fmt'), fmt)
    el.set(qn('w:start'), str(start))
    cols = sect.find(qn('w:cols'))
    if cols is not None:
        cols.addprevious(el)
    else:
        sect.append(el)


def set_margins(section):
    section.page_width = Mm(210)
    section.page_height = Mm(297)
    section.left_margin = Mm(40)
    section.bottom_margin = Mm(40)
    section.top_margin = Mm(25)
    section.right_margin = Mm(25)
    section.footer_distance = Mm(15)
    section.header_distance = Mm(12)


def footer_page_number(section, align):
    section.footer.is_linked_to_previous = False
    p = section.footer.paragraphs[0]
    for r in list(p.runs):
        r._r.getparent().remove(r._r)
    p.alignment = align
    add_field(p, 'PAGE', '1')


def para(doc, text='', align=None, size=12, bold=False, italic=False, spacing=1.5, after=6, before=0,
         keep_next=False, indent_first=False):
    p = doc.add_paragraph()
    pf = p.paragraph_format
    pf.line_spacing = spacing
    pf.space_after = Pt(after)
    pf.space_before = Pt(before)
    pf.keep_with_next = keep_next
    if indent_first:
        pf.first_line_indent = Mm(0)
    if align is not None:
        p.alignment = align
    if text:
        add_inline(p, text, size=size, bold=bold, italic=italic)
    return p


# ----------------------------------------------------------------------------
# Inline markup: **bold**, *italic*, [[TODO: ...]], {{cite:..}}, {{fig:..}}, {{tab:..}}, {{eq:..}}
# ----------------------------------------------------------------------------
TOKEN = re.compile(r'(\*\*.+?\*\*|\*[^*\s][^*]*?\*|\[\[.*?\]\]|\{\{.*?\}\})')


class Registry:
    def __init__(self):
        self.fig = {}   # key -> "4.1"
        self.tab = {}
        self.eq = {}
        self.cite_order = []  # keys in order of first citation
        self.chapter_no = 0

    def cite_number(self, key):
        if key not in REFS:
            raise KeyError(f'unknown reference key: {key}')
        if key not in self.cite_order:
            self.cite_order.append(key)
        return self.cite_order.index(key) + 1


REG = Registry()


def fmt_cites(keys):
    nums = sorted({REG.cite_number(k.strip()) for k in keys})
    parts, i = [], 0
    while i < len(nums):
        j = i
        while j + 1 < len(nums) and nums[j + 1] == nums[j] + 1:
            j += 1
        if j - i >= 2:
            parts.append(f'[{nums[i]}]–[{nums[j]}]')
        else:
            parts.extend(f'[{n}]' for n in nums[i:j + 1])
        i = j + 1
    return ', '.join(parts)


def add_inline(p, text, size=12, bold=False, italic=False):
    for tok in TOKEN.split(text):
        if not tok:
            continue
        if tok.startswith('**') and tok.endswith('**') and len(tok) > 4:
            r = p.add_run(tok[2:-2])
            set_run_font(r, size, True, italic)
        elif tok.startswith('[[') and tok.endswith(']]'):
            r = p.add_run('[' + tok[2:-2] + ']')
            set_run_font(r, size, bold, italic)
            r.font.highlight_color = WD_COLOR_INDEX.YELLOW
        elif tok.startswith('{{') and tok.endswith('}}'):
            kind, _, val = tok[2:-2].partition(':')
            if kind == 'cite':
                out = fmt_cites(val.split(','))
            elif kind == 'fig':
                out = 'Figure ' + REG.fig[val]
            elif kind == 'tab':
                out = 'Table ' + REG.tab[val]
            elif kind == 'eq':
                out = '(' + REG.eq[val] + ')'
            else:
                out = tok
            r = p.add_run(out)
            set_run_font(r, size, bold, italic)
        elif tok.startswith('*') and tok.endswith('*') and len(tok) > 2:
            r = p.add_run(tok[1:-1])
            set_run_font(r, size, bold, True)
        else:
            r = p.add_run(tok)
            set_run_font(r, size, bold, italic)


# ----------------------------------------------------------------------------
# Chapter parsing -> block list
# ----------------------------------------------------------------------------
def parse_chapter(path):
    """Block types: ('h1', text, numbered) ('h2', text) ('h3', text) ('p', text) ('bullets', [..])
    ('numbers', [..]) ('table', key, caption, rows, source) ('figure', key, file, caption, source)
    ('eq', key, text)"""
    lines = open(path, encoding='utf-8').read().split('\n')
    blocks, buf, i = [], [], 0

    def flush():
        nonlocal buf
        if buf:
            blocks.append(('p', ' '.join(s.strip() for s in buf)))
            buf = []

    while i < len(lines):
        ln = lines[i].rstrip()
        if not ln.strip():
            flush(); i += 1; continue
        if ln.startswith('#- '):
            flush(); blocks.append(('h1', ln[3:].strip(), False))
        elif ln.startswith('# '):
            flush(); blocks.append(('h1', ln[2:].strip(), True))
        elif ln.startswith('###- '):
            flush(); blocks.append(('h3u', ln[5:].strip()))
        elif ln.startswith('##- '):
            flush(); blocks.append(('h2u', ln[4:].strip()))
        elif ln.startswith('### '):
            flush(); blocks.append(('h3', ln[4:].strip()))
        elif ln.startswith('## '):
            flush(); blocks.append(('h2', ln[3:].strip()))
        elif ln.startswith('- '):
            flush(); items = []
            while i < len(lines) and lines[i].startswith('- '):
                items.append(lines[i][2:].strip()); i += 1
            blocks.append(('bullets', items)); continue
        elif re.match(r'^\d+\. ', ln):
            flush(); items = []
            while i < len(lines) and re.match(r'^\d+\. ', lines[i]):
                items.append(re.sub(r'^\d+\. ', '', lines[i]).strip()); i += 1
            blocks.append(('numbers', items)); continue
        elif ln.startswith('Table['):
            flush()
            m = re.match(r'Table\[(.+?)\]:\s*(.*)', ln)
            key, cap = m.group(1), m.group(2)
            rows, source = [], ''
            i += 1
            while i < len(lines) and lines[i].startswith('|'):
                rows.append([c.strip() for c in lines[i].strip().strip('|').split('|')]); i += 1
            if i < len(lines) and lines[i].startswith('Source:'):
                source = lines[i][7:].strip(); i += 1
            blocks.append(('table', key, cap, rows, source)); continue
        elif ln.startswith('Figure['):
            flush()
            m = re.match(r'Figure\[(.+?)\]:\s*(.*)', ln)
            key, rest = m.group(1), m.group(2)
            parts = [x.strip() for x in rest.split('|')]
            source = ''
            if i + 1 < len(lines) and lines[i + 1].startswith('Source:'):
                source = lines[i + 1][7:].strip(); i += 1
            blocks.append(('figure', key, parts[0], parts[1] if len(parts) > 1 else '', parts[2] if len(parts) > 2 else '', source))
        elif ln.startswith('Eq['):
            flush()
            m = re.match(r'Eq\[(.+?)\]:\s*(.*)', ln)
            blocks.append(('eq', m.group(1), m.group(2)))
        else:
            buf.append(ln)
        i += 1
    flush()
    return blocks


def number_blocks(all_blocks):
    """Pre-pass: assigns chapter-based numbers to figures, tables and equations."""
    ch = 0
    label = '0'
    cf = ct = ce = 0
    for blocks in all_blocks:
        for b in blocks:
            if b[0] == 'h1' and b[2]:
                ch += 1; label = str(ch); cf = ct = ce = 0
            elif b[0] == 'h1':
                m = re.match(r'^Appendix ([A-Z])', b[1])
                if m:
                    label = m.group(1); cf = ct = ce = 0
            elif b[0] == 'figure':
                cf += 1; REG.fig[b[1]] = f'{label}.{cf}'
            elif b[0] == 'table':
                ct += 1; REG.tab[b[1]] = f'{label}.{ct}'
            elif b[0] == 'eq':
                ce += 1; REG.eq[b[1]] = f'{label}.{ce}'


# ----------------------------------------------------------------------------
# Rendering
# ----------------------------------------------------------------------------
def render_table(doc, key, caption, rows, source):
    cap = para(doc, '', align=WD_ALIGN_PARAGRAPH.CENTER, size=11, spacing=1.0, after=4, before=8, keep_next=True)
    cap.style = doc.styles['Table Caption']
    add_inline(cap, f'Table {REG.tab[key]}: {caption}', size=11, bold=True)
    ncols = max(len(r) for r in rows)
    t = doc.add_table(rows=len(rows), cols=ncols)
    t.style = 'Table Grid'
    t.alignment = WD_TABLE_ALIGNMENT.CENTER
    for ri, row in enumerate(rows):
        for ci in range(ncols):
            cell = t.cell(ri, ci)
            cell.text = ''
            p = cell.paragraphs[0]
            p.paragraph_format.line_spacing = 1.0
            p.paragraph_format.space_after = Pt(2)
            p.paragraph_format.space_before = Pt(2)
            add_inline(p, row[ci] if ci < len(row) else '', size=10, bold=(ri == 0))
            if ri == 0:
                tcpr = cell._tc.get_or_add_tcPr()
                shd = OxmlElement('w:shd')
                shd.set(qn('w:val'), 'clear'); shd.set(qn('w:color'), 'auto'); shd.set(qn('w:fill'), 'E7E6F3')
                tcpr.append(shd)
        if ri == 0:
            trpr = t.rows[0]._tr.get_or_add_trPr()
            h = OxmlElement('w:tblHeader'); h.set(qn('w:val'), 'true'); trpr.append(h)
    if source:
        para(doc, f'Source: {source}', align=WD_ALIGN_PARAGRAPH.CENTER, size=10, italic=True, spacing=1.0, after=6, before=2)
    else:
        para(doc, '', spacing=1.0, after=4)


def render_figure(doc, key, fname, caption, note, source):
    p = para(doc, '', align=WD_ALIGN_PARAGRAPH.CENTER, spacing=1.0, after=2, before=6, keep_next=True)
    path = os.path.join(FIG_DIR, fname)
    if fname.upper() != 'PLACEHOLDER' and os.path.exists(path):
        p.add_run().add_picture(path, width=Cm(13.0))
    else:
        t = doc.add_table(rows=1, cols=1)
        t.style = 'Table Grid'
        t.alignment = WD_TABLE_ALIGNMENT.CENTER
        c = t.cell(0, 0)
        c.text = ''
        cp = c.paragraphs[0]
        cp.alignment = WD_ALIGN_PARAGRAPH.CENTER
        cp.paragraph_format.space_before = Pt(30)
        cp.paragraph_format.space_after = Pt(30)
        r = cp.add_run('[INSERT FIGURE: ' + (note or caption) + ']')
        set_run_font(r, 11, True)
        r.font.highlight_color = WD_COLOR_INDEX.YELLOW
    cap = para(doc, '', align=WD_ALIGN_PARAGRAPH.CENTER, size=11, spacing=1.0, after=2, before=4)
    cap.style = doc.styles['Figure Caption']
    add_inline(cap, f'Figure {REG.fig[key]}: {caption}', size=11, bold=True)
    if source:
        para(doc, f'Source: {source}', align=WD_ALIGN_PARAGRAPH.CENTER, size=10, italic=True, spacing=1.0, after=8)
    else:
        para(doc, '', spacing=1.0, after=4)


def render_blocks(doc, blocks, state):
    for b in blocks:
        kind = b[0]
        if kind == 'h1':
            text = b[1]
            if b[2]:
                state['ch'] += 1; state['sec'] = 0; state['sub'] = 0
                label = f"{state['ch']} {text.upper()}"
            else:
                label = text.upper()
            doc.add_heading(label, level=1)
        elif kind == 'h2':
            state['sec'] += 1; state['sub'] = 0
            doc.add_heading(f"{state['ch']}.{state['sec']} {b[1]}", level=2)
        elif kind == 'h2u':
            doc.add_heading(b[1], level=2)
        elif kind == 'h3u':
            doc.add_heading(b[1], level=3)
        elif kind == 'h3':
            state['sub'] += 1
            doc.add_heading(f"{state['ch']}.{state['sec']}.{state['sub']} {b[1]}", level=3)
        elif kind == 'p':
            p = para(doc, b[1], align=WD_ALIGN_PARAGRAPH.JUSTIFY)
        elif kind in ('bullets', 'numbers'):
            for n, item in enumerate(b[1], 1):
                p = doc.add_paragraph()
                pf = p.paragraph_format
                pf.left_indent = Mm(10); pf.first_line_indent = Mm(-6)
                pf.line_spacing = 1.5; pf.space_after = Pt(3)
                p.alignment = WD_ALIGN_PARAGRAPH.JUSTIFY
                mark = '•  ' if kind == 'bullets' else f'{n}.  '
                r = p.add_run(mark); set_run_font(r, 12)
                add_inline(p, item)
        elif kind == 'table':
            render_table(doc, b[1], b[2], b[3], b[4])
        elif kind == 'figure':
            render_figure(doc, b[1], b[2], b[3], b[4], b[5])
        elif kind == 'eq':
            p = para(doc, '', align=WD_ALIGN_PARAGRAPH.CENTER, spacing=1.5, after=6)
            add_inline(p, b[2] + '        (' + REG.eq[b[1]] + ')', italic=True)


# ----------------------------------------------------------------------------
# Document assembly
# ----------------------------------------------------------------------------
def build():
    doc = Document()

    # ---- styles ----
    style_font(doc.styles['Normal'], 12)
    doc.styles['Normal'].paragraph_format.line_spacing = 1.5
    for name, size, caps in (('Heading 1', 14, True), ('Heading 2', 12, False), ('Heading 3', 12, False)):
        st = doc.styles[name]
        style_font(st, size, bold=True)
        st.paragraph_format.keep_with_next = True
        st.paragraph_format.line_spacing = 1.5
        st.paragraph_format.space_before = Pt(18 if name == 'Heading 1' else 12)
        st.paragraph_format.space_after = Pt(12 if name == 'Heading 1' else 6)
        if name == 'Heading 1':
            st.paragraph_format.page_break_before = True
    for name in ('Figure Caption', 'Table Caption'):
        st = doc.styles.add_style(name, 1)
        st.base_style = doc.styles['Normal']
        style_font(st, 11, bold=True)

    # ---- settings: ask Word to refresh fields (TOC, lists, page numbers) on open ----
    uf = OxmlElement('w:updateFields')
    uf.set(qn('w:val'), 'true')
    doc.settings.element.append(uf)

    # ---- section 1: title page (no page number) ----
    s1 = doc.sections[0]
    set_margins(s1)
    para(doc, '', spacing=1.5, after=0)
    for _ in range(3):
        para(doc, '', spacing=1.5, after=0)
    add = lambda text, size, bold=False, after=6: para(doc, text, align=WD_ALIGN_PARAGRAPH.CENTER, size=size, bold=bold, after=after)
    add(META['title'], 16, True, 18)
    add('INDIVIDUAL THESIS', 14, True, 18)
    add(META['name'], 14, False, 4)
    add(f"({META['student_id']})", 14, False, 18)
    add('Individual component: ' + META['component'], 12, False, 4)
    add('Group ID: ' + META['group_id'], 12, False, 24)
    add('Report submitted in partial fulfilment of the requirements for the', 12, False, 4)
    add(META['degree'], 12, False, 4)
    add('Specialising in ' + META['spec'], 12, False, 24)
    add(META['department'], 14, False, 4)
    add('Sri Lanka Institute of Information Technology', 14, False, 4)
    add('Sri Lanka', 14, False, 24)
    add(META['month_year'], 14, False, 6)
    # highlight placeholders on the title page
    for p in doc.paragraphs:
        for r in p.runs:
            if '[' in r.text:
                r.font.highlight_color = WD_COLOR_INDEX.YELLOW

    # ---- section 2: preliminary pages (roman numerals, centred) ----
    s2 = doc.add_section(WD_SECTION.NEW_PAGE)
    set_margins(s2)
    set_pg_num(s2, 'lowerRoman', 1)
    footer_page_number(s2, WD_ALIGN_PARAGRAPH.CENTER)
    s1.footer.is_linked_to_previous = False

    def prelim_heading(text):
        p = para(doc, text, align=WD_ALIGN_PARAGRAPH.CENTER, size=14, bold=True, after=12)
        p.paragraph_format.page_break_before = True if doc.paragraphs and len(doc.paragraphs) > 14 and text != 'DECLARATION AND SUPERVISOR CERTIFICATION' else False
        return p

    # Declaration
    para(doc, 'DECLARATION AND SUPERVISOR CERTIFICATION', align=WD_ALIGN_PARAGRAPH.CENTER, size=14, bold=True, after=12)
    para(doc, '**Candidate declaration.** I declare that this thesis is my own work and does not incorporate, without acknowledgement, '
              'material previously submitted for a degree or diploma at any university or institute of higher learning. To the best of my '
              'knowledge, it contains no material previously published or written by another person except where acknowledgement is made '
              'in the text. I grant the Sri Lanka Institute of Information Technology the non-exclusive right to reproduce and distribute '
              'this thesis, in whole or in part, in print, electronic, or other media, while retaining the right to use the content in future work.',
         align=WD_ALIGN_PARAGRAPH.JUSTIFY)
    para(doc, '**Academic integrity and AI disclosure.** I have disclosed all use of generative AI and other automated tools in accordance '
              'with the module policy (Appendix B). I remain responsible for the accuracy, originality, citations, code, data, analyses, and '
              'conclusions in this thesis.', align=WD_ALIGN_PARAGRAPH.JUSTIFY)
    para(doc, f"Student name: {META['name']}", after=0)
    para(doc, 'Student ID: ' + ('[[STUDENT ID]]' if META['student_id'].startswith('[') else META['student_id']), after=0)
    para(doc, 'Signature: ______________________________     Date: ____________', after=18)
    para(doc, '**Supervisor certification.** The above candidate carried out this research for the bachelor\'s degree thesis under my supervision.',
         align=WD_ALIGN_PARAGRAPH.JUSTIFY)
    t = doc.add_table(rows=3, cols=3)
    t.style = 'Table Grid'
    for ci, h in enumerate(['Role and name', 'Signature', 'Date']):
        t.cell(0, ci).text = ''
        r = t.cell(0, ci).paragraphs[0].add_run(h); set_run_font(r, 11, True)
    for ri, label in ((1, 'Supervisor: ' + META['supervisor']), (2, 'Co-supervisor: ' + META['cosupervisor'])):
        t.cell(ri, 0).text = ''
        r = t.cell(ri, 0).paragraphs[0].add_run(label); set_run_font(r, 11)
        r.font.highlight_color = WD_COLOR_INDEX.YELLOW
        for ci in range(3):
            t.cell(ri, ci).paragraphs[0].paragraph_format.space_before = Pt(10)
            t.cell(ri, ci).paragraphs[0].paragraph_format.space_after = Pt(10)

    # Abstract / Acknowledgements from files
    def simple_page(title, fname, size, spacing):
        h = para(doc, title, align=WD_ALIGN_PARAGRAPH.CENTER, size=12 if title == 'Abstract' else 14, bold=True, after=12)
        h.paragraph_format.page_break_before = True
        h.paragraph_format.keep_with_next = True
        for blk in parse_chapter(os.path.join(CH_DIR, fname)):
            if blk[0] == 'p':
                para(doc, blk[1], align=WD_ALIGN_PARAGRAPH.JUSTIFY, size=size, spacing=spacing)

    number_blocks_pre = []  # abstract/ack have no numbered items
    simple_page('Abstract', '00_abstract.md', 11, 1.0)
    simple_page('ACKNOWLEDGEMENTS', '00_acknowledgements.md', 12, 1.5)

    # Table of contents
    h = para(doc, 'TABLE OF CONTENTS', align=WD_ALIGN_PARAGRAPH.CENTER, size=14, bold=True, after=12)
    h.paragraph_format.page_break_before = True
    p = para(doc, '', spacing=1.5)
    add_field(p, 'TOC \\o "1-2" \\h \\z \\u', 'Right-click here and choose "Update Field" (or press Ctrl+A then F9) to build the table of contents.')

    h = para(doc, 'LIST OF FIGURES', align=WD_ALIGN_PARAGRAPH.CENTER, size=14, bold=True, after=12)
    h.paragraph_format.page_break_before = True
    p = para(doc, '', spacing=1.5)
    add_field(p, 'TOC \\h \\z \\t "Figure Caption,1"', 'Right-click and choose "Update Field" to build the list of figures.')

    h = para(doc, 'LIST OF TABLES', align=WD_ALIGN_PARAGRAPH.CENTER, size=14, bold=True, after=12)
    h.paragraph_format.page_break_before = True
    p = para(doc, '', spacing=1.5)
    add_field(p, 'TOC \\h \\z \\t "Table Caption,1"', 'Right-click and choose "Update Field" to build the list of tables.')

    # Abbreviations
    h = para(doc, 'LIST OF ABBREVIATIONS', align=WD_ALIGN_PARAGRAPH.CENTER, size=14, bold=True, after=12)
    h.paragraph_format.page_break_before = True
    abbr = [ln.split('|') for ln in open(os.path.join(CH_DIR, '00_abbreviations.md'), encoding='utf-8').read().strip().split('\n') if '|' in ln]
    t = doc.add_table(rows=len(abbr) + 1, cols=2)
    t.style = 'Table Grid'
    for ci, htxt in enumerate(['Abbreviation', 'Description']):
        t.cell(0, ci).text = ''
        r = t.cell(0, ci).paragraphs[0].add_run(htxt); set_run_font(r, 11, True)
    for ri, (a, d) in enumerate(abbr, 1):
        for ci, txt in enumerate((a.strip(), d.strip())):
            t.cell(ri, ci).text = ''
            r = t.cell(ri, ci).paragraphs[0].add_run(txt); set_run_font(r, 11)
            t.cell(ri, ci).paragraphs[0].paragraph_format.line_spacing = 1.0

    # List of appendices
    h = para(doc, 'LIST OF APPENDICES', align=WD_ALIGN_PARAGRAPH.CENTER, size=14, bold=True, after=12)
    h.paragraph_format.page_break_before = True
    para(doc, 'Appendix A    Research instruments and extended results', spacing=1.5)
    para(doc, 'Appendix B    Academic integrity and AI use disclosure', spacing=1.5)

    # ---- section 3: body (arabic, bottom right) ----
    s3 = doc.add_section(WD_SECTION.NEW_PAGE)
    set_margins(s3)
    set_pg_num(s3, 'decimal', 1)
    footer_page_number(s3, WD_ALIGN_PARAGRAPH.RIGHT)

    files = sorted(f for f in os.listdir(CH_DIR) if re.match(r'^(0[1-9]|1\d)_.*\.md$', f) and not f.startswith('00_'))
    parsed = [parse_chapter(os.path.join(CH_DIR, f)) for f in files]
    number_blocks(parsed)
    state = {'ch': 0, 'sec': 0, 'sub': 0}
    for blocks in parsed:
        render_blocks(doc, blocks, state)

    # ---- references (unnumbered chapter) ----
    doc.add_heading('REFERENCES', level=1)
    for n, key in enumerate(REG.cite_order, 1):
        entry = REFS[key]
        p = doc.add_paragraph()
        pf = p.paragraph_format
        pf.line_spacing = 1.0; pf.space_after = Pt(12)
        pf.left_indent = Mm(10); pf.first_line_indent = Mm(-10)
        p.alignment = WD_ALIGN_PARAGRAPH.JUSTIFY
        r = p.add_run(f'[{n}]  '); set_run_font(r, 12)
        add_inline(p, entry)

    # ---- glossary, appendices ----
    for fname in ('98_glossary.md', '99_appendices.md'):
        blocks = parse_chapter(os.path.join(CH_DIR, fname))
        number_blocks([blocks])
        render_blocks(doc, blocks, state)

    doc.save(OUT)
    unused = [k for k in REFS if k not in REG.cite_order]
    print('saved', OUT)
    print('references cited:', len(REG.cite_order), '| defined but never cited:', unused)
    return doc


if __name__ == '__main__':
    build()
