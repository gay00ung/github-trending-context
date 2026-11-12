"""Copy the extension into a loadable directory and optionally create a ZIP."""

import argparse
import json
import shutil
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile

ROOT = Path(__file__).resolve().parent.parent
SNAPSHOT_NAMES = {"daily": "latest.json", "weekly": "weekly.json", "monthly": "monthly.json"}


def package(output, snapshot=None, demo=False, archive=None, *, snapshot_dir=None):
    if output.exists() and (not output.is_dir() or any(output.iterdir())):
        raise ValueError(f"Use an empty output directory: {output}")
    snapshots = {"daily": snapshot} if snapshot is not None else {}
    if snapshot_dir is not None:
        snapshots = {period: snapshot_dir / name for period, name in SNAPSHOT_NAMES.items()}
    for period, path in snapshots.items():
        data = json.loads(path.read_text(encoding="utf-8"))
        if not isinstance(data, dict) or data.get("period", "daily") != period:
            raise ValueError(f"Expected a {period} snapshot: {path}")
    if archive is not None and archive.exists():
        raise ValueError(f"Archive already exists: {archive}")

    ignore = None if demo else shutil.ignore_patterns("fixtures")
    shutil.copytree(ROOT / "extension", output, dirs_exist_ok=True, ignore=ignore)
    shutil.copyfile(ROOT / "LICENSE", output / "LICENSE")
    if demo or snapshots:
        manifest_path = output / "manifest.json"
        manifest = json.loads(manifest_path.read_text())
        manifest.pop("host_permissions", None)
        if demo:
            manifest.pop("permissions", None)
        manifest_path.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
        mode = "demo" if demo else "local"
        config = json.dumps({"mode": mode})
        (output / "config.js").write_text(f"globalThis.TrendingContextConfig = {config};\n", encoding="utf-8")
        for period, path in snapshots.items():
            shutil.copyfile(path, output / SNAPSHOT_NAMES[period])

    if archive:
        archive.parent.mkdir(parents=True, exist_ok=True)
        with ZipFile(archive, "x", compression=ZIP_DEFLATED) as zip_file:
            for file in sorted(output.rglob("*")):
                if file.is_file():
                    zip_file.write(file, file.relative_to(output))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    modes = parser.add_mutually_exclusive_group()
    modes.add_argument("--snapshot", type=Path, help="Bundle only a daily snapshot")
    modes.add_argument("--snapshot-dir", type=Path, help="Bundle daily, weekly and monthly snapshots")
    modes.add_argument("--demo", action="store_true", help="Bundle example data")
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--zip", type=Path)
    args = parser.parse_args()
    try:
        package(args.output, args.snapshot, args.demo, args.zip, snapshot_dir=args.snapshot_dir)
    except (OSError, ValueError) as error:
        parser.exit(1, f"{error}\n")
    print(f"Load unpacked from {args.output}")


if __name__ == "__main__":
    main()
