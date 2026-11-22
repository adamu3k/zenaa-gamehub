// ZENAA Station — Windows screen app for PC gaming stations.
//
//  * Pairs with one ZENAA station using a 6-digit code (Stations → ✏️ → Station screen → Pair a screen).
//  * Shows the timer as a small "island" pill at the top centre (ring · time · temperature) or a corner box,
//    grows the island for alerts and staff messages, warns before time runs out,
//    and covers every monitor when time is up / nobody has paid (blocks Win, Alt+Tab, Alt+F4).
//  * Staff unlock or exit with Ctrl+Shift+F12 and their own staff PIN (or the offline exit PIN from Settings).
//  * Chimes at 5 minutes left, beeps every second for the last 10 seconds, and rings an alarm at zero.
//  * Keeps counting down if the network drops, and locks at zero.
//  * Starts by itself: copies itself to %LOCALAPPDATA%\ZenaaStation, removes the "downloaded from the internet" mark
//    (SmartScreen would otherwise stop it at sign-in), registers in Run (re-enabled if switched off in Startup apps)
//    and a Task Scheduler check every 2 minutes that starts it again if it was closed or crashed.
//
// Build (no Visual Studio needed — uses the C# compiler that ships with Windows):
//   agents\windows\build.cmd
// Written for C# 5 / .NET Framework 4.x so it runs on any Windows 7–11 PC without installing anything.

using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.IO;
using System.Net;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;
using System.Windows.Forms;
using Microsoft.Win32;

[assembly: System.Reflection.AssemblyTitle("ZENAA Station")]
[assembly: System.Reflection.AssemblyProduct("ZENAA GAMEHUB")]
[assembly: System.Reflection.AssemblyVersion("1.4.0.0")]
[assembly: System.Reflection.AssemblyFileVersion("1.4.0.0")]

namespace Zenaa
{
    static class App
    {
        public const string Version = "1.4.0";
        public static string Dir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "ZenaaStation");
        public static string ConfigPath = Path.Combine(Dir, "config.txt");

        [STAThread]
        static void Main(string[] args)
        {
            if (args.Length == 2 && args[0] == "--preview") { IslandForm.Preview(args[1]); return; }
            if (args.Length == 2 && args[0] == "--sounds") { Sound.Save(args[1]); return; }
            bool created;
            using (var mutex = new Mutex(true, "Global\\ZenaaStationSingleInstance", out created))
            {
                if (!created) return; // already running
                bool watchdog = Array.IndexOf(args, "--watchdog") >= 0;
                // Staff chose Exit: the 2-minute check leaves it closed until the PC restarts.
                if (watchdog && App.StoppedSinceBoot()) return;
                App.ClearStopped();
                ServicePointManager.SecurityProtocol = (SecurityProtocolType)3072 | (SecurityProtocolType)768; // TLS 1.2 / 1.1
                Application.EnableVisualStyles();
                Application.SetCompatibleTextRenderingDefault(false);
                var cfg = Config.Load();
                if (string.IsNullOrEmpty(cfg.Token))
                {
                    using (var pair = new PairForm(cfg))
                    {
                        if (pair.ShowDialog() != DialogResult.OK) return;
                    }
                }
                App.Install();
                Application.Run(new Controller(cfg));
            }
        }

        public static string InstallDir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "ZenaaStation");
        public static string InstalledExe = Path.Combine(InstallDir, "ZenaaStation.exe");
        const string TaskName = "ZENAA Station";
        static string StoppedPath { get { return Path.Combine(Dir, "stopped.txt"); } }

        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        static extern bool DeleteFileW(string name);

        /// <summary>
        /// Makes the app start by itself after every restart:
        ///  1. copies itself to %LOCALAPPDATA%\ZenaaStation (a cleaned-up Downloads folder can't break it);
        ///  2. removes the "downloaded from the internet" mark, so SmartScreen doesn't stop it at sign-in;
        ///  3. Run entry in the registry, switched back on if someone turned it off in Startup apps;
        ///  4. a Task Scheduler check every 2 minutes that starts it again if it was closed or crashed.
        /// </summary>
        public static void Install()
        {
            string exe = Application.ExecutablePath;
            string target = exe;
            try
            {
                if (!string.Equals(Path.GetFullPath(exe), Path.GetFullPath(InstalledExe), StringComparison.OrdinalIgnoreCase))
                {
                    Directory.CreateDirectory(InstallDir);
                    File.Copy(exe, InstalledExe, true);
                    target = InstalledExe;
                }
            }
            catch { target = exe; }
            try { DeleteFileW(target + ":Zone.Identifier"); DeleteFileW(exe + ":Zone.Identifier"); } catch { }
            SetAutostart(true, target);
        }

        public static void SetAutostart(bool on, string path = null)
        {
            path = path ?? (File.Exists(InstalledExe) ? InstalledExe : Application.ExecutablePath);
            try
            {
                using (var key = Registry.CurrentUser.OpenSubKey("Software\\Microsoft\\Windows\\CurrentVersion\\Run", true))
                {
                    if (key != null)
                    {
                        if (on) key.SetValue("ZenaaStation", "\"" + path + "\"");
                        else key.DeleteValue("ZenaaStation", false);
                    }
                }
                // Task Manager / Settings → Startup apps keeps its own on/off switch: make sure it says "on".
                using (var key = Registry.CurrentUser.OpenSubKey("Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\StartupApproved\\Run", true))
                {
                    if (key != null && key.GetValue("ZenaaStation") != null)
                    {
                        if (on) key.SetValue("ZenaaStation", new byte[] { 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0 }, RegistryValueKind.Binary);
                        else key.DeleteValue("ZenaaStation", false);
                    }
                }
            }
            catch { }
            if (on) Schtasks("/Create /F /TN \"" + TaskName + "\" /SC MINUTE /MO 2 /TR \"\\\"" + path + "\\\" --watchdog\"");
            else Schtasks("/Delete /F /TN \"" + TaskName + "\"");
        }

        static void Schtasks(string arguments)
        {
            try
            {
                var psi = new ProcessStartInfo("schtasks.exe", arguments) { CreateNoWindow = true, UseShellExecute = false, WindowStyle = ProcessWindowStyle.Hidden };
                using (var p = Process.Start(psi)) { p.WaitForExit(8000); }
            }
            catch { }
        }

        /// <summary>Staff pressed Exit: remember it, so the 2-minute check doesn't reopen the app until the next restart.</summary>
        public static void MarkStopped()
        {
            try { Directory.CreateDirectory(Dir); File.WriteAllText(StoppedPath, DateTime.UtcNow.ToString("o")); } catch { }
        }

        public static void ClearStopped()
        {
            try { if (File.Exists(StoppedPath)) File.Delete(StoppedPath); } catch { }
        }

        public static bool StoppedSinceBoot()
        {
            try
            {
                if (!File.Exists(StoppedPath)) return false;
                var bootUtc = DateTime.UtcNow - TimeSpan.FromMilliseconds(Environment.TickCount & int.MaxValue);
                return File.GetLastWriteTimeUtc(StoppedPath) > bootUtc;
            }
            catch { return false; }
        }

        public static string Sha256(string s)
        {
            using (var sha = SHA256.Create())
            {
                var b = sha.ComputeHash(Encoding.UTF8.GetBytes(s));
                var sb = new StringBuilder();
                foreach (var x in b) sb.Append(x.ToString("x2"));
                return sb.ToString();
            }
        }

        public static string Clock(int seconds)
        {
            if (seconds < 0) seconds = 0;
            int h = seconds / 3600, m = (seconds % 3600) / 60, s = seconds % 60;
            return h > 0 ? string.Format("{0}:{1:00}:{2:00}", h, m, s) : string.Format("{0:00}:{1:00}", m, s);
        }
    }

    class Config
    {
        public string Server = "";
        public string Token = "";
        public string StationName = "";
        public string DockCorner = "top-right";

        public static Config Load()
        {
            var c = new Config();
            try
            {
                if (File.Exists(App.ConfigPath))
                {
                    foreach (var line in File.ReadAllLines(App.ConfigPath))
                    {
                        int i = line.IndexOf('=');
                        if (i <= 0) continue;
                        string k = line.Substring(0, i).Trim(), v = line.Substring(i + 1).Trim();
                        if (k == "server") c.Server = v;
                        else if (k == "token") c.Token = v;
                        else if (k == "station") c.StationName = v;
                        else if (k == "dock") c.DockCorner = v;
                    }
                }
            }
            catch { }
            return c;
        }

        public void Save()
        {
            Directory.CreateDirectory(App.Dir);
            File.WriteAllLines(App.ConfigPath, new[] { "server=" + Server, "token=" + Token, "station=" + StationName, "dock=" + DockCorner });
        }
    }

    static class Api
    {
        static readonly JavaScriptSerializer Json = new JavaScriptSerializer();

        public static Dictionary<string, object> Call(string method, string url, string token, object body, out int status)
        {
            var req = (HttpWebRequest)WebRequest.Create(url);
            req.Method = method;
            req.Timeout = 8000;
            req.ReadWriteTimeout = 8000;
            req.UserAgent = "ZenaaStation/" + App.Version;
            if (!string.IsNullOrEmpty(token)) req.Headers["Authorization"] = "Bearer " + token;
            if (body != null)
            {
                var bytes = Encoding.UTF8.GetBytes(Json.Serialize(body));
                req.ContentType = "application/json";
                req.ContentLength = bytes.Length;
                using (var s = req.GetRequestStream()) s.Write(bytes, 0, bytes.Length);
            }
            HttpWebResponse res;
            try { res = (HttpWebResponse)req.GetResponse(); }
            catch (WebException e)
            {
                res = e.Response as HttpWebResponse;
                if (res == null) throw;
            }
            using (res)
            {
                status = (int)res.StatusCode;
                using (var r = new StreamReader(res.GetResponseStream(), Encoding.UTF8))
                {
                    var text = r.ReadToEnd();
                    try { return Json.Deserialize<Dictionary<string, object>>(text); }
                    catch { return new Dictionary<string, object>(); }
                }
            }
        }

        public static string Str(Dictionary<string, object> d, string k)
        {
            object v;
            return d != null && d.TryGetValue(k, out v) && v != null ? Convert.ToString(v) : "";
        }

        public static bool Bool(Dictionary<string, object> d, string k)
        {
            object v;
            return d != null && d.TryGetValue(k, out v) && v is bool && (bool)v;
        }

        public static int? Int(Dictionary<string, object> d, string k)
        {
            object v;
            if (d == null || !d.TryGetValue(k, out v) || v == null) return null;
            try { return Convert.ToInt32(v); } catch { return null; }
        }

        public static Dictionary<string, object> Obj(Dictionary<string, object> d, string k)
        {
            object v;
            return d != null && d.TryGetValue(k, out v) ? v as Dictionary<string, object> : null;
        }
    }

    // ───────────────────────── Pairing ─────────────────────────

    class PairForm : Form
    {
        readonly Config cfg;
        readonly TextBox server = new TextBox();
        readonly TextBox code = new TextBox();
        readonly Label error = new Label();
        readonly Button ok = new Button();

        public PairForm(Config cfg)
        {
            this.cfg = cfg;
            Text = "ZENAA Station — pair this PC";
            FormBorderStyle = FormBorderStyle.FixedDialog;
            MaximizeBox = false;
            StartPosition = FormStartPosition.CenterScreen;
            ClientSize = new Size(440, 300);
            BackColor = Color.FromArgb(18, 21, 28);
            ForeColor = Color.White;
            Font = new Font("Segoe UI", 10f);

            var title = new Label { Text = "Pair with a ZENAA station", Font = new Font("Segoe UI Semibold", 15f), AutoSize = true, Location = new Point(20, 18) };
            var help = new Label
            {
                Text = "In ZENAA open Stations → ✏️ (edit) → Station screen → Pair a screen.\nType the server address and the 6-digit code shown there.",
                AutoSize = false, Size = new Size(400, 44), Location = new Point(22, 56), ForeColor = Color.FromArgb(160, 170, 190)
            };
            var l1 = new Label { Text = "Server address", AutoSize = true, Location = new Point(22, 108) };
            server.Location = new Point(22, 130); server.Width = 396;
            server.Text = string.IsNullOrEmpty(cfg.Server) ? "http://192.168.1.10:8080" : cfg.Server;
            var l2 = new Label { Text = "Pairing code", AutoSize = true, Location = new Point(22, 164) };
            code.Location = new Point(22, 186); code.Width = 160; code.MaxLength = 6;
            code.Font = new Font("Consolas", 18f, FontStyle.Bold);
            error.Location = new Point(22, 228); error.Size = new Size(396, 22); error.ForeColor = Color.FromArgb(255, 120, 120);
            ok.Text = "Pair"; ok.Location = new Point(318, 252); ok.Size = new Size(100, 34);
            ok.BackColor = Color.FromArgb(124, 92, 255); ok.FlatStyle = FlatStyle.Flat; ok.FlatAppearance.BorderSize = 0;
            ok.Click += delegate { DoPair(); };
            AcceptButton = ok;
            Controls.AddRange(new Control[] { title, help, l1, server, l2, code, error, ok });
        }

        void DoPair()
        {
            var url = server.Text.Trim().TrimEnd('/');
            if (!url.StartsWith("http://") && !url.StartsWith("https://")) url = "http://" + url;
            if (code.Text.Trim().Length != 6) { error.Text = "Enter the 6-digit code."; return; }
            ok.Enabled = false; error.Text = "Pairing…";
            try
            {
                int status;
                var r = Api.Call("POST", url + "/api/agent/pair", null,
                    new Dictionary<string, object> { { "code", code.Text.Trim() }, { "kind", "pc" }, { "name", Environment.MachineName }, { "version", App.Version } }, out status);
                if (status != 200) { error.Text = Api.Str(r, "message"); if (error.Text == "") error.Text = "Server answered " + status; ok.Enabled = true; return; }
                cfg.Server = url;
                cfg.Token = Api.Str(r, "token");
                var st = Api.Obj(r, "station");
                cfg.StationName = Api.Str(st, "code") + " · " + Api.Str(st, "name");
                cfg.Save();
                App.SetAutostart(true);
                DialogResult = DialogResult.OK;
                Close();
            }
            catch (Exception e)
            {
                error.Text = "Cannot reach the server: " + e.Message;
                ok.Enabled = true;
            }
        }
    }

    // ───────────────────────── Controller ─────────────────────────

    class State
    {
        public string Phase = "idle";
        public bool Lock = true;
        public string LockTitle = "Time is up";
        public string LockText = "Please see the counter to play.";
        public string Center = "ZENAA GAMEHUB";
        public string Station = "";
        public int? Remaining;
        public int Elapsed;
        public string Player = "";
        public string MessageId = "";
        public string MessageText = "";
        public string ExitPinHash = "";
        public string StationCode = "";
        public string Style = "island";
        public int? TempC;
        public string WeatherIcon = "";
        public string WeatherLabel = "";
        /// <summary>Island size chosen in Settings (0.4–1.0 of the full design).</summary>
        public float Scale = 0.7f;
        /// <summary>Staff unlock (no charge): seconds left, when the station was turned on without a session.</summary>
        public int? BypassRemaining;
        public DateTime FetchedAt = DateTime.UtcNow;
    }

    class Controller : ApplicationContext
    {
        readonly Config cfg;
        readonly DockForm dock;
        readonly IslandForm island;
        readonly List<LockForm> locks = new List<LockForm>();
        readonly System.Windows.Forms.Timer timer = new System.Windows.Forms.Timer();
        readonly NotifyIcon tray = new NotifyIcon();
        State state = new State();
        bool fetching;
        DateTime lastOk = DateTime.UtcNow;
        DateTime unlockedUntil = DateTime.MinValue;
        string seenMessage = null;
        string lastPhase = "";
        KeyboardBlocker blocker;
        bool staffOpen;
        readonly System.Windows.Forms.Timer zTimer = new System.Windows.Forms.Timer();

        public Controller(Config cfg)
        {
            this.cfg = cfg;
            state.Station = cfg.StationName;
            dock = new DockForm(cfg);
            dock.Show();
            island = new IslandForm();
            foreach (var screen in Screen.AllScreens) locks.Add(new LockForm(screen));
            tray.Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath);
            tray.Text = "ZENAA Station";
            tray.Visible = true;
            tray.ContextMenu = new ContextMenu(new[] { new MenuItem("Staff menu (PIN)…", delegate { StaffMenu(); }) });
            HotKey.Register(dock.Handle, delegate { StaffMenu(); });
            timer.Interval = 1000;
            timer.Tick += delegate { Tick(); };
            timer.Start();
            // Games often push themselves to the top: put the timer back on top 4 times a second (never takes focus).
            zTimer.Interval = 250;
            zTimer.Tick += delegate
            {
                if (island.Visible) Z.Top(island);
                if (dock.Visible) Z.Top(dock);
                Toast.KeepOnTop();
            };
            zTimer.Start();
            Tick();
        }

        int tickCount;
        void Tick()
        {
            if (tickCount++ % 3 == 0 && !fetching) Fetch();
            Render();
        }

        void Fetch()
        {
            fetching = true;
            ThreadPool.QueueUserWorkItem(delegate
            {
                State s = null; int status = 0; string err = null;
                try
                {
                    var r = Api.Call("GET", cfg.Server + "/api/agent/state?v=" + App.Version, cfg.Token, null, out status);
                    if (status == 200) s = Parse(r);
                    else err = Api.Str(r, "message");
                }
                catch (Exception e) { err = e.Message; }
                dock.BeginInvoke((MethodInvoker)delegate
                {
                    fetching = false;
                    if (status == 401)
                    {
                        timer.Stop();
                        HideLocks();
                        cfg.Token = ""; cfg.Save();
                        MessageBox.Show("This PC was unpaired from ZENAA. Pair it again.", "ZENAA Station");
                        using (var p = new PairForm(cfg)) { if (p.ShowDialog() != DialogResult.OK) { ExitThread(); return; } }
                        timer.Start();
                        return;
                    }
                    if (s != null) { state = s; lastOk = DateTime.UtcNow; dock.Offline = false; island.Offline = false; }
                    else island.Offline = dock.Offline = (DateTime.UtcNow - lastOk).TotalSeconds > 20;
                });
            });
        }

        static State Parse(Dictionary<string, object> r)
        {
            var s = new State();
            s.Phase = Api.Str(r, "phase");
            s.Lock = Api.Bool(r, "lock");
            s.LockTitle = Api.Str(r, "lockTitle");
            s.LockText = Api.Str(r, "lockText");
            s.Center = Api.Str(r, "centerName");
            var st = Api.Obj(r, "station");
            s.Station = Api.Str(st, "code") + " · " + Api.Str(st, "name");
            s.StationCode = Api.Str(st, "code");
            var dk = Api.Obj(r, "dock");
            if (dk != null)
            {
                s.Style = Api.Str(dk, "style") == "corner" ? "corner" : "island";
                var sc = Api.Int(dk, "scale");
                if (sc.HasValue) s.Scale = Math.Max(0.4f, Math.Min(1f, sc.Value / 100f));
                var w = Api.Obj(dk, "weather");
                if (w != null) { s.TempC = Api.Int(w, "tempC"); s.WeatherIcon = Api.Str(w, "icon"); s.WeatherLabel = Api.Str(w, "label"); }
            }
            var se = Api.Obj(r, "session");
            if (se != null)
            {
                s.Remaining = Api.Int(se, "remainingSeconds");
                s.Elapsed = Api.Int(se, "elapsedSeconds") ?? 0;
                s.Player = Api.Str(se, "playerName");
            }
            var m = Api.Obj(r, "message");
            if (m != null) { s.MessageId = Api.Str(m, "id"); s.MessageText = Api.Str(m, "text"); }
            s.ExitPinHash = Api.Str(r, "exitPinHash");
            var bp = Api.Obj(r, "bypass");
            if (bp != null) s.BypassRemaining = Api.Int(bp, "remainingSeconds");
            s.FetchedAt = DateTime.UtcNow;
            return s;
        }

        void Render()
        {
            var since = (int)(DateTime.UtcNow - state.FetchedAt).TotalSeconds;
            int? remaining = state.Remaining.HasValue ? (int?)Math.Max(0, state.Remaining.Value - (state.Phase == "paused" ? 0 : since)) : null;
            bool running = state.Phase == "running" || state.Phase == "warning";
            // Offline safety: a prepaid session that ran out while the network was down still locks.
            bool expiredLocally = running && remaining.HasValue && remaining.Value <= 0;
            bool locked = (state.Lock || expiredLocally) && DateTime.UtcNow > unlockedUntil;

            int shown = running ? state.Elapsed + since : state.Elapsed;
            bool useIsland = state.Style != "corner";
            if (useIsland)
            {
                if (dock.Visible) dock.Hide();
                island.SetState(state, remaining, shown);
                if (locked) { if (island.Visible) island.Hide(); }
                else if (!island.Visible) island.Show();
            }
            else
            {
                if (island.Visible) island.Hide();
                if (!dock.Visible) dock.Show();
                dock.Show(state, remaining, shown);
            }

            if (running && lastPhase != "" && lastPhase != "running" && lastPhase != "warning")
            {
                string who = string.IsNullOrEmpty(state.Player) ? "Game on!" : "Game on, " + state.Player + "!";
                Alert(who, remaining.HasValue ? App.Clock(remaining.Value) + " to play. Enjoy!" : "Open session — pay at the end.", Color.FromArgb(34, 197, 94));
            }
            if (state.Phase == "warning" && lastPhase != "warning")
            {
                if (remaining.HasValue && remaining.Value <= 305) fiveShown = true;
                if (!remaining.HasValue || remaining.Value > 10) Sound.Chime();
                Alert("Time is almost up", (remaining.HasValue ? App.Clock(remaining.Value) + " left. " : "") + "Top up at the counter to keep playing.", Color.FromArgb(245, 158, 11));
            }
            if (running && remaining.HasValue && remaining.Value <= 60 && remaining.Value > 0 && !lastMinuteShown)
            {
                lastMinuteShown = true;
                if (remaining.Value > 10) Sound.Chime();
                Alert("Last minute", "Save your game now. Top up at the counter to keep playing.", Color.FromArgb(239, 68, 68));
            }
            if (!running) lastMinuteShown = false;
            Countdown(running, remaining);
            lastPhase = state.Phase;

            if (!string.IsNullOrEmpty(state.MessageId) && state.MessageId != seenMessage)
            {
                if (seenMessage != null) Alert("Message from the counter", state.MessageText, Color.FromArgb(160, 140, 255));
                seenMessage = state.MessageId;
            }

            if (locked)
            {
                // While the staff PIN box is open the cover must not grab focus back, or typing goes nowhere.
                foreach (var l in locks) l.ShowLock(state.Center, expiredLocally ? "Time is up" : state.LockTitle, expiredLocally ? "Please see the counter to play again." : state.LockText, state.Station, !staffOpen);
                if (blocker == null && !staffOpen) blocker = new KeyboardBlocker();
            }
            else HideLocks();
        }

        bool lastMinuteShown;
        bool fiveShown;
        int? prevRemaining;

        /// <summary>
        /// 5 minutes left: island alert + chime. Last 10 seconds: a beep every second and the island counts down.
        /// Zero: alarm. Sounds play through the PC's speakers/headset, so players hear them even in full-screen games.
        /// </summary>
        void Countdown(bool running, int? remaining)
        {
            if (!running || !remaining.HasValue)
            {
                // The server may end the session a second early: still ring if we were in the last seconds.
                if (prevRemaining.HasValue && prevRemaining.Value <= 12 && (state.Lock || state.Phase == "idle")) Sound.Alarm();
                prevRemaining = null;
                if (!running) fiveShown = false;
                return;
            }
            int r = remaining.Value;
            if (prevRemaining.HasValue)
            {
                int p = prevRemaining.Value;
                if (!fiveShown && p > 300 && r <= 300 && r > 60)
                {
                    fiveShown = true;
                    Sound.Chime();
                    Alert("5 minutes left", App.Clock(r) + " left. Top up at the counter to keep playing.", Color.FromArgb(245, 158, 11));
                }
                if (r < p && r <= 10 && r > 0)
                {
                    Sound.Beep(r);
                    if (state.Style != "corner") island.Expand("Time is up in " + r + "…", "Save your game now. Top up at the counter to keep playing.", Color.FromArgb(239, 68, 68), 2);
                }
                if (p > 0 && r <= 0) Sound.Alarm();
            }
            if (r > 300) fiveShown = false; // topped up: warn again next time
            prevRemaining = r;
        }

        /// <summary>Island look: the island grows to show the alert. Corner look: a toast in the corner.</summary>
        void Alert(string title, string body, Color color)
        {
            if (state.Style != "corner") island.Expand(title, body, color, 10);
            else Toast.Show(title, body, color);
        }

        void HideLocks()
        {
            foreach (var l in locks) l.HideLock();
            if (blocker != null) { blocker.Dispose(); blocker = null; }
        }

        /// <summary>
        /// Checks a staff PIN with the server (each person's own PIN; needs "Turn on with no charge").
        /// Returns null when allowed, or the error to show. Offline: falls back to the shared exit PIN from Settings.
        /// </summary>
        string CheckPin(string pin, string action, out bool offline, out string name)
        {
            offline = false; name = "";
            try
            {
                int status;
                var body = new Dictionary<string, object> { { "pin", pin }, { "action", action == "unlock" || action == "lock" ? action : "exit" }, { "minutes", 30 } };
                var r = Api.Call("POST", cfg.Server + "/api/agent/unlock", cfg.Token, body, out status);
                if (status == 200) { name = Api.Str(r, "name"); return null; }
                if (status == 0 || status >= 500) throw new Exception("server");
                var msg = Api.Str(r, "message");
                return msg == "" ? "PIN not accepted" : msg;
            }
            catch
            {
                offline = true;
                if (string.IsNullOrEmpty(state.ExitPinHash)) return "Server unreachable and no offline exit PIN is set";
                return App.Sha256(pin) == state.ExitPinHash ? null : "Wrong PIN (offline)";
            }
        }

        void StaffMenu()
        {
            if (staffOpen) return; // already open
            staffOpen = true;
            if (blocker != null) { blocker.Dispose(); blocker = null; }
            DialogResult r;
            PinForm f = new PinForm(CheckPin, state.Phase == "staff", Z.ExclusiveFullscreen());
            try
            {
                foreach (var l in locks) l.TopMost = false;
                r = f.ShowDialog();
            }
            finally
            {
                staffOpen = false;
                foreach (var l in locks) if (l.Visible) l.TopMost = true;
            }
            using (f)
            {
                if (r != DialogResult.OK) return;
                if (f.Choice == "unlock")
                {
                    // Online: the server turned the station on (no charge) — the lock lifts on the next poll.
                    if (f.Offline) unlockedUntil = DateTime.UtcNow.AddMinutes(10);
                    Toast.Show("Unlocked — no charge", (f.StaffName != "" ? f.StaffName + " · " : "") + (f.Offline ? "10 minutes (offline)" : "30 minutes. Recorded in ZENAA."), Color.FromArgb(56, 189, 248));
                    Fetch();
                }
                else if (f.Choice == "lock") { unlockedUntil = DateTime.MinValue; Fetch(); }
                else if (f.Choice == "exit") { App.MarkStopped(); HideLocks(); tray.Visible = false; ExitThread(); Environment.Exit(0); }
                else if (f.Choice == "unpair")
                {
                    cfg.Token = ""; cfg.Save(); App.SetAutostart(false);
                    HideLocks(); tray.Visible = false; ExitThread(); Environment.Exit(0);
                }
                else if (f.Choice == "corner")
                {
                    var order = new[] { "top-right", "top-left", "bottom-left", "bottom-right" };
                    cfg.DockCorner = order[(Array.IndexOf(order, cfg.DockCorner) + 1) % order.Length];
                    cfg.Save(); dock.Place();
                }
            }
        }
    }

    // ───────────────────────── Timer dock ─────────────────────────

    class DockForm : Form
    {
        readonly Config cfg;
        public bool Offline;
        string top = "", big = "--:--", sub = "";
        Color accent = Color.FromArgb(124, 92, 255);

        public DockForm(Config cfg)
        {
            this.cfg = cfg;
            FormBorderStyle = FormBorderStyle.None;
            ShowInTaskbar = false;
            TopMost = true;
            StartPosition = FormStartPosition.Manual;
            Size = new Size(210, 92);
            BackColor = Color.FromArgb(14, 16, 22);
            Opacity = 0.93;
            DoubleBuffered = true;
            Place();
            var drag = false; Point start = Point.Empty;
            MouseDown += (s, e) => { drag = true; start = e.Location; };
            MouseUp += (s, e) => { drag = false; };
            MouseMove += (s, e) => { if (drag) Location = new Point(Location.X + e.X - start.X, Location.Y + e.Y - start.Y); };
        }

        protected override CreateParams CreateParams
        {
            get { var cp = base.CreateParams; cp.ExStyle |= 0x80 /* WS_EX_TOOLWINDOW */ | 0x08000000 /* WS_EX_NOACTIVATE */; return cp; }
        }

        protected override bool ShowWithoutActivation { get { return true; } }

        public void Place()
        {
            var wa = Screen.PrimaryScreen.WorkingArea;
            int x = cfg.DockCorner.EndsWith("left") ? wa.Left + 12 : wa.Right - Width - 12;
            int y = cfg.DockCorner.StartsWith("bottom") ? wa.Bottom - Height - 12 : wa.Top + 12;
            Location = new Point(x, y);
        }

        public void Show(State s, int? remaining, int elapsed)
        {
            top = s.Station + (Offline ? "  · offline" : "");
            if (s.Phase == "running" || s.Phase == "warning")
            {
                big = remaining.HasValue ? App.Clock(remaining.Value) : App.Clock(elapsed);
                sub = (remaining.HasValue ? "remaining" : "playing") + (string.IsNullOrEmpty(s.Player) ? "" : " · " + s.Player);
                accent = s.Phase == "warning" ? (DateTime.Now.Second % 2 == 0 ? Color.FromArgb(245, 158, 11) : Color.FromArgb(239, 68, 68)) : Color.FromArgb(34, 197, 94);
            }
            else if (s.Phase == "paused") { big = "PAUSED"; sub = "see the counter"; accent = Color.FromArgb(245, 158, 11); }
            else if (s.Phase == "maintenance") { big = "—"; sub = "maintenance"; accent = Color.FromArgb(56, 189, 248); }
            else if (s.Phase == "staff") { big = "STAFF"; sub = "unlocked · no charge"; accent = Color.FromArgb(56, 189, 248); }
            else { big = "FREE"; sub = "see the counter to play"; accent = Color.FromArgb(124, 92, 255); }
            TopMost = true;
            Invalidate();
        }

        protected override void OnPaint(PaintEventArgs e)
        {
            var g = e.Graphics;
            g.SmoothingMode = SmoothingMode.AntiAlias;
            g.TextRenderingHint = System.Drawing.Text.TextRenderingHint.ClearTypeGridFit;
            using (var b = new SolidBrush(accent)) g.FillRectangle(b, 0, 0, 5, Height);
            using (var f = new Font("Segoe UI", 8.5f)) using (var b = new SolidBrush(Color.FromArgb(150, 160, 180))) g.DrawString(top, f, b, 14, 6);
            using (var f = new Font("Consolas", 24f, FontStyle.Bold)) using (var b = new SolidBrush(Color.White)) g.DrawString(big, f, b, 10, 22);
            using (var f = new Font("Segoe UI", 8.5f)) using (var b = new SolidBrush(accent)) g.DrawString(sub, f, b, 14, 66);
        }
    }

    // ───────────────────────── Island (top-centre pill) ─────────────────────────
    //
    // A black pill at the top centre of the main screen, like a phone's dynamic island:
    //   [ progress ring · PS-01 ]   45:12   [ ☀ 31° ]
    // It grows for a few seconds to show alerts ("5 minutes left", staff messages) and then shrinks back.
    // Drawn with per-pixel alpha (smooth corners) and click-through, so it never steals mouse clicks from games.

    class IslandForm : Form
    {
        public bool Offline;
        float s;
        int maxW, maxH;
        readonly float screenScale;
        float userScale = 0.7f;
        string station = "", time = "--:--", right = "", rightIcon = "";
        Color accent = Color.FromArgb(124, 92, 255), timeColor = Color.White;
        float progress = -1f;
        string exTitle = "", exBody = "";
        Color exColor = Color.White;
        DateTime expandUntil = DateTime.MinValue;
        float curW, curH;
        bool dirty = true;
        readonly System.Windows.Forms.Timer anim = new System.Windows.Forms.Timer();

        const float CompactW = 300, CompactH = 44, WideW = 460, WideH = 112;

        public IslandForm()
        {
            FormBorderStyle = FormBorderStyle.None;
            ShowInTaskbar = false;
            TopMost = true;
            StartPosition = FormStartPosition.Manual;
            // Scale with the screen (1080p = 1x, 4K unscaled = 2x) times the size chosen in Settings.
            screenScale = Math.Max(1f, Math.Min(2f, Screen.PrimaryScreen.Bounds.Height / 1080f));
            ApplyScale(0.7f);
            anim.Interval = 16;
            anim.Tick += delegate { Step(); };
            anim.Start();
        }

        protected override CreateParams CreateParams
        {
            get
            {
                var cp = base.CreateParams;
                // LAYERED | TOOLWINDOW | NOACTIVATE | TRANSPARENT (click-through) | TOPMOST
                cp.ExStyle |= 0x80000 | 0x80 | 0x08000000 | 0x20 | 0x8;
                return cp;
            }
        }

        protected override bool ShowWithoutActivation { get { return true; } }

        /// <summary>Settings → Island size (0.4–1.0). Same design, smaller pill.</summary>
        public void ApplyScale(float user)
        {
            userScale = user;
            s = screenScale * user;
            maxW = (int)(WideW * s) + 4;
            maxH = (int)(WideH * s) + 4;
            curW = CompactW * s;
            curH = CompactH * s;
            var wa = Screen.PrimaryScreen.Bounds;
            Bounds = new Rectangle(wa.Left + (wa.Width - maxW) / 2, wa.Top + (int)(8 * s), maxW, maxH);
            dirty = true;
        }

        /// <summary>Grow the island for a few seconds with a title and a line of text.</summary>
        public void Expand(string title, string body, Color color, int seconds)
        {
            exTitle = title ?? "";
            exBody = body ?? "";
            exColor = color;
            expandUntil = DateTime.UtcNow.AddSeconds(seconds);
            dirty = true;
        }

        public void SetState(State st, int? remaining, int elapsed)
        {
            if (Math.Abs(st.Scale - userScale) > 0.01f) ApplyScale(st.Scale);
            station = st.StationCode;
            bool blinkOn = DateTime.Now.Second % 2 == 0;
            progress = -1f;
            timeColor = Color.White;
            if (st.Phase == "running" || st.Phase == "warning")
            {
                time = remaining.HasValue ? App.Clock(remaining.Value) : App.Clock(elapsed);
                bool warn = st.Phase == "warning" || (remaining.HasValue && remaining.Value <= 300);
                accent = warn ? Color.FromArgb(245, 158, 11) : Color.FromArgb(34, 197, 94);
                if (warn && remaining.HasValue && remaining.Value <= 60) accent = Color.FromArgb(239, 68, 68);
                if (warn) timeColor = blinkOn ? accent : Color.White;
                if (remaining.HasValue && st.Remaining.HasValue)
                {
                    int total = st.Elapsed + st.Remaining.Value;
                    progress = total > 0 ? Math.Max(0f, Math.Min(1f, remaining.Value / (float)total)) : 0f;
                }
                else progress = 1f;
            }
            else if (st.Phase == "paused") { time = "PAUSED"; accent = Color.FromArgb(245, 158, 11); timeColor = accent; }
            else if (st.Phase == "maintenance") { time = "Maintenance"; accent = Color.FromArgb(56, 189, 248); }
            else if (st.Phase == "staff")
            {
                int left = st.BypassRemaining.HasValue ? Math.Max(0, st.BypassRemaining.Value - (int)(DateTime.UtcNow - st.FetchedAt).TotalSeconds) : 0;
                time = left > 0 && left < 11 * 3600 ? "FREE " + App.Clock(left) : "STAFF";
                accent = Color.FromArgb(56, 189, 248); timeColor = accent;
            }
            else { time = "Ready"; accent = Color.FromArgb(124, 92, 255); }

            if (Offline) { rightIcon = "●"; right = "offline"; }
            else if (st.TempC.HasValue) { rightIcon = WeatherGlyph(st.WeatherIcon); right = st.TempC.Value + "°"; }
            else { rightIcon = ""; right = DateTime.Now.ToString("HH:mm"); }
            dirty = true;
        }

        static string WeatherGlyph(string icon)
        {
            switch (icon)
            {
                case "sun": return "☀";
                case "moon": return "☾";
                case "partly": return "⛅";
                case "rain": return "☂";
                case "storm": return "⚡";
                case "snow": return "❄";
                case "fog": return "≈";
                default: return "☁";
            }
        }

        void Step()
        {
            bool expanded = DateTime.UtcNow < expandUntil;
            float tw = (expanded ? WideW : CompactW) * s, th = (expanded ? WideH : CompactH) * s;
            if (Math.Abs(tw - curW) > 0.5f || Math.Abs(th - curH) > 0.5f)
            {
                // Spring-ish ease towards the target size.
                curW += (tw - curW) * 0.22f;
                curH += (th - curH) * 0.22f;
                dirty = true;
            }
            if (!dirty || !Visible) return;
            dirty = false;
            Redraw();
        }

        static GraphicsPath Rounded(RectangleF r, float rad)
        {
            var p = new GraphicsPath();
            float d = rad * 2;
            p.AddArc(r.X, r.Y, d, d, 180, 90);
            p.AddArc(r.Right - d, r.Y, d, d, 270, 90);
            p.AddArc(r.Right - d, r.Bottom - d, d, d, 0, 90);
            p.AddArc(r.X, r.Bottom - d, d, d, 90, 90);
            p.CloseFigure();
            return p;
        }

        void Redraw()
        {
            using (var bmp = Render()) Layered.Push(this, bmp);
        }

        Bitmap Render()
        {
            var bmp = new Bitmap(maxW, maxH, System.Drawing.Imaging.PixelFormat.Format32bppArgb);
            {
                using (var g = Graphics.FromImage(bmp))
                {
                    g.SmoothingMode = SmoothingMode.AntiAlias;
                    g.TextRenderingHint = System.Drawing.Text.TextRenderingHint.AntiAliasGridFit;
                    g.Clear(Color.Transparent);
                    var pill = new RectangleF((maxW - curW) / 2f, 1, curW, curH);
                    float rad = Math.Min(curH / 2f, 30 * s);
                    using (var path = Rounded(pill, rad))
                    {
                        using (var b = new SolidBrush(Color.FromArgb(250, 0, 0, 0))) g.FillPath(b, path);
                        using (var pen = new Pen(Color.FromArgb(70, accent), 1.2f * s)) g.DrawPath(pen, path);
                        g.SetClip(path);
                        DrawRow(g, pill);
                        float t = (curH - CompactH * s) / ((WideH - CompactH) * s); // 0..1 expansion
                        if (t > 0.35f) DrawExpanded(g, pill, Math.Min(1f, (t - 0.35f) / 0.65f));
                        g.ResetClip();
                    }
                }
            }
            return bmp;
        }

        /// <summary>ZenaaStation.exe --preview <folder>: saves PNGs of the island states (no windows, no pairing).</summary>
        public static void Preview(string dir)
        {
            Directory.CreateDirectory(dir);
            var f = new IslandForm();
            var st = new State { Phase = "running", StationCode = "PS-01", Remaining = 2712, Elapsed = 888, Player = "Ama", TempC = 31, WeatherIcon = "sun" };
            Action<string, bool> save = (name, wide) =>
            {
                f.curW = (wide ? WideW : CompactW) * f.s;
                f.curH = (wide ? WideH : CompactH) * f.s;
                using (var bmp = f.Render())
                using (var bg = new Bitmap(bmp.Width + 40, bmp.Height + 30))
                using (var g = Graphics.FromImage(bg))
                {
                    g.Clear(Color.FromArgb(40, 90, 60)); // stand-in for a game picture
                    g.DrawImage(bmp, 20, 15);
                    bg.Save(Path.Combine(dir, name + ".png"), System.Drawing.Imaging.ImageFormat.Png);
                }
            };
            f.SetState(st, 2712, 888); save("1-running", false);
            st.Phase = "warning"; st.Remaining = 245; f.SetState(st, 245, 3355); save("2-warning", false);
            f.Expand("Time is almost up", "04:05 left. Top up at the counter to keep playing.", Color.FromArgb(245, 158, 11), 10); save("3-alert", true);
            f.Expand("Message from the counter", "Your friend is waiting at the counter.", Color.FromArgb(160, 140, 255), 10); save("4-message", true);
            st.Phase = "running"; st.Remaining = null; st.Elapsed = 4021; st.TempC = 24; st.WeatherIcon = "rain"; f.SetState(st, null, 4021); save("5-open-session", false);
            st.Phase = "paused"; f.SetState(st, null, 4021); save("6-paused", false);
            st.Phase = "idle"; st.TempC = null; f.SetState(st, null, 0); save("7-ready-no-weather", false);
            st.Phase = "staff"; st.BypassRemaining = 1500; st.FetchedAt = DateTime.UtcNow; st.TempC = 29; st.WeatherIcon = "partly"; f.SetState(st, null, 0); save("8-staff-unlock", false);
            st.Phase = "running"; st.Remaining = 2712; st.Elapsed = 888; st.Scale = 1f; f.SetState(st, 2712, 888); save("9-running-size-100", false);
            st.Scale = 0.7f; st.Remaining = 300; f.SetState(st, 300, 3300);
            f.Expand("5 minutes left", "05:00 left. Top up at the counter to keep playing.", Color.FromArgb(245, 158, 11), 10); save("10-five-minutes", true);
            st.Remaining = 7; f.SetState(st, 7, 3593);
            f.Expand("Time is up in 7…", "Save your game now. Top up at the counter to keep playing.", Color.FromArgb(239, 68, 68), 2); save("11-last-seconds", true);
        }

        void DrawRow(Graphics g, RectangleF pill)
        {
            float rowH = CompactH * s, cy = pill.Y + rowH / 2f;
            // Left: progress ring + station code
            float ring = 22 * s, rx = pill.X + 13 * s, ry = cy - ring / 2f;
            using (var bg = new Pen(Color.FromArgb(60, 255, 255, 255), 3 * s)) g.DrawEllipse(bg, rx, ry, ring, ring);
            if (progress >= 0)
                using (var fg = new Pen(accent, 3 * s) { StartCap = LineCap.Round, EndCap = LineCap.Round })
                    if (progress > 0.004f) g.DrawArc(fg, rx, ry, ring, ring, -90, 360f * progress);
            using (var dot = new SolidBrush(accent)) g.FillEllipse(dot, rx + ring / 2f - 3 * s, ry + ring / 2f - 3 * s, 6 * s, 6 * s);
            using (var f = new Font("Segoe UI Semibold", 10f * s, GraphicsUnit.Pixel))
            using (var b = new SolidBrush(Color.FromArgb(160, 170, 185)))
            {
                var sz = g.MeasureString(station, f);
                g.DrawString(station, f, b, rx + ring + 7 * s, cy - sz.Height / 2f);
            }
            // Centre: the time
            using (var f = new Font("Segoe UI", time.Length > 8 ? 17f * s : 21f * s, FontStyle.Bold, GraphicsUnit.Pixel))
            using (var b = new SolidBrush(timeColor))
            {
                var sz = g.MeasureString(time, f);
                g.DrawString(time, f, b, pill.X + (pill.Width - sz.Width) / 2f, cy - sz.Height / 2f);
            }
            // Right: weather / clock / offline
            using (var f = new Font("Segoe UI Semibold", 13f * s, GraphicsUnit.Pixel))
            using (var fi = new Font("Segoe UI Symbol", 14f * s, GraphicsUnit.Pixel))
            using (var b = new SolidBrush(Offline ? Color.FromArgb(239, 68, 68) : Color.FromArgb(225, 230, 240)))
            using (var bi = new SolidBrush(Offline ? Color.FromArgb(239, 68, 68) : Color.FromArgb(253, 186, 69)))
            {
                var sz = g.MeasureString(right, f);
                float x = pill.Right - 16 * s - sz.Width;
                g.DrawString(right, f, b, x, cy - sz.Height / 2f);
                if (rightIcon.Length > 0)
                {
                    var si = g.MeasureString(rightIcon, fi);
                    g.DrawString(rightIcon, fi, bi, x - si.Width + 2 * s, cy - si.Height / 2f);
                }
            }
        }

        void DrawExpanded(Graphics g, RectangleF pill, float alpha)
        {
            int a = (int)(255 * alpha);
            float x = pill.X + 22 * s, y = pill.Y + CompactH * s + 2 * s, w = pill.Width - 44 * s;
            using (var line = new Pen(Color.FromArgb(a / 4, 255, 255, 255), 1)) g.DrawLine(line, x, y - 3 * s, x + w, y - 3 * s);
            using (var f = new Font("Segoe UI", 15f * s, FontStyle.Bold, GraphicsUnit.Pixel))
            using (var b = new SolidBrush(Color.FromArgb(a, exColor)))
                g.DrawString(exTitle, f, b, new RectangleF(x, y + 2 * s, w, 22 * s), new StringFormat { Trimming = StringTrimming.EllipsisCharacter, FormatFlags = StringFormatFlags.NoWrap });
            using (var f = new Font("Segoe UI", 12.5f * s, GraphicsUnit.Pixel))
            using (var b = new SolidBrush(Color.FromArgb(a, 200, 205, 215)))
                g.DrawString(exBody, f, b, new RectangleF(x, y + 24 * s, w, 38 * s), new StringFormat { Trimming = StringTrimming.EllipsisWord });
        }
    }

    /// <summary>Pushes a 32-bit ARGB bitmap to a WS_EX_LAYERED window (per-pixel alpha).</summary>
    static class Layered
    {
        [StructLayout(LayoutKind.Sequential)] struct PT { public int x, y; }
        [StructLayout(LayoutKind.Sequential)] struct SZ { public int cx, cy; }
        [StructLayout(LayoutKind.Sequential, Pack = 1)] struct BLEND { public byte op, flags, alpha, fmt; }
        [DllImport("user32.dll")] static extern IntPtr GetDC(IntPtr h);
        [DllImport("user32.dll")] static extern int ReleaseDC(IntPtr h, IntPtr dc);
        [DllImport("gdi32.dll")] static extern IntPtr CreateCompatibleDC(IntPtr dc);
        [DllImport("gdi32.dll")] static extern bool DeleteDC(IntPtr dc);
        [DllImport("gdi32.dll")] static extern IntPtr SelectObject(IntPtr dc, IntPtr o);
        [DllImport("gdi32.dll")] static extern bool DeleteObject(IntPtr o);
        [DllImport("user32.dll")] static extern bool UpdateLayeredWindow(IntPtr h, IntPtr dst, ref PT pos, ref SZ size, IntPtr src, ref PT srcPos, int key, ref BLEND b, int flags);

        public static void Push(Form f, Bitmap bmp)
        {
            IntPtr screen = GetDC(IntPtr.Zero), mem = CreateCompatibleDC(screen), hb = IntPtr.Zero, old = IntPtr.Zero;
            try
            {
                hb = bmp.GetHbitmap(Color.FromArgb(0));
                old = SelectObject(mem, hb);
                var size = new SZ { cx = bmp.Width, cy = bmp.Height };
                var pos = new PT { x = f.Left, y = f.Top };
                var src = new PT();
                var blend = new BLEND { op = 0, flags = 0, alpha = 255, fmt = 1 /* AC_SRC_ALPHA */ };
                UpdateLayeredWindow(f.Handle, screen, ref pos, ref size, mem, ref src, 0, ref blend, 2 /* ULW_ALPHA */);
            }
            finally
            {
                ReleaseDC(IntPtr.Zero, screen);
                if (hb != IntPtr.Zero) { SelectObject(mem, old); DeleteObject(hb); }
                DeleteDC(mem);
            }
        }
    }

    // ───────────────────────── Full-screen lock ─────────────────────────

    class LockForm : Form
    {
        readonly Screen screen;
        string center = "", title = "", text = "", station = "";

        public LockForm(Screen screen)
        {
            this.screen = screen;
            FormBorderStyle = FormBorderStyle.None;
            ShowInTaskbar = false;
            StartPosition = FormStartPosition.Manual;
            Bounds = screen.Bounds;
            BackColor = Color.Black;
            DoubleBuffered = true;
            TopMost = true;
            KeyPreview = true;
        }

        protected override void OnFormClosing(FormClosingEventArgs e)
        {
            if (e.CloseReason == CloseReason.UserClosing) e.Cancel = true; // Alt+F4 does nothing
            base.OnFormClosing(e);
        }

        public void ShowLock(string center, string title, string text, string station, bool grabFocus)
        {
            bool changed = this.title != title || this.text != text || this.center != center;
            this.center = center; this.title = title; this.text = text; this.station = station;
            Bounds = screen.Bounds;
            if (!Visible) Show();
            if (grabFocus)
            {
                TopMost = true;
                if (screen.Primary && Form.ActiveForm != this) Z.Foreground(this);
            }
            if (changed || DateTime.Now.Second % 30 == 0) Invalidate();
            else Invalidate(new Rectangle(0, Height - 80, Width, 80));
        }

        public void HideLock() { if (Visible) Hide(); }

        protected override void OnPaint(PaintEventArgs e)
        {
            var g = e.Graphics;
            g.SmoothingMode = SmoothingMode.AntiAlias;
            g.TextRenderingHint = System.Drawing.Text.TextRenderingHint.AntiAliasGridFit;
            using (var bg = new LinearGradientBrush(ClientRectangle, Color.FromArgb(24, 14, 52), Color.Black, 90f)) g.FillRectangle(bg, ClientRectangle);
            var center = new StringFormat { Alignment = StringAlignment.Center, LineAlignment = StringAlignment.Center };
            int w = Width, h = Height;
            using (var f = new Font("Segoe UI", 16f, FontStyle.Bold)) using (var b = new SolidBrush(Color.FromArgb(160, 140, 255))) g.DrawString(this.center.ToUpperInvariant(), f, b, new RectangleF(0, h * 0.22f, w, 40), center);
            using (var f = new Font("Segoe UI", Math.Max(28f, h / 14f), FontStyle.Bold)) using (var b = new SolidBrush(Color.White)) g.DrawString(title, f, b, new RectangleF(0, h * 0.32f, w, h * 0.18f), center);
            using (var f = new Font("Segoe UI", Math.Max(14f, h / 40f))) using (var b = new SolidBrush(Color.FromArgb(190, 195, 210))) g.DrawString(text, f, b, new RectangleF(w * 0.1f, h * 0.52f, w * 0.8f, h * 0.12f), center);
            using (var f = new Font("Segoe UI", 12f)) using (var b = new SolidBrush(Color.FromArgb(110, 115, 130))) g.DrawString(station + "   ·   " + DateTime.Now.ToString("HH:mm"), f, b, new RectangleF(0, h - 70, w, 40), center);
        }
    }

    // ───────────────────────── Staff PIN ─────────────────────────

    delegate string PinCheck(string pin, string action, out bool offline, out string name);

    class PinForm : Form
    {
        public string Choice = "";
        public bool Offline;
        public string StaffName = "";
        readonly PinCheck check;
        readonly TextBox pin = new TextBox();
        readonly Label err = new Label();
        readonly System.Windows.Forms.Timer focusTimer = new System.Windows.Forms.Timer();
        int focusTries;

        public PinForm(PinCheck check, bool staffUnlocked, bool exclusiveFullscreen)
        {
            this.check = check;
            Text = "ZENAA Station — staff";
            FormBorderStyle = FormBorderStyle.FixedDialog;
            StartPosition = FormStartPosition.CenterScreen;
            TopMost = true;
            ShowInTaskbar = true;
            MaximizeBox = MinimizeBox = false;
            ClientSize = new Size(600, exclusiveFullscreen ? 330 : 270);
            Font = new Font("Segoe UI", 10f);
            KeyPreview = true;
            var l = new Label { Text = "Your staff PIN (or the offline exit PIN)", AutoSize = true, Location = new Point(18, 16) };
            pin.UseSystemPasswordChar = true; pin.Location = new Point(18, 40); pin.Width = 344; pin.MaxLength = 8;
            pin.Font = new Font("Segoe UI", 16f);
            // Digits only; Enter = the first button.
            pin.KeyPress += (sender, e) => { if (!char.IsDigit(e.KeyChar) && !char.IsControl(e.KeyChar)) e.Handled = true; };
            pin.TextChanged += delegate { if (err.Text != "") err.Text = ""; };
            err.Location = new Point(18, 84); err.Size = new Size(344, 22); err.ForeColor = Color.Firebrick;
            var b1 = Btn(staffUnlocked ? "Lock again" : "Unlock (free 30 min)", 18, 110, staffUnlocked ? "lock" : "unlock");
            var b2 = Btn("Move timer", 196, 110, "corner");
            var b3 = Btn("Exit app", 18, 156, "exit");
            var b4 = Btn("Unpair this PC", 196, 156, "unpair");
            var hint = new Label { Text = "Unlocking turns the station on with no charge and is recorded with your name.", Location = new Point(18, 204), Size = new Size(344, 44), ForeColor = Color.DimGray };
            Controls.AddRange(new Control[] { l, pin, err, b1, b2, b3, b4, hint });
            if (exclusiveFullscreen)
            {
                var fs = new Label
                {
                    Text = "The game is in exclusive full screen, so the timer can't show over it (sounds still play). In the game's display settings choose \"Borderless\" or \"Windowed full screen\".",
                    Location = new Point(18, 256), Size = new Size(564, 60), ForeColor = Color.DarkOrange,
                };
                Controls.Add(fs);
            }
            // On-screen keypad (mouse or touch) in case the keyboard is busy with the game.
            string[] keys = { "1", "2", "3", "4", "5", "6", "7", "8", "9", "Clear", "0", "⌫" };
            for (int i = 0; i < keys.Length; i++)
            {
                string k = keys[i];
                var kb = new Button { Text = k, Location = new Point(384 + (i % 3) * 70, 16 + (i / 3) * 56), Size = new Size(64, 50), TabStop = false };
                kb.Font = new Font("Segoe UI", k.Length == 1 ? 14f : 10f, FontStyle.Bold);
                kb.Click += delegate
                {
                    if (k == "Clear") pin.Text = "";
                    else if (k == "⌫") { if (pin.Text.Length > 0) pin.Text = pin.Text.Substring(0, pin.Text.Length - 1); }
                    else if (pin.Text.Length < pin.MaxLength) pin.Text += k;
                    pin.Focus(); pin.SelectionStart = pin.Text.Length;
                };
                Controls.Add(kb);
            }
            AcceptButton = b1;
            CancelButton = null;
            // Windows doesn't always let a background app take the keyboard from a game: keep asking for a moment.
            focusTimer.Interval = 200;
            focusTimer.Tick += delegate
            {
                if (++focusTries > 10 || (ContainsFocus && pin.Focused)) { focusTimer.Stop(); return; }
                Z.Foreground(this); pin.Focus();
            };
        }

        protected override void OnShown(EventArgs e)
        {
            base.OnShown(e);
            Z.Foreground(this);
            pin.Focus();
            focusTimer.Start();
        }

        protected override void OnKeyDown(KeyEventArgs e)
        {
            if (e.KeyCode == Keys.Escape) { DialogResult = DialogResult.Cancel; Close(); return; }
            base.OnKeyDown(e);
        }

        protected override void Dispose(bool disposing)
        {
            if (disposing) focusTimer.Dispose();
            base.Dispose(disposing);
        }

        Button Btn(string text, int x, int y, string choice)
        {
            var b = new Button { Text = text, Location = new Point(x, y), Size = new Size(166, 38) };
            b.Click += delegate
            {
                if (pin.Text.Length < 4) { err.Text = "Type your PIN (4–8 digits)"; pin.Focus(); return; }
                Cursor = Cursors.WaitCursor;
                err.ForeColor = Color.DimGray; err.Text = "Checking…"; err.Refresh();
                bool offline; string name;
                var problem = check(pin.Text, choice, out offline, out name);
                Cursor = Cursors.Default;
                err.ForeColor = Color.Firebrick;
                if (problem != null) { err.Text = problem; pin.SelectAll(); pin.Focus(); return; }
                err.Text = "";
                Offline = offline; StaffName = name;
                Choice = choice; DialogResult = DialogResult.OK; Close();
            };
            return b;
        }
    }

    // ───────────────────────── Toast ─────────────────────────

    class Toast : Form
    {
        static Toast current;
        readonly string title, body;
        readonly Color accent;

        Toast(string title, string body, Color accent)
        {
            this.title = title; this.body = body; this.accent = accent;
            FormBorderStyle = FormBorderStyle.None; ShowInTaskbar = false; TopMost = true;
            StartPosition = FormStartPosition.Manual; Size = new Size(380, 96);
            BackColor = Color.FromArgb(20, 22, 30); DoubleBuffered = true;
            var wa = Screen.PrimaryScreen.WorkingArea;
            Location = new Point(wa.Right - Width - 16, wa.Bottom - Height - 16);
            var t = new System.Windows.Forms.Timer { Interval = 15000 };
            t.Tick += delegate { t.Stop(); Close(); };
            t.Start();
            Click += delegate { Close(); };
        }

        protected override bool ShowWithoutActivation { get { return true; } }

        protected override CreateParams CreateParams
        {
            get { var cp = base.CreateParams; cp.ExStyle |= 0x80 /* TOOLWINDOW */ | 0x08000000 /* NOACTIVATE */ | 0x8 /* TOPMOST */; return cp; }
        }

        public static void KeepOnTop() { if (current != null && !current.IsDisposed && current.Visible) Z.Top(current); }

        public static void Show(string title, string body, Color accent)
        {
            if (current != null && !current.IsDisposed) current.Close();
            current = new Toast(title, body, accent);
            current.Show();
        }

        protected override void OnPaint(PaintEventArgs e)
        {
            var g = e.Graphics;
            g.TextRenderingHint = System.Drawing.Text.TextRenderingHint.ClearTypeGridFit;
            using (var b = new SolidBrush(accent)) g.FillRectangle(b, 0, 0, 6, Height);
            using (var f = new Font("Segoe UI Semibold", 12f)) g.DrawString(title, f, Brushes.White, 18, 12);
            using (var f = new Font("Segoe UI", 10f)) using (var b = new SolidBrush(Color.FromArgb(190, 195, 210))) g.DrawString(body, f, b, new RectangleF(18, 40, Width - 30, Height - 44));
        }
    }

    // ───────────────────────── Z-order, focus, full-screen detection ─────────────────────────

    static class Z
    {
        [DllImport("user32.dll")] static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int cx, int cy, uint flags);
        [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
        [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, IntPtr pid);
        [DllImport("kernel32.dll")] static extern uint GetCurrentThreadId();
        [DllImport("user32.dll")] static extern bool AttachThreadInput(uint a, uint b, bool attach);
        [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr h);
        [DllImport("user32.dll")] static extern bool BringWindowToTop(IntPtr h);
        [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr h, int cmd);
        [DllImport("user32.dll")] static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);
        [DllImport("shell32.dll")] static extern int SHQueryUserNotificationState(out int state);

        static readonly IntPtr TOPMOST = new IntPtr(-1);

        /// <summary>Put a window at the very top of the "always on top" group without taking focus.</summary>
        public static void Top(Form f)
        {
            if (f == null || f.IsDisposed || !f.IsHandleCreated) return;
            SetWindowPos(f.Handle, TOPMOST, 0, 0, 0, 0, 0x0001 /* NOSIZE */ | 0x0002 /* NOMOVE */ | 0x0010 /* NOACTIVATE */ | 0x0200 /* NOOWNERZORDER */);
        }

        /// <summary>Really bring a window to the front with keyboard focus, even when a game owns the foreground.</summary>
        public static void Foreground(Form f)
        {
            if (f == null || f.IsDisposed || !f.IsHandleCreated) return;
            try
            {
                IntPtr fg = GetForegroundWindow();
                if (fg == f.Handle) return;
                uint fgThread = GetWindowThreadProcessId(fg, IntPtr.Zero), me = GetCurrentThreadId();
                // A tap of Alt tells Windows the user is switching windows, which lifts the foreground lock.
                keybd_event(0x12, 0, 0, UIntPtr.Zero);
                keybd_event(0x12, 0, 2 /* KEYUP */, UIntPtr.Zero);
                bool attached = fgThread != 0 && fgThread != me && AttachThreadInput(me, fgThread, true);
                ShowWindow(f.Handle, 5 /* SW_SHOW */);
                BringWindowToTop(f.Handle);
                SetForegroundWindow(f.Handle);
                f.Activate();
                if (attached) AttachThreadInput(me, fgThread, false);
            }
            catch { }
        }

        /// <summary>True when a game runs in exclusive full screen (nothing can be drawn over it).</summary>
        public static bool ExclusiveFullscreen()
        {
            try { int st; return SHQueryUserNotificationState(out st) == 0 && st == 3 /* QUNS_RUNNING_D3D_FULL_SCREEN */; }
            catch { return false; }
        }
    }

    // ───────────────────────── Sounds (5-minute chime, last-10-seconds beeps, time-up alarm) ─────────────────────────

    static class Sound
    {
        static readonly byte[] chime = Wav(new[] { 880, 160, 0, 50, 1175, 160, 0, 50, 1568, 320 });
        static readonly byte[] beep = Wav(new[] { 1000, 130 });
        static readonly byte[] beepHigh = Wav(new[] { 1400, 200 });
        static readonly byte[] alarm = Wav(new[] { 988, 220, 0, 70, 988, 220, 0, 70, 988, 220, 0, 160, 988, 220, 0, 70, 988, 220, 0, 70, 1319, 700 });
        static System.Media.SoundPlayer player;

        public static void Chime() { Play(chime); }
        /// <summary>Last 10 seconds: a short beep each second, higher for the last 3.</summary>
        public static void Beep(int secondsLeft) { Play(secondsLeft <= 3 ? beepHigh : beep); }
        public static void Alarm() { Play(alarm); }

        static void Play(byte[] wav)
        {
            try
            {
                if (player != null) { player.Stop(); player.Dispose(); }
                player = new System.Media.SoundPlayer(new MemoryStream(wav));
                player.Play(); // async: never blocks the timer
            }
            catch { }
        }

        /// <summary>Builds a 16-bit mono WAV from (frequency Hz, milliseconds) pairs; frequency 0 = silence.</summary>
        static byte[] Wav(int[] parts)
        {
            const int rate = 22050;
            var samples = new List<short>();
            for (int i = 0; i + 1 < parts.Length; i += 2)
            {
                int freq = parts[i], n = rate * parts[i + 1] / 1000, fade = rate / 100; // 10 ms fade in/out: no clicks
                for (int k = 0; k < n; k++)
                {
                    double env = Math.Min(1.0, Math.Min(k, n - 1 - k) / (double)fade);
                    double v = freq == 0 ? 0 : Math.Sin(2 * Math.PI * freq * k / rate) * 0.55 + Math.Sin(4 * Math.PI * freq * k / rate) * 0.12;
                    samples.Add((short)(v * env * 32000));
                }
            }
            using (var ms = new MemoryStream())
            using (var w = new BinaryWriter(ms))
            {
                int data = samples.Count * 2;
                w.Write(Encoding.ASCII.GetBytes("RIFF")); w.Write(36 + data); w.Write(Encoding.ASCII.GetBytes("WAVE"));
                w.Write(Encoding.ASCII.GetBytes("fmt ")); w.Write(16); w.Write((short)1); w.Write((short)1);
                w.Write(rate); w.Write(rate * 2); w.Write((short)2); w.Write((short)16);
                w.Write(Encoding.ASCII.GetBytes("data")); w.Write(data);
                foreach (var x in samples) w.Write(x);
                w.Flush();
                return ms.ToArray();
            }
        }

        /// <summary>ZenaaStation.exe --sounds &lt;folder&gt;: saves the sounds as .wav files to listen to.</summary>
        public static void Save(string dir)
        {
            Directory.CreateDirectory(dir);
            File.WriteAllBytes(Path.Combine(dir, "chime-5-minutes.wav"), chime);
            File.WriteAllBytes(Path.Combine(dir, "beep-last-10-seconds.wav"), beep);
            File.WriteAllBytes(Path.Combine(dir, "beep-last-3-seconds.wav"), beepHigh);
            File.WriteAllBytes(Path.Combine(dir, "alarm-time-up.wav"), alarm);
        }
    }

    // ───────────────────────── Hotkey & keyboard blocking ─────────────────────────

    static class HotKey
    {
        [DllImport("user32.dll")] static extern bool RegisterHotKey(IntPtr hWnd, int id, uint mods, uint vk);
        static MethodInvoker action;
        static HotKeyWindow window;

        class HotKeyWindow : NativeWindow
        {
            public HotKeyWindow() { CreateHandle(new CreateParams()); }
            protected override void WndProc(ref Message m)
            {
                if (m.Msg == 0x0312 && action != null) action();
                base.WndProc(ref m);
            }
        }

        public static void Register(IntPtr unused, MethodInvoker a)
        {
            action = a;
            window = new HotKeyWindow();
            RegisterHotKey(window.Handle, 1, 0x0002 | 0x0004 /* Ctrl+Shift */, (uint)Keys.F12);
        }
    }

    /** While the screen is locked: swallow Win keys, Alt+Tab, Alt+Esc, Ctrl+Esc and Alt+F4. */
    class KeyboardBlocker : IDisposable
    {
        delegate IntPtr Proc(int code, IntPtr wParam, IntPtr lParam);
        [DllImport("user32.dll")] static extern IntPtr SetWindowsHookEx(int id, Proc fn, IntPtr mod, uint thread);
        [DllImport("user32.dll")] static extern bool UnhookWindowsHookEx(IntPtr h);
        [DllImport("user32.dll")] static extern IntPtr CallNextHookEx(IntPtr h, int code, IntPtr w, IntPtr l);
        [DllImport("kernel32.dll")] static extern IntPtr GetModuleHandle(string name);
        [DllImport("user32.dll")] static extern short GetAsyncKeyState(int vk);

        readonly Proc proc;
        IntPtr hook;

        public KeyboardBlocker()
        {
            proc = Hook;
            using (var p = Process.GetCurrentProcess()) using (var m = p.MainModule)
                hook = SetWindowsHookEx(13 /* WH_KEYBOARD_LL */, proc, GetModuleHandle(m.ModuleName), 0);
        }

        IntPtr Hook(int code, IntPtr w, IntPtr l)
        {
            if (code >= 0)
            {
                int vk = Marshal.ReadInt32(l);
                bool alt = (Marshal.ReadInt32(l, 8) & 0x20) != 0;
                bool ctrl = (GetAsyncKeyState(0x11) & 0x8000) != 0;
                bool shift = (GetAsyncKeyState(0x10) & 0x8000) != 0;
                if (vk == 0x7B && ctrl && shift) return CallNextHookEx(hook, code, w, l); // staff hotkey
                if (vk == 0x5B || vk == 0x5C) return (IntPtr)1;                            // Win keys
                if (alt && (vk == 0x09 || vk == 0x1B || vk == 0x73)) return (IntPtr)1;     // Alt+Tab, Alt+Esc, Alt+F4
                if (ctrl && vk == 0x1B) return (IntPtr)1;                                   // Ctrl+Esc
            }
            return CallNextHookEx(hook, code, w, l);
        }

        public void Dispose()
        {
            if (hook != IntPtr.Zero) { UnhookWindowsHookEx(hook); hook = IntPtr.Zero; }
        }
    }
}
