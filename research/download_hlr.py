import concurrent.futures
import gzip
import subprocess
from pathlib import Path

URL = "https://dataverse.harvard.edu/api/access/datafile/3091087"
TOTAL = 379004009
PARTS = 6
ROOT = Path(r"D:\Kimi\siji-research")
TARGET = ROOT / "settles.acl16.learning_traces.13m.csv.gz"


def signed_url():
    out = subprocess.check_output(["curl", "-A", "Mozilla/5.0", "-sI", "--max-time", "45", URL], text=True)
    for line in out.splitlines():
        if line.lower().startswith("location:"):
            return line.split(": ", 1)[1].strip()
    raise RuntimeError("未获得数据下载地址")


def download_part(loc, index):
    start = index * TOTAL // PARTS
    end = (index + 1) * TOTAL // PARTS - 1
    expected = end - start + 1
    path = ROOT / f"hlr-part-{index}"
    existing = path.stat().st_size if path.exists() else 0
    if existing > expected:
        raise RuntimeError(f"分段 {index} 超出预期大小")
    if existing < expected:
        temp = ROOT / f"hlr-part-{index}.rest"
        subprocess.run([
            "curl", "-sS", "-L", "--fail", "--retry", "3", "--max-time", "900",
            "-A", "Mozilla/5.0", "-r", f"{start + existing}-{end}", "-o", str(temp), loc,
        ], check=True)
        with path.open("ab") as out, temp.open("rb") as src:
            while True:
                chunk = src.read(8 * 1024 * 1024)
                if not chunk:
                    break
                out.write(chunk)
        temp.unlink()
    actual = path.stat().st_size
    if actual != expected:
        raise RuntimeError(f"分段 {index} 大小不符：{actual} != {expected}")
    print(f"分段 {index + 1}/{PARTS} 完成", flush=True)
    return path


def main():
    loc = signed_url()
    with concurrent.futures.ThreadPoolExecutor(max_workers=PARTS) as pool:
        parts = list(pool.map(lambda i: download_part(loc, i), range(PARTS)))
    with TARGET.open("wb") as out:
        for part in parts:
            with part.open("rb") as src:
                while True:
                    chunk = src.read(8 * 1024 * 1024)
                    if not chunk:
                        break
                    out.write(chunk)
    for part in parts:
        part.unlink()
    if TARGET.stat().st_size != TOTAL:
        raise RuntimeError("合并后的文件大小不符")
    with gzip.open(TARGET, "rt", encoding="utf-8") as f:
        print(f.readline().strip())
        print(f.readline().strip()[:500])
    print(f"下载完成：{TARGET}（{TOTAL} bytes）", flush=True)


if __name__ == "__main__":
    main()
