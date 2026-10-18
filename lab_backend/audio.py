"""Bounded in-memory audio decoding using the current PyAV API."""
from __future__ import annotations
import io
import av
import numpy as np

def decode_audio(input_file: io.BytesIO, sampling_rate: int=16000) -> np.ndarray:
    if sampling_rate != 16000:
        raise ValueError('The transcription boundary requires 16 kHz mono')
    chunks=[]; count=0; resampler=av.AudioResampler(format='s16',layout='mono',rate=sampling_rate)
    try:
        # A microphone upload must never cause FFmpeg to fetch a remote playlist.
        with av.open(input_file,mode='r',options={'protocol_whitelist':'pipe,data'}) as container:
            if not set(container.format.name.split(',')) & {'wav','matroska','webm','mov','mp4','m4a','3gp','3g2','mj2','ogg','mp3','flac'}:
                raise ValueError('Unsupported audio container')
            for frame in container.decode(audio=0):
                frame.pts=None
                for converted in resampler.resample(frame):
                    samples=converted.to_ndarray().reshape(-1)
                    count+=len(samples)
                    if count>480000: raise ValueError('Audio exceeds 30 seconds')
                    chunks.append(samples)
            for converted in resampler.resample(None):
                samples=converted.to_ndarray().reshape(-1); count+=len(samples)
                if count>480000: raise ValueError('Audio exceeds 30 seconds')
                chunks.append(samples)
    except (av.error.FFmpegError, EOFError, IndexError) as e:
        raise ValueError('The uploaded audio could not be decoded') from e
    return np.concatenate(chunks).astype(np.float32)/32768.0 if chunks else np.empty(0,dtype=np.float32)
