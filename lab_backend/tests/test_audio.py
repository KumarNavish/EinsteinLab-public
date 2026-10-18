import io,wave
import numpy as np
import pytest
from lab_backend.audio import decode_audio

def wav(rate=22050,seconds=.5,channels=1):
    data=(np.sin(np.arange(int(rate*seconds))*2*np.pi*440/rate)*16000).astype('<i2')
    if channels==2:data=np.column_stack((data,data)).reshape(-1)
    out=io.BytesIO()
    with wave.open(out,'wb') as w:w.setnchannels(channels);w.setsampwidth(2);w.setframerate(rate);w.writeframes(data.tobytes())
    return io.BytesIO(out.getvalue())

@pytest.mark.parametrize('rate',[8000,16000,22050,48000])
def test_resamples_common_microphone_rates(rate):
    x=decode_audio(wav(rate));assert abs(len(x)-8000)<3;assert x.dtype==np.float32;assert np.isfinite(x).all()

def test_stereo_downmix():
    x=decode_audio(wav(channels=2));assert len(x)==8000 and np.max(np.abs(x))<1

def test_invalid_container():
    with pytest.raises(ValueError):decode_audio(io.BytesIO(b'not an audio file'))

def test_duration_bound():
    with pytest.raises(ValueError,match='30 seconds'):decode_audio(wav(rate=16000,seconds=31))
