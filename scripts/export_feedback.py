#!/usr/bin/env python3
"""Export private feedback for the owner; never create a public feedback endpoint.
Usage: .einstein-venv/bin/python scripts/export_feedback.py --output /private/path/feedback.json
"""
from __future__ import annotations
import argparse
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import sys

ROOT=Path(__file__).resolve().parent.parent
sys.path.insert(0,str(ROOT))
from lab_backend.feedback import FeedbackStore


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output',type=Path)
    parser.add_argument('--limit',type=int,default=100)
    args=parser.parse_args()
    default=ROOT/'.work/private'/('feedback-'+datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')+'.json')
    destination=(args.output or default).resolve()
    if ROOT.joinpath('rehearsal/public').resolve() in destination.parents or ROOT.joinpath('rehearsal/dist').resolve() in destination.parents:
        raise SystemExit('Feedback cannot be exported into a publicly served directory.')
    path=Path(os.environ.get('EINSTEIN_FEEDBACK_PATH',str(ROOT/'.work/private/feedback.sqlite3')))
    if not path.exists():raise SystemExit('No feedback has been collected yet.')
    records=FeedbackStore(path).read(limit=args.limit)
    destination.parent.mkdir(parents=True,exist_ok=True)
    descriptor=os.open(destination,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
    with os.fdopen(descriptor,'w') as output:
        json.dump({'exported_at':datetime.now(timezone.utc).isoformat(),'entries':records},output,ensure_ascii=False,indent=2)
    print(json.dumps({'entries':len(records),'private_export':str(destination),'file_mode':'0600'}))


if __name__=='__main__':main()
