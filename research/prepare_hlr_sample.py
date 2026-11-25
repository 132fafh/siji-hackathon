import csv
import gzip
import hashlib
from collections import Counter
from pathlib import Path

ROOT = Path(r"D:\Kimi\siji-research")
SOURCE = ROOT / "settles.acl16.learning_traces.13m.csv.gz"
TARGET = ROOT / "baseline-sample.csv"
STRIDE = 50
FIELDS = [
    "p_recall", "timestamp", "delta", "user_id", "lexeme_id",
    "history_seen", "history_correct", "session_seen", "session_correct", "split",
]


def split_user(user_id):
    digest = hashlib.md5(user_id.encode("utf-8")).hexdigest()
    return "test" if int(digest[:8], 16) % 5 == 0 else "train"


def main():
    counts = Counter()
    with gzip.open(SOURCE, "rt", encoding="utf-8", newline="") as src, TARGET.open("w", encoding="utf-8", newline="") as out:
        reader = csv.DictReader(src)
        writer = csv.DictWriter(out, fieldnames=FIELDS)
        writer.writeheader()
        for index, row in enumerate(reader):
            if index % STRIDE:
                continue
            try:
                p = float(row["p_recall"])
                delta = float(row["delta"])
                seen = int(row["session_seen"])
                correct = int(row["session_correct"])
                if not (0 <= p <= 1 and delta >= 0 and seen > 0 and 0 <= correct <= seen):
                    counts["invalid"] += 1
                    continue
                writer.writerow({
                    "p_recall": p,
                    "timestamp": row["timestamp"],
                    "delta": row["delta"],
                    "user_id": row["user_id"],
                    "lexeme_id": row["lexeme_id"],
                    "history_seen": row["history_seen"],
                    "history_correct": row["history_correct"],
                    "session_seen": seen,
                    "session_correct": correct,
                    "split": split_user(row["user_id"]),
                })
                counts["written"] += 1
                counts[split_user(row["user_id"])] += 1
                counts["users_" + split_user(row["user_id"])] += 1
            except (ValueError, TypeError, KeyError):
                counts["invalid"] += 1
    print(dict(counts))
    print(f"输出：{TARGET}（{TARGET.stat().st_size} bytes）")


if __name__ == "__main__":
    main()
