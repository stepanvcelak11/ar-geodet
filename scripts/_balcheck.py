import re, sys
for path in sys.argv[1:]:
    s = open(path, encoding='utf-8').read()
    s = re.sub(r'//[^\n]*', '', s)
    s = re.sub(r'/\*.*?\*/', '', s, flags=re.S)
    s = re.sub(r"'(\\.|[^'\\])*'", '', s)
    s = re.sub(r'"(\\.|[^"\\])*"', '', s)
    s = re.sub(r'`(\\.|[^`\\])*`', '', s)
    parts = []
    okall = True
    for o, c, nm in [('{', '}', '{}'), ('(', ')', '()'), ('[', ']', '[]')]:
        a, b = s.count(o), s.count(c)
        if a != b: okall = False
        parts.append(f'{nm} {a}/{b}')
    # leftover conflict markers
    cm = '<<<<<<<' in s or '>>>>>>>' in s
    print(f'{path}: {" ".join(parts)} {"OK" if okall and not cm else ("CONFLICT-MARKER" if cm else "MISMATCH")}')
