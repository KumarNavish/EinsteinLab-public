using System;
using System.IO;
using MRDemo;
public static class WaveCodecTests
{
    static int passed;
    static void Check(bool value, string name) { if (!value) throw new Exception(name); passed++; Console.WriteLine("PASS " + name); }
    static void Reject(Action action, string name) { try { action(); } catch (ArgumentException) { Check(true,name); return; } catch (InvalidDataException) { Check(true,name); return; } throw new Exception("Accepted invalid input: " + name); }
    public static void Main()
    {
        var input = new float[] {0f,.25f,-.5f,.75f,1f,-1f};
        var encoded = LabWaveCodec.Encode(input,1,24000);
        var decoded = LabWaveCodec.Decode(encoded);
        Check(decoded.sampleRate==24000 && decoded.channels==1,"format_roundtrip");
        Check(decoded.samples.Length==input.Length,"sample_count");
        double max=0; for(int i=0;i<input.Length;i++) max=Math.Max(max,Math.Abs(input[i]-decoded.samples[i]));
        Check(max<0.0001,"pcm16_roundtrip_precision");
        decoded=LabWaveCodec.Decode(LabWaveCodec.Encode(new float[]{1f,-1f,.5f,.5f},2,16000));
        Check(decoded.channels==1 && Math.Abs(decoded.samples[0])<0.0001 && Math.Abs(decoded.samples[1]-.5)<0.0001,"stereo_downmix");
        decoded=LabWaveCodec.Decode(LabWaveCodec.Encode(new float[]{float.NaN,float.PositiveInfinity,2,-2},1,16000));
        Check(decoded.samples[0]==0 && decoded.samples[1]==0 && decoded.samples[2]>.99 && decoded.samples[3]<-.99,"nonfinite_and_clipping");
        Reject(()=>LabWaveCodec.Decode(new byte[10]),"short_input_rejected");
        Reject(()=>LabWaveCodec.Encode(input,0,16000),"invalid_channels_rejected");
        Reject(()=>LabWaveCodec.Encode(input,1,4000),"invalid_sample_rate_rejected");
        Reject(()=>LabWaveCodec.Encode(new float[16000*31],1,16000),"duration_limit");
        var broken=(byte[])encoded.Clone();broken[0]=0;
        Reject(()=>LabWaveCodec.Decode(broken),"invalid_riff_rejected");
        var truncated=new byte[encoded.Length-2];Array.Copy(encoded,truncated,truncated.Length);
        Reject(()=>LabWaveCodec.Decode(truncated),"truncated_chunk_rejected");
        Console.WriteLine("NATIVE_CODEC_TESTS_PASSED="+passed);
        Console.WriteLine("Scope: standalone C# codec under Mono, not Unity scene compilation or a licensed player build.");
    }
}
