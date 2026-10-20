#!/usr/bin/env python3
"""Publish a folder to Marsa (standard library only).

Usage: MARSA_URL=http://localhost:8080 python3 deploy.py <folder> [ttlHours]
"""
import io
import json
import os
import sys
import urllib.error
import urllib.request
import zipfile

if len(sys.argv) < 2:
    sys.exit("usage: deploy.py <folder> [ttlHours]")
folder = sys.argv[1]
ttl = sys.argv[2] if len(sys.argv) > 2 else "24"
base = os.environ.get("MARSA_URL", "http://localhost:8080")

buf = io.BytesIO()
with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
    for root, _, files in os.walk(folder):
        for name in files:
            full = os.path.join(root, name)
            z.write(full, os.path.relpath(full, folder))

req = urllib.request.Request(
    f"{base}/api/sites?ttlHours={ttl}",
    data=buf.getvalue(),
    headers={"Content-Type": "application/zip"},
    method="POST",
)
try:
    site = json.load(urllib.request.urlopen(req))
except urllib.error.HTTPError as e:
    sys.exit(e.read().decode())
print(json.dumps({k: site[k] for k in ("url", "expiresAt", "id", "editToken")}, indent=2))
