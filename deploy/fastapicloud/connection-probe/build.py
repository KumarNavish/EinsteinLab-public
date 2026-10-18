"""Stage only the keyless probe and the exact production carrier implementation."""
import argparse
from pathlib import Path
import shutil


def build(target):
    source = Path(__file__).resolve().parent
    root = source.parents[2]
    target.mkdir(parents=True, exist_ok=False)
    for name in ('main.py', 'pyproject.toml', '.python-version', '.fastapicloudignore'):
        shutil.copyfile(source / name, target / name)
    shutil.copyfile(root / 'lab_backend/public_transport.py', target / 'public_transport.py')


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('target', type=Path)
    build(parser.parse_args().target)
