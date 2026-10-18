"""Rebuild the Linux slide runtime from reviewed official Debian payload pins.

No apt installation, maintainer script, root permission or runtime download.
The manifest records the signature verification performed when pins changed;
this rebuild checks pinned payload hashes and the complete relocated tree.
"""
from __future__ import annotations

import argparse
from concurrent.futures import ThreadPoolExecutor
import copy
import hashlib
import io
import json
import os
from pathlib import Path
import posixpath
import shutil
import stat
import sys
import tarfile
import tempfile
from urllib.parse import urlsplit
from urllib.request import urlopen

MAX_PACKAGE = 50 * 1024 * 1024
MAX_PAYLOAD = 200 * 1024 * 1024
MAX_EXPANDED = 650 * 1024 * 1024
REPOSITORIES = {"deb.debian.org": "/debian/pool/", "security.debian.org": "/debian-security/pool/"}
ENTRYPOINTS = ("lib/x86_64-linux-gnu/ld-linux-x86-64.so.2", "usr/bin/lloconv", "usr/bin/pdfinfo")


def require(condition, message):
    if not condition:
        raise ValueError(message)


def package_url(package):
    url = package["url"]
    parsed = urlsplit(url)
    require(parsed.scheme == "https" and parsed.hostname in REPOSITORIES and parsed.port is None
            and parsed.username is None and parsed.password is None and not parsed.query and not parsed.fragment
            and parsed.path.startswith(REPOSITORIES[parsed.hostname])
            and all(part not in {".", ".."} for part in parsed.path.split("/")), "Package origin is outside the fixed official allowlist")
    require(0 < package["size"] <= MAX_PACKAGE and len(package["sha256"]) == 64
            and all(c in "0123456789abcdef" for c in package["sha256"]), "Invalid package pin")
    return url


def download(package, cache):
    url = package_url(package)
    path = cache / (package["sha256"] + ".deb")
    if not path.exists():
        with urlopen(url, timeout=60) as response:
            content = response.read(package["size"] + 1)
        require(len(content) == package["size"] and hashlib.sha256(content).hexdigest() == package["sha256"], "Downloaded package checksum mismatch")
        temporary = path.with_suffix(".partial")
        temporary.write_bytes(content)
        temporary.replace(path)
    content = path.read_bytes()
    require(len(content) == package["size"] and hashlib.sha256(content).hexdigest() == package["sha256"], "Cached package checksum mismatch")
    return path


def ar_members(data):
    require(data.startswith(b"!<arch>\n"), "Invalid package archive")
    offset = 8
    while offset < len(data):
        header = data[offset:offset + 60]
        require(len(header) == 60 and header[58:60] == b"`\n", "Invalid package member")
        size = int(header[48:58])
        require(0 <= size <= MAX_PACKAGE and offset + 60 + size <= len(data), "Invalid package member length")
        yield header[:16].decode().rstrip(" /"), data[offset + 60:offset + 60 + size]
        offset += 60 + size + size % 2


def canonical_package_path(name):
    # The reviewed tree was extracted on a case-insensitive filesystem. These
    # two pinned Perl directory pairs merge there; use that exact spelling on
    # Linux too, without changing file bytes, modes or the reviewed tree hash.
    relative = name.removeprefix("./")
    for parent, lower, canonical in (("usr/lib/x86_64-linux-gnu/perl/5.36.0", "sys", "Sys"),
                                     ("usr/share/perl/5.36.0", "pod", "Pod")):
        prefix = parent + "/" + lower
        if relative == prefix or relative.startswith(prefix + "/"):
            return parent + "/" + canonical + relative[len(prefix):]
    return name


def extract(path, output):
    payloads = 0
    for name, data in ar_members(path.read_bytes()):
        if not name.startswith("data.tar"):
            continue
        payloads += 1
        with tarfile.open(fileobj=io.BytesIO(data), mode="r:*") as archive:
            members = archive.getmembers()
            require(sum(m.size for m in members) < 200 * 1024 * 1024, "Expanded package exceeds limit")
            for original in members:
                member = copy.copy(original)
                member.name = canonical_package_path(member.name)
                require(member.isfile() or member.isdir() or member.issym() or member.islnk(), "Unsupported special package file")
                member.mode &= 0o777
                if member.issym():
                    logical = (posixpath.normpath(member.linkname.lstrip("/")) if member.linkname.startswith("/")
                               else posixpath.normpath(posixpath.join(posixpath.dirname(member.name), member.linkname)))
                    logical = canonical_package_path(logical)
                    require(logical != ".." and not logical.startswith("../"), "Package link escapes native tree")
                    member.linkname = posixpath.relpath(logical, posixpath.dirname(member.name))
                elif member.islnk():
                    member.linkname = canonical_package_path(member.linkname.lstrip("/"))
                archive.extract(member, path=output, filter="data")
    require(payloads == 1, "Package must have one data payload")


def relocate(output):
    (output / "fonts.conf").write_text('<?xml version="1.0"?><!DOCTYPE fontconfig SYSTEM "urn:fontconfig:fonts.dtd"><fontconfig><dir prefix="relative">usr/share/fonts</dir><cachedir prefix="xdg">fontconfig</cachedir></fontconfig>')
    # Debian postinst/ucf normally copies the shipped default schemas into
    # /etc. Use those exact payload schemas directly without running scripts.
    registry = output / "usr/lib/libreoffice/share/registry"
    require(registry.is_symlink() and os.readlink(registry) == "../../../../etc/libreoffice/registry", "Pinned registry link changed")
    require((registry.parent / ".registry/main.xcd").is_file(), "Missing default registry")
    registry.unlink()
    registry.symlink_to(".registry")
    path = output / "usr/lib/libreoffice/program/fundamentalrc"
    text = path.read_text()
    for before, after in [("BRAND_BASE_DIR=file:///usr/lib/libreoffice", "BRAND_BASE_DIR=${ORIGIN}/.."),
                          ("file:///etc/libreoffice/registry", "${BRAND_BASE_DIR}/share/registry"),
                          ("URE_MORE_JAVA_CLASSPATH_URLS= file:///usr/share/java/hsqldb1.8.0.jar", "URE_MORE_JAVA_CLASSPATH_URLS=")]:
        require(before in text, "Pinned LibreOffice config changed")
        text = text.replace(before, after)
    path.write_text(text)
    path = output / "usr/lib/libreoffice/program/sofficerc"
    before = "FHS_CONFIG_FILE=file:///etc/libreoffice/sofficerc"
    text = path.read_text()
    require(before in text, "Pinned LibreOffice path config changed")
    path.write_text(text.replace(before, "FHS_CONFIG_FILE=${ORIGIN}/../../../../etc/libreoffice/sofficerc"))
    # Unused orphan shipped by a dependency. It breaks archive tools that follow
    # links; do not invent a target or remove any converter/runtime file.
    orphan = output / "etc/rmt"
    require(orphan.is_symlink() and os.readlink(orphan) == "../usr/sbin/rmt" and not orphan.exists(), "Unexpected orphan package link")
    orphan.unlink()
    # The provider archive omits directory symlinks. Materialize only their
    # contained official-payload contents; empty directories need no markers.
    for path in list(output.rglob("*")):
        if path.is_symlink() and path.is_dir():
            target = path.resolve(strict=True)
            require(target.is_relative_to(output.resolve()), "Native directory alias leaves runtime")
            path.unlink()
            shutil.copytree(target, path, symlinks=True)


def tree_receipt(root):
    root = root.resolve()
    digest, files, bytes_ = hashlib.sha256(), 0, 0
    for path in sorted(root.rglob("*")):
        info = path.lstat()
        name = path.relative_to(root).as_posix()
        if stat.S_ISLNK(info.st_mode):
            require(path.resolve(strict=True).is_relative_to(root), "Native link leaves runtime")
            entry = [name, "link", os.readlink(path)]
        elif stat.S_ISREG(info.st_mode):
            require(not info.st_mode & (stat.S_ISUID | stat.S_ISGID), "Native runtime contains privileged mode")
            files += 1; bytes_ += info.st_size
            entry = [name, "file", stat.S_IMODE(info.st_mode), info.st_size, hashlib.sha256(path.read_bytes()).hexdigest()]
        elif stat.S_ISDIR(info.st_mode):
            # Provider packing omits empty directories. Digest files and links,
            # whose content and executable modes determine this runtime.
            continue
        else:
            raise ValueError("Native runtime contains a special file")
        digest.update(json.dumps(entry, separators=(",", ":")).encode() + b"\n")
    require(bytes_ <= MAX_EXPANDED and files <= 12000, "Expanded native tree exceeds budget")
    for name in ENTRYPOINTS:
        path = root / name
        require(path.is_file() and os.access(path, os.X_OK), "Native entrypoint is not executable")
        with path.open("rb") as source:
            header = source.read(20)
        require(header[:6] == b"\x7fELF\x02\x01" and header[18:20] == b"\x3e\x00", "Native entrypoint is not ELF64 x86_64")
    return {"sha256": digest.hexdigest(), "regular_files": files, "bytes": bytes_}


def build(manifest, output, cache):
    require(manifest["architecture"] == "linux-x86_64", "Unsupported runtime architecture")
    packages = manifest["packages"]
    require(1 <= len(packages) <= 250 and sum(p["size"] for p in packages) <= MAX_PAYLOAD, "Native package budget exceeded")
    require(not output.exists(), "Native output already exists; verify it or select a new directory")
    cache.mkdir(parents=True, exist_ok=True); output.parent.mkdir(parents=True, exist_ok=True)
    with ThreadPoolExecutor(max_workers=4) as pool:
        paths = list(pool.map(lambda package: download(package, cache), packages))
    with tempfile.TemporaryDirectory(prefix=".slides-build-", dir=output.parent) as temporary:
        stage = Path(temporary) / "native"; stage.mkdir()
        for path in paths:
            extract(path, stage)
        relocate(stage)
        actual = tree_receipt(stage)
        require(actual == manifest["native_tree"], "Rebuilt native tree differs from reviewed manifest")
        stage.rename(output)
    return actual


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    base = Path(__file__).resolve().parents[1]
    parser.add_argument("--manifest", type=Path, default=base / "deploy/slides-runtime.json")
    parser.add_argument("--native", type=Path, default=base / "deploy/native")
    parser.add_argument("--cache", type=Path, default=base / ".work/slides-packages")
    parser.add_argument("--verify-only", action="store_true")
    args = parser.parse_args()
    if sys.version_info < (3, 12):
        parser.error("Python3.12 or newer is required for safe stdlib tar extraction")
    manifest = json.loads(args.manifest.read_text())
    if args.verify_only:
        actual = tree_receipt(args.native)
        require(actual == manifest["native_tree"], "Native runtime differs from reviewed manifest")
    else:
        actual = build(manifest, args.native, args.cache)
    print(json.dumps({"status": "verified", "architecture": manifest["architecture"], "native_tree": actual}))


if __name__ == "__main__":
    main()
