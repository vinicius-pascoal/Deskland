// 系统声音回环采集（WASAPI loopback）：只读"电脑正在播放的声音"，不碰麦克风，数据不离开本机。
// 后台线程每 10ms 取一次声卡混音，约每 33ms 做一次 FFT，算出 32 段频谱、整体音量、低中高三档和节拍，
// 结果写成一条 JSON（Latest / Seq），由界面线程的 AudioFeed 转发给需要的壁纸页面。
using System;
using System.Diagnostics;
using System.Globalization;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

class AudioLoopback : IDisposable
{
    public const int Bands = 32;
    public static Action<string> Log = delegate { };

    volatile string latest;
    int seq;
    volatile bool stop;
    readonly Thread thread;

    public string Latest { get { return latest; } }
    public int Seq { get { return Thread.VolatileRead(ref seq); } }

    public AudioLoopback()
    {
        thread = new Thread(Run);
        thread.IsBackground = true;
        thread.Name = "AudioLoopback";
        thread.SetApartmentState(ApartmentState.MTA);    // 音频 COM 对象在本线程创建、使用，不跨线程封送
        thread.Start();
    }

    public void Dispose()
    {
        stop = true;
        if (!thread.Join(1500)) Log("音频采集线程未及时退出");
    }

    void Publish(string json)
    {
        latest = json;
        Interlocked.Increment(ref seq);
    }

    // ------------------------------------------------------------ 采集循环：出错 / 换了默认输出设备就重新打开
    void Run()
    {
        int failures = 0;
        while (!stop)
        {
            string why = null;
            try { why = CaptureOnce(); failures = 0; }
            catch (Exception ex) { why = ex.Message; failures++; }
            if (stop) break;
            if (why != null && failures <= 3) Log("音频采集重新打开：" + why);
            Publish(SilentJson);                             // 断开期间页面看到的是静音
            for (int i = 0; i < (failures > 0 ? 30 : 5) && !stop; i++) Thread.Sleep(100);
        }
    }

    const string SilentJson = "{\"t\":\"audio\",\"on\":false}";
    const int ERole_Console = 0, EDataFlow_Render = 0, CLSCTX_ALL = 23;
    const int AUDCLNT_STREAMFLAGS_LOOPBACK = 0x00020000, AUDCLNT_BUFFERFLAGS_SILENT = 0x2;
    static readonly Guid IID_IAudioClient = new Guid("1CB9AD4C-DBFA-4c32-B178-C2F568A703B2");
    static readonly Guid IID_IAudioCaptureClient = new Guid("C8ADBD64-E71E-48a0-A4DE-185C395CD317");
    static readonly Guid SubtypeFloat = new Guid("00000003-0000-0010-8000-00aa00389b71");
    static readonly Guid SubtypePcm = new Guid("00000001-0000-0010-8000-00aa00389b71");

    // 返回需要重开的原因；stop 时返回 null
    string CaptureOnce()
    {
        IMMDeviceEnumerator en = null; IMMDevice dev = null; IAudioClient client = null; IAudioCaptureClient cap = null;
        IntPtr fmt = IntPtr.Zero;
        try
        {
            en = (IMMDeviceEnumerator)Activator.CreateInstance(Type.GetTypeFromCLSID(new Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")));
            int hr = en.GetDefaultAudioEndpoint(EDataFlow_Render, ERole_Console, out dev);
            if (hr != 0 || dev == null) return "没有可用的输出设备 (0x" + hr.ToString("X8") + ")";
            string devId; dev.GetId(out devId);
            object o; Guid iid = IID_IAudioClient;
            Marshal.ThrowExceptionForHR(dev.Activate(ref iid, CLSCTX_ALL, IntPtr.Zero, out o));
            client = (IAudioClient)o;
            Marshal.ThrowExceptionForHR(client.GetMixFormat(out fmt));

            int tag = Marshal.ReadInt16(fmt, 0) & 0xFFFF, channels = Marshal.ReadInt16(fmt, 2);
            int rate = Marshal.ReadInt32(fmt, 4), block = Marshal.ReadInt16(fmt, 12), bits = Marshal.ReadInt16(fmt, 14);
            bool isFloat = tag == 3, isPcm = tag == 1;
            if (tag == 0xFFFE)
            {
                byte[] g = new byte[16];
                Marshal.Copy(new IntPtr(fmt.ToInt64() + 24), g, 0, 16);
                Guid sub = new Guid(g);
                isFloat = sub == SubtypeFloat; isPcm = sub == SubtypePcm;
            }
            if (!(isFloat && bits == 32) && !(isPcm && (bits == 16 || bits == 24 || bits == 32)) || channels < 1)
                return "不支持的混音格式 tag=" + tag + " bits=" + bits;

            Marshal.ThrowExceptionForHR(client.Initialize(0, AUDCLNT_STREAMFLAGS_LOOPBACK, 2000000, 0, fmt, IntPtr.Zero));
            iid = IID_IAudioCaptureClient;
            Marshal.ThrowExceptionForHR(client.GetService(ref iid, out o));
            cap = (IAudioCaptureClient)o;
            Marshal.ThrowExceptionForHR(client.Start());
            Log("开始采集系统声音：" + rate + "Hz " + channels + "ch " + bits + "bit" + (isFloat ? " float" : ""));

            var an = new Analyzer(rate);
            var sw = Stopwatch.StartNew();
            long nextFrame = 0, nextDevCheck = 2000;
            float[] mono = new float[4096];
            while (!stop)
            {
                uint packet;
                hr = cap.GetNextPacketSize(out packet);
                if (hr != 0) return "读取失败 (0x" + hr.ToString("X8") + ")";
                while (packet > 0)
                {
                    IntPtr data; uint frames, flags; ulong p1, p2;
                    hr = cap.GetBuffer(out data, out frames, out flags, out p1, out p2);
                    if (hr != 0) return "读取失败 (0x" + hr.ToString("X8") + ")";
                    if (mono.Length < frames) mono = new float[frames];
                    if ((flags & AUDCLNT_BUFFERFLAGS_SILENT) != 0) Array.Clear(mono, 0, (int)frames);
                    else Downmix(data, (int)frames, channels, block, bits, isFloat, mono);
                    an.Push(mono, (int)frames);
                    cap.ReleaseBuffer(frames);
                    hr = cap.GetNextPacketSize(out packet);
                    if (hr != 0) return "读取失败 (0x" + hr.ToString("X8") + ")";
                }
                long now = sw.ElapsedMilliseconds;
                if (now >= nextFrame)
                {
                    nextFrame += 33;                           // 固定节拍：Sleep 精度约 15.6ms，平均下来仍是 30 帧
                    if (nextFrame <= now) nextFrame = now + 33;
                    string json = an.Frame(now);
                    if (json != null) Publish(json);
                }
                if (now >= nextDevCheck)                       // 插上耳机 / 换了默认设备：跟着新的默认设备走
                {
                    nextDevCheck = now + 2000;
                    IMMDevice cur = null;
                    try
                    {
                        string curId = null;
                        if (en.GetDefaultAudioEndpoint(EDataFlow_Render, ERole_Console, out cur) == 0 && cur != null) cur.GetId(out curId);
                        if (curId != devId) return "默认输出设备已更换";
                    }
                    finally { if (cur != null) Marshal.ReleaseComObject(cur); }
                }
                Thread.Sleep(10);
            }
            client.Stop();
            return null;
        }
        finally
        {
            if (fmt != IntPtr.Zero) Marshal.FreeCoTaskMem(fmt);
            if (cap != null) Marshal.ReleaseComObject(cap);
            if (client != null) Marshal.ReleaseComObject(client);
            if (dev != null) Marshal.ReleaseComObject(dev);
            if (en != null) Marshal.ReleaseComObject(en);
        }
    }

    byte[] buf = new byte[0];
    void Downmix(IntPtr data, int frames, int channels, int block, int bits, bool isFloat, float[] mono)
    {
        int bytes = frames * block;
        if (buf.Length < bytes) buf = new byte[bytes];
        Marshal.Copy(data, buf, 0, bytes);
        int step = bits / 8;
        float k = 1f / channels;
        for (int f = 0; f < frames; f++)
        {
            float s = 0;
            int at = f * block;
            for (int c = 0; c < channels; c++, at += step)
            {
                if (isFloat) s += BitConverter.ToSingle(buf, at);
                else if (bits == 16) s += BitConverter.ToInt16(buf, at) / 32768f;
                else if (bits == 24) s += ((buf[at] << 8 | buf[at + 1] << 16 | buf[at + 2] << 24) >> 8) / 8388608f;
                else s += BitConverter.ToInt32(buf, at) / 2147483648f;
            }
            mono[f] = s * k;
        }
    }

    // ------------------------------------------------------------ 分析：频谱、音量、节拍
    class Analyzer
    {
        readonly int rate, n;
        readonly float[] ring;
        int ringAt, fresh;
        readonly double[] win, re, im;
        readonly int[] bandLo, bandHi;
        readonly double[] tilt, bands = new double[Bands], prevBass = new double[43];
        int prevAt, prevCount;
        double peakDb = -30, rmsPeak = -30, lastBeatAt = -1e9, level, bass, mid, high, lastBassE;
        int beats, quietFrames;
        bool idle = true;

        public Analyzer(int rate)
        {
            this.rate = rate;
            n = rate > 60000 ? 4096 : 2048;
            ring = new float[n];
            win = new double[n]; re = new double[n]; im = new double[n];
            for (int i = 0; i < n; i++) win[i] = 0.5 - 0.5 * Math.Cos(2 * Math.PI * i / (n - 1));
            // 32 段，30Hz – 16kHz 对数分布；低频段比一个 FFT 格还窄时至少取最近的一格
            bandLo = new int[Bands]; bandHi = new int[Bands]; tilt = new double[Bands];
            double fMin = 30, fMax = Math.Min(16000, rate / 2.0 - 1), hz = (double)rate / n;
            for (int b = 0; b < Bands; b++)
            {
                double lo = fMin * Math.Pow(fMax / fMin, (double)b / Bands), hi = fMin * Math.Pow(fMax / fMin, (double)(b + 1) / Bands);
                int a = (int)Math.Round(lo / hz), z = (int)Math.Round(hi / hz) - 1;
                if (z < a) z = a = (int)Math.Round(Math.Sqrt(lo * hi) / hz);
                bandLo[b] = Math.Max(1, a); bandHi[b] = Math.Min(n / 2 - 1, Math.Max(bandLo[b], z));
                tilt[b] = 3 * Math.Log(Math.Sqrt(lo * hi) / 1000, 2);   // 每倍频程 +3dB，抵消音乐里低频天然更响
            }
        }

        public void Push(float[] src, int count)
        {
            for (int i = 0; i < count; i++) { ring[ringAt] = src[i]; ringAt = (ringAt + 1) % n; }
            fresh += count;
        }

        // 33ms 一次；静音稳定后返回一次 on:false，之后返回 null（不再打扰页面）
        public string Frame(long nowMs)
        {
            if (fresh == 0) { Array.Clear(ring, 0, n); }   // 没有新数据：系统没在放声音
            int recent = Math.Min(n, Math.Max(fresh, rate / 30));
            fresh = 0;

            double sq = 0;
            for (int i = 0; i < recent; i++) { double s = ring[(ringAt - 1 - i + n) % n]; sq += s * s; }
            double rmsDb = 10 * Math.Log10(sq / recent + 1e-12);

            if (rmsDb < -70) quietFrames++; else quietFrames = 0;
            if (quietFrames > 30 && level < 0.01)              // 安静了 1 秒且画面已经落回去
            {
                if (idle) return null;
                idle = true;
                Array.Clear(bands, 0, Bands); level = bass = mid = high = 0;
                return SilentJson;
            }
            idle = false;

            for (int i = 0; i < n; i++) { re[i] = ring[(ringAt + i) % n] * win[i]; im[i] = 0; }
            Fft(re, im);

            // 自动增益：参考电平跟着最响的段走，慢慢回落（约 3dB/秒），保证小音量时也有起伏
            double norm = 4.0 / n, maxDb = -200;
            double bassE = 0;
            double[] db = new double[Bands];
            for (int b = 0; b < Bands; b++)
            {
                double p = 0;
                for (int k = bandLo[b]; k <= bandHi[b]; k++) p += re[k] * re[k] + im[k] * im[k];
                p /= bandHi[b] - bandLo[b] + 1;
                if (b < 6) bassE += p;                         // 约 30–150Hz：底鼓、贝斯
                db[b] = 10 * Math.Log10(p * norm * norm + 1e-14) + tilt[b];
                if (db[b] > maxDb) maxDb = db[b];
            }
            peakDb = maxDb > peakDb ? maxDb : Math.Max(-45, peakDb - 0.1);
            rmsPeak = rmsDb > rmsPeak ? rmsDb : Math.Max(-40, rmsPeak - 0.1);

            double sb = 0, sm = 0, sh = 0; int nb = 0, nm = 0, nh = 0;
            double hz = (double)rate / n;
            for (int b = 0; b < Bands; b++)
            {
                double v = Clamp((db[b] - (peakDb - 48)) / 48);
                v *= v;                                        // 压低底噪，让峰更突出
                bands[b] += (v - bands[b]) * (v > bands[b] ? 0.7 : 0.25);
                double fc = (bandLo[b] + bandHi[b]) * 0.5 * hz;
                if (fc < 250) { sb += bands[b]; nb++; } else if (fc < 2000) { sm += bands[b]; nm++; } else { sh += bands[b]; nh++; }
            }
            bass = nb > 0 ? sb / nb : 0; mid = nm > 0 ? sm / nm : 0; high = nh > 0 ? sh / nh : 0;
            double lv = Clamp((rmsDb - (rmsPeak - 36)) / 36);
            level += (lv - level) * (lv > level ? 0.6 : 0.2);

            // 节拍：低频能量明显高于最近 1.4 秒的平均（且在上升），两拍至少隔 270ms
            double mean = 0, var = 0;
            for (int i = 0; i < prevCount; i++) mean += prevBass[i];
            if (prevCount > 0) mean /= prevCount;
            for (int i = 0; i < prevCount; i++) var += (prevBass[i] - mean) * (prevBass[i] - mean);
            double sd = prevCount > 1 ? Math.Sqrt(var / prevCount) : 0;
            bool beat = prevCount >= 15 && bassE > mean * 1.3 + sd * 0.5 && bassE > lastBassE && bass > 0.2 && nowMs - lastBeatAt > 270;
            if (beat) { beats++; lastBeatAt = nowMs; }
            lastBassE = bassE;
            prevBass[prevAt] = bassE; prevAt = (prevAt + 1) % prevBass.Length; if (prevCount < prevBass.Length) prevCount++;

            var sbj = new StringBuilder(400);
            var ci = CultureInfo.InvariantCulture;
            sbj.Append("{\"t\":\"audio\",\"on\":true,\"lv\":").Append(level.ToString("0.###", ci))
               .Append(",\"bass\":").Append(bass.ToString("0.###", ci))
               .Append(",\"mid\":").Append(mid.ToString("0.###", ci))
               .Append(",\"high\":").Append(high.ToString("0.###", ci))
               .Append(",\"beats\":").Append(beats)
               .Append(",\"b\":[");
            for (int b = 0; b < Bands; b++) { if (b > 0) sbj.Append(','); sbj.Append(bands[b].ToString("0.###", ci)); }
            return sbj.Append("]}").ToString();
        }

        static double Clamp(double v) { return v < 0 ? 0 : v > 1 ? 1 : v; }

        static void Fft(double[] re, double[] im)
        {
            int n = re.Length;
            for (int i = 1, j = 0; i < n; i++)
            {
                int bit = n >> 1;
                for (; (j & bit) != 0; bit >>= 1) j ^= bit;
                j ^= bit;
                if (i < j) { double t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; }
            }
            for (int len = 2; len <= n; len <<= 1)
            {
                double ang = -2 * Math.PI / len, wr = Math.Cos(ang), wi = Math.Sin(ang);
                for (int i = 0; i < n; i += len)
                {
                    double cr = 1, ci = 0;
                    for (int k = 0; k < len / 2; k++)
                    {
                        int a = i + k, b = a + len / 2;
                        double xr = re[b] * cr - im[b] * ci, xi = re[b] * ci + im[b] * cr;
                        re[b] = re[a] - xr; im[b] = im[a] - xi;
                        re[a] += xr; im[a] += xi;
                        double t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t;
                    }
                }
            }
        }
    }

    // ------------------------------------------------------------ Core Audio COM 接口（只声明用到的部分，顺序须与 vtable 一致）
    [ComImport, Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IMMDeviceEnumerator
    {
        [PreserveSig] int EnumAudioEndpoints(int dataFlow, int stateMask, out IntPtr devices);
        [PreserveSig] int GetDefaultAudioEndpoint(int dataFlow, int role, out IMMDevice device);
    }

    [ComImport, Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IMMDevice
    {
        [PreserveSig] int Activate(ref Guid iid, int clsCtx, IntPtr activationParams, [MarshalAs(UnmanagedType.IUnknown)] out object iface);
        [PreserveSig] int OpenPropertyStore(int access, out IntPtr store);
        [PreserveSig] int GetId([MarshalAs(UnmanagedType.LPWStr)] out string id);
    }

    [ComImport, Guid("1CB9AD4C-DBFA-4c32-B178-C2F568A703B2"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IAudioClient
    {
        [PreserveSig] int Initialize(int shareMode, int streamFlags, long bufferDuration, long periodicity, IntPtr format, IntPtr sessionGuid);
        [PreserveSig] int GetBufferSize(out uint frames);
        [PreserveSig] int GetStreamLatency(out long latency);
        [PreserveSig] int GetCurrentPadding(out uint padding);
        [PreserveSig] int IsFormatSupported(int shareMode, IntPtr format, out IntPtr closest);
        [PreserveSig] int GetMixFormat(out IntPtr format);
        [PreserveSig] int GetDevicePeriod(out long defaultPeriod, out long minPeriod);
        [PreserveSig] int Start();
        [PreserveSig] int Stop();
        [PreserveSig] int Reset();
        [PreserveSig] int SetEventHandle(IntPtr handle);
        [PreserveSig] int GetService(ref Guid iid, [MarshalAs(UnmanagedType.IUnknown)] out object service);
    }

    [ComImport, Guid("C8ADBD64-E71E-48a0-A4DE-185C395CD317"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IAudioCaptureClient
    {
        [PreserveSig] int GetBuffer(out IntPtr data, out uint frames, out uint flags, out ulong devicePosition, out ulong qpcPosition);
        [PreserveSig] int ReleaseBuffer(uint frames);
        [PreserveSig] int GetNextPacketSize(out uint frames);
    }
}
