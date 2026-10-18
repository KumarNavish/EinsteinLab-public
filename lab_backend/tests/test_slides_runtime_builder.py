import importlib.util
import io
from pathlib import Path
import stat
import tarfile
import tempfile
import unittest

SPEC = importlib.util.spec_from_file_location('builder', Path(__file__).resolve().parents[2] / 'tools/build_slides_runtime.py')
b = importlib.util.module_from_spec(SPEC); SPEC.loader.exec_module(b)


class BuilderChecks(unittest.TestCase):
    def test_official_https_only(self):
        pin = {'url': 'https://deb.debian.org/debian/pool/main/a/a/a.deb', 'size': 1, 'sha256': 'a' * 64}
        self.assertEqual(b.package_url(pin), pin['url'])
        for url in ['https://evil.example/debian/pool/a', 'http://deb.debian.org/debian/pool/a',
                    'https://u:p@deb.debian.org/debian/pool/a', 'https://deb.debian.org/debian/pool/../a',
                    'https://deb.debian.org/debian/pool/a?secret=1']:
            with self.subTest(url=url), self.assertRaises(ValueError):
                b.package_url({**pin, 'url': url})

    def test_corrupt_cache_is_rejected(self):
        with tempfile.TemporaryDirectory() as temporary:
            cache = Path(temporary); sha = 'a' * 64
            (cache / (sha + '.deb')).write_bytes(b'bad')
            with self.assertRaises(ValueError):
                b.download({'url': 'https://deb.debian.org/debian/pool/main/a/a/a.deb', 'size': 3, 'sha256': sha}, cache)

    def test_ar_bounds(self):
        with self.assertRaises(ValueError):
            list(b.ar_members(b'!<arch>\n' + b'bad'))

    def test_data_filter_rejects_traversal(self):
        with tempfile.TemporaryDirectory() as temporary:
            archive_data = io.BytesIO()
            with tarfile.open(fileobj=archive_data, mode='w') as archive:
                entry = tarfile.TarInfo('../escape'); entry.size = 1
                archive.addfile(entry, io.BytesIO(b'x'))
            payload = archive_data.getvalue()
            member_header = (f'{"data.tar/":<16}{0:<12}{0:<6}{0:<6}{"644":<8}{len(payload):<10}`\n').encode()
            package = Path(temporary) / 'test.deb'; package.write_bytes(b'!<arch>\n' + member_header + payload)
            output = Path(temporary) / 'out'; output.mkdir()
            with self.assertRaises(tarfile.FilterError):
                b.extract(package, output)
            self.assertFalse((Path(temporary) / 'escape').exists())

    def test_known_perl_directory_spelling_is_portable(self):
        with tempfile.TemporaryDirectory() as temporary:
            archive_data = io.BytesIO()
            with tarfile.open(fileobj=archive_data, mode='w') as archive:
                # Lowercase comes first so a case-insensitive test filesystem
                # also catches a missing normalization rather than masking it.
                for name in ['usr/lib/x86_64-linux-gnu/perl/5.36.0/sys/types.ph',
                             'usr/lib/x86_64-linux-gnu/perl/5.36.0/Sys/Hostname.pm',
                             'usr/share/perl/5.36.0/pod/perldiag.pod',
                             'usr/share/perl/5.36.0/Pod/Checker.pm']:
                    entry = tarfile.TarInfo('./' + name); entry.size = 1; entry.mode = 0o644
                    archive.addfile(entry, io.BytesIO(b'x'))
                link = tarfile.TarInfo('usr/share/perl-link'); link.type = tarfile.SYMTYPE
                link.linkname = 'perl/5.36.0/pod/perldiag.pod'; archive.addfile(link)
                link = tarfile.TarInfo('usr/share/perl-hardlink'); link.type = tarfile.LNKTYPE
                link.linkname = './usr/share/perl/5.36.0/pod/perldiag.pod'; archive.addfile(link)
            payload = archive_data.getvalue()
            member_header = (f'{"data.tar/":<16}{0:<12}{0:<6}{0:<6}{"644":<8}{len(payload):<10}`\n').encode()
            package = Path(temporary) / 'test.deb'; package.write_bytes(b'!<arch>\n' + member_header + payload)
            output = Path(temporary) / 'out'; output.mkdir()
            b.extract(package, output)
            for parent, spelling in [('usr/lib/x86_64-linux-gnu/perl/5.36.0', 'Sys'),
                                     ('usr/share/perl/5.36.0', 'Pod')]:
                self.assertEqual([path.name for path in (output / parent).iterdir()], [spelling])
            self.assertEqual((output / 'usr/lib/x86_64-linux-gnu/perl/5.36.0/Sys/types.ph').read_bytes(), b'x')
            self.assertEqual((output / 'usr/share/perl-link').read_bytes(), b'x')
            self.assertEqual((output / 'usr/share/perl-hardlink').read_bytes(), b'x')
            self.assertEqual(b.canonical_package_path('../escape'), '../escape')
            self.assertEqual(b.canonical_package_path('unrelated/sys/file'), 'unrelated/sys/file')

    def test_tree_rejects_external_symlink(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary); (root / 'escape').symlink_to('/etc/passwd')
            with self.assertRaises(ValueError):
                b.tree_receipt(root)

    def test_tree_requires_elf_entrypoints(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            for name in b.ENTRYPOINTS:
                path = root / name; path.parent.mkdir(parents=True, exist_ok=True); path.write_bytes(b'not ELF'); path.chmod(0o755)
            with self.assertRaises(ValueError):
                b.tree_receipt(root)


if __name__ == '__main__':
    unittest.main()
