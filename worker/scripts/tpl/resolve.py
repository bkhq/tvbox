#!/usr/bin/env python3
"""Resolve git conflict hunks in a file: resolve.py FILE ours|theirs|both [ours|theirs|both ...] (one choice per hunk, the last repeats)."""
import re
import sys

path, choices = sys.argv[1], sys.argv[2:]
text = open(path).read()
pattern = re.compile(r"^<<<<<<< [^\n]*\n(.*?)^=======\n(.*?)^>>>>>>> [^\n]*\n", re.S | re.M)
i = 0


def pick(m):
    global i
    choice = choices[min(i, len(choices) - 1)]
    i += 1
    return {"ours": m.group(1), "theirs": m.group(2), "both": m.group(1) + m.group(2)}[choice]


out = pattern.sub(pick, text)
open(path, "w").write(out)
print(f"{path}: {i} hunk(s)")
