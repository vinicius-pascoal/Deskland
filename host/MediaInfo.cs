// "正在播放"：读取 Windows 系统媒体控件（SMTC，Spotify / 浏览器 / 播放器都会登记）里的曲名、艺人和封面，
// 从封面取几种主色，供主题染色或显示曲名。需要 Windows 10 1809+；更早的系统上直接不可用。
// 曲名属于隐私：只发给明确请求的页面，不写日志。
using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Imaging;
using System.Globalization;
using System.IO;
using System.Text;
using System.Threading;

class MediaInfo : IDisposable
{
    public static Action<string> Log = delegate { };

    volatile string latest = OffJson;
    int seq;
    volatile bool stop;
    readonly Thread thread;
    public const string OffJson = "{\"t\":\"media\",\"on\":false}";

    public string Latest { get { return latest; } }
    public int Seq { get { return Thread.VolatileRead(ref seq); } }

    // 1809 之前没有 Windows.Media.Control：类型加载会在 JIT 时失败，所以先看版本，调用处也要 try
    public static bool Supported
    {
        get
        {
            try
            {
                using (var k = Microsoft.Win32.Registry.LocalMachine.OpenSubKey(@"SOFTWARE\Microsoft\Windows NT\CurrentVersion"))
                {
                    int build;
                    return k != null && int.TryParse(Convert.ToString(k.GetValue("CurrentBuildNumber")), out build) && build >= 17763;
                }
            }
            catch { return false; }
        }
    }

    public MediaInfo()
    {
        thread = new Thread(Run);
        thread.IsBackground = true;
        thread.Name = "MediaInfo";
        thread.SetApartmentState(ApartmentState.MTA);
        thread.Start();
    }

    public void Dispose()
    {
        stop = true;
        if (!thread.Join(2000)) Log("正在播放：读取线程未及时退出");
    }

    void Run()
    {
        bool warned = false;
        while (!stop)
        {
            try { Watch(); }
            catch (Exception ex)
            {
                if (!warned) { warned = true; Log("正在播放：读取失败（" + ex.GetType().Name + "）"); }
                Publish(OffJson);
            }
            for (int i = 0; i < 30 && !stop; i++) Thread.Sleep(100);
        }
    }

    void Publish(string json)
    {
        if (json == latest) return;
        latest = json;
        Interlocked.Increment(ref seq);
    }

    // 每秒看一次当前会话；曲目变了才重新取封面、算颜色
    void Watch()
    {
        var mgr = SmtcBridge.Open();
        string lastKey = null, art = null;
        string[] colors = null;
        while (!stop)
        {
            SmtcBridge.Track tr = SmtcBridge.Current(mgr);
            if (tr == null) { lastKey = null; Publish(OffJson); }
            else
            {
                string key = tr.App + "\n" + tr.Title + "\n" + tr.Artist;
                if (key != lastKey)
                {
                    lastKey = key; art = null; colors = null;
                    byte[] img = null;
                    try { img = SmtcBridge.Thumbnail(tr); } catch { }
                    if (img != null) Analyze(img, out art, out colors);
                }
                Publish(Json(tr, art, colors));
            }
            for (int i = 0; i < 10 && !stop; i++) Thread.Sleep(100);
        }
    }

    static string Json(SmtcBridge.Track tr, string art, string[] colors)
    {
        var sb = new StringBuilder(256 + (art == null ? 0 : art.Length));
        sb.Append("{\"t\":\"media\",\"on\":true,\"playing\":").Append(tr.Playing ? "true" : "false");
        sb.Append(",\"title\":").Append(Str(tr.Title)).Append(",\"artist\":").Append(Str(tr.Artist));
        sb.Append(",\"album\":").Append(Str(tr.Album)).Append(",\"app\":").Append(Str(AppName(tr.App)));
        if (colors != null)
        {
            sb.Append(",\"colors\":[");
            for (int i = 0; i < colors.Length; i++) { if (i > 0) sb.Append(','); sb.Append('"').Append(colors[i]).Append('"'); }
            sb.Append(']');
        }
        if (art != null) sb.Append(",\"art\":\"").Append(art).Append('"');
        return sb.Append('}').ToString();
    }

    // "Spotify.exe" / "SpotifyAB.SpotifyMusic_zpdnekdrzrea0!Spotify" / "Vivaldi.3FML…" → 好认的名字
    static string AppName(string id)
    {
        if (string.IsNullOrEmpty(id)) return "";
        string s = id;
        int bang = s.LastIndexOf('!'); if (bang >= 0) s = s.Substring(bang + 1);
        if (s.EndsWith(".exe", StringComparison.OrdinalIgnoreCase)) s = s.Substring(0, s.Length - 4);
        int dot = s.IndexOf('.'); if (dot > 0) s = s.Substring(0, dot);
        int us = s.IndexOf('_'); if (us > 0) s = s.Substring(0, us);
        return s;
    }

    static string Str(string s)
    {
        if (s == null) return "\"\"";
        var sb = new StringBuilder(s.Length + 2).Append('"');
        foreach (char c in s)
        {
            if (c == '"' || c == '\\') sb.Append('\\').Append(c);
            else if (c < 0x20 || c == (char)0x2028 || c == (char)0x2029) sb.Append("\\u").Append(((int)c).ToString("x4"));
            else sb.Append(c);
        }
        return sb.Append('"').ToString();
    }

    // 封面：缩成 96px 的 JPEG（data URI，给想直接画封面的主题），再取最多 3 种主色（饱和、常见的颜色优先）
    static void Analyze(byte[] bytes, out string art, out string[] colors)
    {
        art = null; colors = null;
        try
        {
            using (var ms = new MemoryStream(bytes))
            using (var src = Image.FromStream(ms))
            {
                using (var small = new Bitmap(96, 96))
                {
                    using (var g = Graphics.FromImage(small))
                    {
                        g.InterpolationMode = System.Drawing.Drawing2D.InterpolationMode.HighQualityBicubic;
                        g.DrawImage(src, 0, 0, 96, 96);
                    }
                    using (var o = new MemoryStream())
                    {
                        small.Save(o, ImageFormat.Jpeg);
                        art = "data:image/jpeg;base64," + Convert.ToBase64String(o.ToArray());
                    }
                }
                using (var tiny = new Bitmap(24, 24))
                {
                    using (var g = Graphics.FromImage(tiny)) g.DrawImage(src, 0, 0, 24, 24);
                    colors = Dominant(tiny);
                }
            }
        }
        catch (Exception ex) { Log("正在播放：封面解析失败（" + ex.GetType().Name + "）"); }
    }

    static string[] Dominant(Bitmap bmp)
    {
        // 按 12 个色相 × 明暗 2 档分桶，权重 = 饱和度 × 适中亮度；灰色另记一桶
        var weight = new double[25];
        var sum = new double[25, 3];
        for (int y = 0; y < bmp.Height; y++)
            for (int x = 0; x < bmp.Width; x++)
            {
                Color c = bmp.GetPixel(x, y);
                float h = c.GetHue(), s = c.GetSaturation(), l = c.GetBrightness();
                int b; double w;
                if (s < 0.18 || l < 0.08 || l > 0.94) { b = 24; w = 0.15; }
                else { b = ((int)(h / 30) % 12) * 2 + (l < 0.45 ? 0 : 1); w = s * (1 - Math.Abs(l - 0.5) * 1.2); }
                weight[b] += w; sum[b, 0] += c.R * w; sum[b, 1] += c.G * w; sum[b, 2] += c.B * w;
            }
        var order = new List<int>();
        for (int i = 0; i < 25; i++) if (weight[i] > 0) order.Add(i);
        order.Sort((a, b) => weight[b].CompareTo(weight[a]));
        var list = new List<string>();
        foreach (int i in order)
        {
            if (list.Count >= 3) break;
            if (list.Count > 0 && weight[i] < weight[order[0]] * 0.08) break;   // 太少的不算主色
            double w = weight[i];
            list.Add(string.Format(CultureInfo.InvariantCulture, "#{0:x2}{1:x2}{2:x2}",
                (int)Math.Round(sum[i, 0] / w), (int)Math.Round(sum[i, 1] / w), (int)Math.Round(sum[i, 2] / w)));
        }
        return list.Count > 0 ? list.ToArray() : null;
    }
}

// 所有 WinRT 类型都只出现在这个类里：老系统上加载失败时，异常停在调用处，不会拖垮宿主
static class SmtcBridge
{
    public class Track
    {
        public string App, Title, Artist, Album;
        public bool Playing;
        internal object Props;
    }

    static T Wait<T>(Windows.Foundation.IAsyncOperation<T> op)
    {
        var until = DateTime.UtcNow.AddSeconds(5);
        while (op.Status == Windows.Foundation.AsyncStatus.Started)
        {
            if (DateTime.UtcNow > until) { op.Cancel(); throw new TimeoutException(); }
            Thread.Sleep(5);
        }
        if (op.Status != Windows.Foundation.AsyncStatus.Completed) throw op.ErrorCode ?? new InvalidOperationException(op.Status.ToString());
        return op.GetResults();
    }

    public static object Open()
    {
        return Wait(Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager.RequestAsync());
    }

    // 优先系统认定的当前会话；它没在播而别的会话在播时，用在播的那个
    public static Track Current(object manager)
    {
        var mgr = (Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager)manager;
        var cur = mgr.GetCurrentSession();
        if (cur == null || !IsPlaying(cur))
            foreach (var s in mgr.GetSessions()) if (IsPlaying(s)) { cur = s; break; }
        if (cur == null) return null;
        var props = Wait(cur.TryGetMediaPropertiesAsync());
        if (props == null || string.IsNullOrEmpty(props.Title)) return null;
        return new Track { App = cur.SourceAppUserModelId, Title = props.Title, Artist = props.Artist, Album = props.AlbumTitle, Playing = IsPlaying(cur), Props = props };
    }

    static bool IsPlaying(Windows.Media.Control.GlobalSystemMediaTransportControlsSession s)
    {
        var info = s.GetPlaybackInfo();
        return info != null && info.PlaybackStatus == Windows.Media.Control.GlobalSystemMediaTransportControlsSessionPlaybackStatus.Playing;
    }

    public static byte[] Thumbnail(Track tr)
    {
        var props = (Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties)tr.Props;
        if (props.Thumbnail == null) return null;
        var st = Wait(props.Thumbnail.OpenReadAsync());
        if (st.Size == 0 || st.Size > 8 * 1024 * 1024) return null;
        var reader = new Windows.Storage.Streams.DataReader(st);
        uint n = Wait(reader.LoadAsync((uint)st.Size));
        var bytes = new byte[n];
        reader.ReadBytes(bytes);
        return bytes;
    }
}
