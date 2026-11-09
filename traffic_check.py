# -*- coding: utf-8 -*-
import json
import sys
import urllib.request
import urllib.error

TOKEN = sys.argv[1]
USER = sys.argv[2]
REPO = sys.argv[3]

def call(path):
    req = urllib.request.Request("https://api.github.com" + path)
    req.add_header("Authorization", "Bearer " + TOKEN)
    req.add_header("Accept", "application/vnd.github+json")
    try:
        with urllib.request.urlopen(req, timeout=25) as r:
            return r.status, json.loads(r.read().decode() or "{}")
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()

for p in ["/repos/%s/%s/traffic/views" % (USER, REPO),
          "/repos/%s/%s/traffic/clones" % (USER, REPO)]:
    st, data = call(p)
    print(p, "->", st)
    if st == 200:
        print("   count:", data.get("count"), "uniques:", data.get("uniques"))
    else:
        print("   ", data)
