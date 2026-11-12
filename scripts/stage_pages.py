"""Add the web demo and shared assets to the GitHub Pages snapshot directory."""

import argparse
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ASSETS = {
    "context.js": "extension/context.js",
    "snapshot.js": "extension/snapshot.js",
    "icon.png": "extension/icons/icon-48.png",
    "preview.png": "docs/media/expanded.png",
}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    shutil.copytree(ROOT / "web", args.output, dirs_exist_ok=True)
    assets = args.output / "assets"
    assets.mkdir(exist_ok=True)
    for filename, source in ASSETS.items():
        shutil.copyfile(ROOT / source, assets / filename)


if __name__ == "__main__":
    main()
