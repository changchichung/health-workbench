#!/usr/bin/env python3
"""逐筆逐欄比對健康存摺 JSON 與 XML 下載檔是否等價。"""
import json
import sys
import xml.etree.ElementTree as ET
from collections import defaultdict

json_path, xml_path = sys.argv[1], sys.argv[2]
jb = {k.lower(): v for k, v in json.load(
    open(json_path, encoding="utf-8-sig"))["myhealthbank"]["bdata"].items()}
xb = ET.parse(xml_path).getroot().find("bdata")


def xml_rec(el):
    d, subs = {}, defaultdict(list)
    for c in el:
        if len(c):
            subs[c.tag].append(xml_rec(c))
        else:
            d[c.tag] = c.text
    d.update(subs)
    return d


xsec = defaultdict(list)
for c in xb:
    if len(c):
        xsec[c.tag.lower()].append(xml_rec(c))
    else:
        xsec[c.tag.lower()] = c.text


def norm(v):
    return "" if v is None else str(v).strip()


def cmp_rec(jr, xr, path, state):
    for k in set(jr) | set(xr):
        a, b = jr.get(k), xr.get(k)
        if isinstance(a, list) or isinstance(b, list):
            a, b = a or [], b or []
            if len(a) != len(b):
                state["mism"] += 1
                state["samples"].append((path, k, f"len {len(a)}vs{len(b)}"))
                continue
            for j, (ar, br) in enumerate(zip(a, b)):
                cmp_rec(ar, br, f"{path}.{k}[{j}]", state)
        elif norm(a) != norm(b):
            state["mism"] += 1
            if len(state["samples"]) < 3:
                state["samples"].append((path, k, f"{a!r} vs {b!r}"))


total = 0
for sec in sorted(set(jb) | set(xsec)):
    jv, xv = jb.get(sec), xsec.get(sec)
    if isinstance(jv, str) or isinstance(xv, str):
        jtext = jv if isinstance(jv, str) else (jv[0].get(sec, "") if jv else "")
        xtext = xv if isinstance(xv, str) else (xv[0].get(sec, "") if xv else "")
        same = norm(jtext) == norm(xtext)
        total += 0 if same else 1
        print(f"{sec}: scalar {'same' if same else 'DIFF'}")
        continue
    state = {"mism": 0, "samples": []}
    for i, (jr, xr) in enumerate(zip(jv, xv or [])):
        if list(jr.keys()) == [sec]:
            if norm(jr[sec]) != norm(xr.get(sec)):
                state["mism"] += 1
            continue
        cmp_rec(jr, xr, f"[{i}]", state)
    jn, xn = len(jv), len(xv or [])
    total += state["mism"] + abs(jn - xn)
    ok = "OK" if jn == xn and state["mism"] == 0 else f"MISMATCH {state['samples'][:3]}"
    print(f"{sec}: json={jn} xml={xn} 欄位差異={state['mism']} {ok}")

print("\n總差異:", total)
