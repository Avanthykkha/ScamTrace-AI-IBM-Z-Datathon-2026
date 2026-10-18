"""Create a local, compact analysis cache from Elliptic's public benchmark ZIP.

The source archive is deliberately not copied into the repository. The cache is
stored under data/ (ignored by git), and the public dataset license remains
applicable. Usage: python scripts/prepare_elliptic_benchmark.py data/elliptic-data-set.zip
"""
from __future__ import annotations

import csv
import gzip
import json
import sys
import zipfile
from collections import Counter, defaultdict
from pathlib import Path


def rows(archive: zipfile.ZipFile, suffix: str):
    name = next((entry for entry in archive.namelist() if entry.endswith(suffix)), None)
    if not name:
        raise ValueError(f"ZIP is missing {suffix}")
    with archive.open(name) as raw:
        import io
        yield from csv.DictReader(io.TextIOWrapper(raw, encoding="utf-8-sig", newline=""))


def feature_rows(archive: zipfile.ZipFile):
    name = next((entry for entry in archive.namelist() if entry.endswith("elliptic_txs_features.csv")), None)
    if not name:
        raise ValueError("ZIP is missing elliptic_txs_features.csv")
    with archive.open(name) as raw:
        import io
        yield from csv.reader(io.TextIOWrapper(raw, encoding="utf-8-sig", newline=""))


def main() -> None:
    if len(sys.argv) != 2:
        raise SystemExit("usage: python scripts/prepare_elliptic_benchmark.py <Elliptic ZIP>")
    source = Path(sys.argv[1])
    root = Path(__file__).resolve().parents[1]
    target = root / "data" / "elliptic" / "benchmark.json.gz"
    target.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(source) as archive:
        classes = {row["txId"]: row["class"] for row in rows(archive, "elliptic_txs_classes.csv")}
        nodes: list[list[object]] = []
        step_counts: dict[str, Counter] = defaultdict(Counter)
        for row in feature_rows(archive):
            tx_id, step = row[0], int(row[1])
            label = classes.get(tx_id, "unknown")
            nodes.append([tx_id, step, label])
            step_counts[str(step)][label] += 1
        ids = {node[0] for node in nodes}
        edges: list[list[str]] = []
        for row in rows(archive, "elliptic_txs_edgelist.csv"):
            source_id, target_id = row["txId1"], row["txId2"]
            if source_id in ids and target_id in ids:
                edges.append([source_id, target_id])
        data = {"dataset": "Elliptic Bitcoin transaction dataset", "nodes": nodes, "edges": edges,
                "steps": [{"step": int(step), **dict(counts)} for step, counts in sorted(step_counts.items(), key=lambda item: int(item[0]))],
                "labels": dict(Counter(node[2] for node in nodes))}
    with target.open("wb") as output:
        with gzip.GzipFile(fileobj=output, mode="wb", compresslevel=9, mtime=0) as compressed:
            compressed.write(json.dumps(data, separators=(",", ":")).encode("utf-8"))
    (target.parent / "summary.json").write_text(json.dumps({"dataset": data["dataset"], "nodes": len(nodes), "edges": len(edges), "steps": data["steps"], "labels": data["labels"]}), encoding="utf-8")
    print(f"Wrote local benchmark cache: {target} ({len(nodes):,} nodes, {len(edges):,} edges, {target.stat().st_size:,} bytes compressed)")


if __name__ == "__main__":
    main()
