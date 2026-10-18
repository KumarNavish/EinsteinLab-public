#!/usr/bin/env python3
"""Fail a public release when required visitor scenarios lack real passing evidence.

A green unit suite or localhost screenshot cannot satisfy this gate. This tool
reads the reviewable acceptance manifest; it never deploys or changes providers.
"""
from __future__ import annotations
import argparse
import hashlib
import json
from pathlib import Path
from urllib.parse import urlsplit

REQUIRED = {'conversation','paper','video','slides','visualization','lab_research',
            'failure_recovery','visitor_isolation','feedback','credential_security',
            'asset_distribution_authorization','cost_ceiling','external_https_visit'}


def evaluate(manifest:dict, root:Path):
    problems=[]
    url=manifest.get('public_url')
    if not isinstance(url,str) or urlsplit(url).scheme!='https' or urlsplit(url).hostname in {None,'localhost','127.0.0.1'}:
        problems.append('No verified external HTTPS application URL')
    if manifest.get('depends_on_personal_computer') is not False:
        problems.append('Laptop independence has not been established')
    checks=manifest.get('checks',{})
    for name in sorted(REQUIRED):
        record=checks.get(name,{})
        if record.get('status')!='passed':
            problems.append(name+': '+record.get('status','missing'))
            continue
        references=record.get('evidence',[])
        if not references:
            problems.append(name+': no evidence artifact')
        for reference in references:
            relative=reference.get('path','')
            path=(root/relative).resolve()
            if not relative or root.resolve() not in path.parents or not path.is_file():
                problems.append(name+': missing or out-of-scope evidence file');continue
            digest=hashlib.sha256(path.read_bytes()).hexdigest()
            if digest!=reference.get('sha256'):
                problems.append(name+': evidence hash mismatch')
    return problems


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--manifest',type=Path,default=Path('release/readiness.json'))
    args=parser.parse_args()
    root=Path(__file__).resolve().parent.parent
    path=args.manifest if args.manifest.is_absolute() else root/args.manifest
    if not path.is_file():raise SystemExit('Release blocked: no acceptance manifest.')
    problems=evaluate(json.loads(path.read_text()),root)
    print(json.dumps({'public_release_allowed':not problems,'blocking_checks':problems},indent=2))
    raise SystemExit(1 if problems else 0)


if __name__=='__main__':main()
