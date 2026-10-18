"""Scan project source for common embedded credential formats without printing matches."""
from __future__ import annotations

import re
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SKIP = {".git", ".venv", "node_modules", ".run", "logs", "data", "dist", "__pycache__", ".pytest_cache"}
PATTERNS = [
    re.compile(r"-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----"),
    re.compile(r"\bAKIA[0-9A-Z]{16}\b"),
    re.compile(r"\bsk-(?:proj-)?[A-Za-z0-9_-]{24,}\b"),
    re.compile(r"\bgh[pousr]_[A-Za-z0-9]{30,}\b"),
]

findings: list[tuple[str, int]] = []
for path in ROOT.rglob("*"):
    if not path.is_file() or any(part in SKIP for part in path.relative_to(ROOT).parts):
        continue
    if path.name in {".env", ".env.local", ".env.production"}:
        continue
    try:
        lines = path.read_text(encoding="utf-8", errors="ignore").splitlines()
    except OSError:
        continue
    for line_number, line in enumerate(lines, 1):
        if any(pattern.search(line) for pattern in PATTERNS):
            findings.append((str(path.relative_to(ROOT)), line_number))

if findings:
    for filename, line_number in findings:
        print(f"POSSIBLE EMBEDDED CREDENTIAL: {filename}:{line_number}")
    raise SystemExit(1)

git_available = False
try:
    result = subprocess.run(["git", "rev-parse", "--is-inside-work-tree"], cwd=ROOT, capture_output=True, text=True, check=False)
    git_available = result.returncode == 0 and result.stdout.strip() == "true"
except FileNotFoundError:
    pass

if git_available:
    tracked = subprocess.run(["git", "ls-files", "--error-unmatch", ".env"], cwd=ROOT, capture_output=True, text=True, check=False)
    if tracked.returncode == 0:
        print("ERROR: .env is tracked by Git. Remove it from version control before committing.")
        raise SystemExit(1)
    print("No common embedded credential formats found in source; .env is not tracked.")
else:
    print("No common embedded credential formats found in source. Git metadata is unavailable, so committed-file status could not be verified.")
