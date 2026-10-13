// iimos 电脑操作的 Windows 版。和 computer/mac/main.swift 同一份协议:
//   stdin 一行一个请求 { id, method, args, foreground },stdout 一行一个回复 { id, result } 或 { id, error }。
//
// 用 Windows 自带的 .NET Framework 4 编译(csc.exe,只认 C# 5),用户机器上不用装任何东西:
//   截屏    GDI(整屏 CopyFromScreen,单个窗口 PrintWindow)
//   键鼠    SendInput(打字走 Unicode,不经过输入法)
//   读界面  UI Automation
// 进程是 Per-Monitor DPI 感知的:截图、元素位置、鼠标坐标都是物理像素,同一套坐标。
//
// mac 用 bundleId 认应用;这里 bundleId 就是 exe 名(apps 里给的那个,比如 notepad.exe)。
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Imaging;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;
using System.Windows.Automation;
using System.Windows.Forms;

class ComputerError : Exception {
    public ComputerError(string message) : base(message) { }
}

static class Native {
    [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
    [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X, Y; }
    [StructLayout(LayoutKind.Sequential)] public struct CURSORINFO { public int cbSize; public int flags; public IntPtr hCursor; public POINT ptScreenPos; }
    [StructLayout(LayoutKind.Sequential)] public struct ICONINFO { public bool fIcon; public int xHotspot; public int yHotspot; public IntPtr hbmMask; public IntPtr hbmColor; }

    [StructLayout(LayoutKind.Sequential)] public struct MOUSEINPUT { public int dx; public int dy; public int mouseData; public uint dwFlags; public uint time; public IntPtr dwExtraInfo; }
    [StructLayout(LayoutKind.Sequential)] public struct KEYBDINPUT { public ushort wVk; public ushort wScan; public uint dwFlags; public uint time; public IntPtr dwExtraInfo; }
    [StructLayout(LayoutKind.Explicit)] public struct InputUnion { [FieldOffset(0)] public MOUSEINPUT mi; [FieldOffset(0)] public KEYBDINPUT ki; }
    [StructLayout(LayoutKind.Sequential)] public struct INPUT { public uint type; public InputUnion u; }

    public const uint INPUT_MOUSE = 0, INPUT_KEYBOARD = 1;
    public const uint MOUSEEVENTF_MOVE = 0x0001, MOUSEEVENTF_LEFTDOWN = 0x0002, MOUSEEVENTF_LEFTUP = 0x0004,
        MOUSEEVENTF_RIGHTDOWN = 0x0008, MOUSEEVENTF_RIGHTUP = 0x0010, MOUSEEVENTF_WHEEL = 0x0800,
        MOUSEEVENTF_HWHEEL = 0x1000, MOUSEEVENTF_VIRTUALDESK = 0x4000, MOUSEEVENTF_ABSOLUTE = 0x8000;
    public const uint KEYEVENTF_EXTENDEDKEY = 0x0001, KEYEVENTF_KEYUP = 0x0002, KEYEVENTF_UNICODE = 0x0004;

    [DllImport("user32.dll", SetLastError = true)] public static extern uint SendInput(uint n, INPUT[] inputs, int size);
    [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int cmd);
    [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern IntPtr GetWindow(IntPtr hWnd, uint cmd);
    [DllImport("user32.dll")] public static extern int GetWindowTextLength(IntPtr hWnd);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int max);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetClassName(IntPtr hWnd, StringBuilder text, int max);
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
    [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint a, uint b, bool attach);
    [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
    public delegate bool EnumProc(IntPtr hWnd, IntPtr lParam);
    [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc proc, IntPtr lParam);
    [DllImport("user32.dll")] public static extern bool EnumChildWindows(IntPtr parent, EnumProc proc, IntPtr lParam);
    [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
    [DllImport("dwmapi.dll")] public static extern int DwmGetWindowAttribute(IntPtr hWnd, int attr, out RECT rect, int size);
    [DllImport("dwmapi.dll")] public static extern int DwmGetWindowAttribute(IntPtr hWnd, int attr, out int value, int size);
    [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr hWnd, IntPtr hdc, uint flags);
    [DllImport("user32.dll")] public static extern bool GetCursorInfo(ref CURSORINFO info);
    [DllImport("user32.dll")] public static extern bool GetIconInfo(IntPtr icon, out ICONINFO info);
    [DllImport("user32.dll")] public static extern bool DrawIconEx(IntPtr hdc, int x, int y, IntPtr icon, int w, int h, int step, IntPtr brush, int flags);
    [DllImport("gdi32.dll")] public static extern bool DeleteObject(IntPtr obj);
    [DllImport("user32.dll")] public static extern int GetSystemMetrics(int index);
    [DllImport("user32.dll")] public static extern short VkKeyScan(char ch);
    [DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(IntPtr value);
    [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
    [DllImport("user32.dll")] public static extern IntPtr GetWindowDpiAwarenessContext(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern int GetAwarenessFromDpiAwarenessContext(IntPtr context);
    [DllImport("user32.dll")] public static extern uint GetDpiForSystem();
    [DllImport("user32.dll")] public static extern IntPtr MonitorFromWindow(IntPtr hWnd, uint flags);
    [DllImport("shcore.dll")] public static extern int GetDpiForMonitor(IntPtr monitor, int type, out uint dpiX, out uint dpiY);
}

static class Computer {
    static readonly JavaScriptSerializer Json = new JavaScriptSerializer { MaxJsonLength = int.MaxValue, RecursionLimit = 256 };
    static bool foregroundAllowed = false;

    static ComputerError Fail(string message) { return new ComputerError(message); }

    // ── 参数 ─────────────────────────────────────────────
    static double Number(Dictionary<string, object> args, string key) {
        object value;
        if (!args.TryGetValue(key, out value) || value == null || value is bool) throw Fail(key + " 必须是有限数字");
        double result;
        try { result = Convert.ToDouble(value, System.Globalization.CultureInfo.InvariantCulture); } catch { throw Fail(key + " 必须是有限数字"); }
        if (double.IsNaN(result) || double.IsInfinity(result)) throw Fail(key + " 必须是有限数字");
        return result;
    }
    static string Text(Dictionary<string, object> args, string key) {
        object value;
        string text = args.TryGetValue(key, out value) ? value as string : null;
        if (string.IsNullOrEmpty(text)) throw Fail("缺少 " + key);
        return text;
    }
    static int Int(Dictionary<string, object> args, string key, int fallback) {
        object value;
        if (!args.TryGetValue(key, out value) || value == null) return fallback;
        try { return Convert.ToInt32(value); } catch { return fallback; }
    }
    static Dictionary<string, object> Rect(Rectangle r) {
        return new Dictionary<string, object> { { "x", r.X }, { "y", r.Y }, { "width", r.Width }, { "height", r.Height } };
    }

    // ── 窗口与应用 ───────────────────────────────────────
    static string WindowText(IntPtr hWnd) {
        int length = Native.GetWindowTextLength(hWnd);
        if (length <= 0) return "";
        StringBuilder text = new StringBuilder(length + 1);
        Native.GetWindowText(hWnd, text, text.Capacity);
        return text.ToString();
    }
    static string ClassName(IntPtr hWnd) {
        StringBuilder text = new StringBuilder(256);
        Native.GetClassName(hWnd, text, text.Capacity);
        return text.ToString();
    }
    static bool Cloaked(IntPtr hWnd) {
        int cloaked;
        return Native.DwmGetWindowAttribute(hWnd, 14, out cloaked, 4) == 0 && cloaked != 0;
    }
    /** UWP 应用的顶层窗口属于 ApplicationFrameHost,真正的进程在它的子窗口 CoreWindow 上。 */
    static uint RealPid(IntPtr hWnd) {
        uint pid;
        Native.GetWindowThreadProcessId(hWnd, out pid);
        if (ClassName(hWnd) != "ApplicationFrameWindow") return pid;
        uint inner = pid;
        Native.EnumChildWindows(hWnd, delegate (IntPtr child, IntPtr _) {
            uint childPid;
            Native.GetWindowThreadProcessId(child, out childPid);
            if (childPid != pid) { inner = childPid; return false; }
            return true;
        }, IntPtr.Zero);
        return inner;
    }
    /** 用户看得见的顶层窗口(有标题、没被隐藏、不是工具窗口的子窗口)。 */
    static List<IntPtr> TopWindows() {
        List<IntPtr> windows = new List<IntPtr>();
        Native.EnumWindows(delegate (IntPtr hWnd, IntPtr _) {
            if (Native.IsWindowVisible(hWnd) && Native.GetWindow(hWnd, 4) == IntPtr.Zero && WindowText(hWnd).Length > 0 && !Cloaked(hWnd)) windows.Add(hWnd);
            return true;
        }, IntPtr.Zero);
        return windows;
    }
    static string ExeName(uint pid) {
        try { return Process.GetProcessById((int)pid).ProcessName + ".exe"; } catch { return ""; }
    }
    static uint ForegroundPid() {
        IntPtr hWnd = Native.GetForegroundWindow();
        return hWnd == IntPtr.Zero ? 0 : RealPid(hWnd);
    }

    class App {
        public uint Pid; public string Exe; public string Name; public List<IntPtr> Windows = new List<IntPtr>();
    }
    static List<App> Apps() {
        Dictionary<uint, App> byPid = new Dictionary<uint, App>();
        List<App> list = new List<App>();
        foreach (IntPtr hWnd in TopWindows()) {
            uint pid = RealPid(hWnd);
            if (pid == (uint)Process.GetCurrentProcess().Id) continue;
            App app;
            if (!byPid.TryGetValue(pid, out app)) {
                app = new App { Pid = pid, Exe = ExeName(pid), Name = WindowText(hWnd) };
                if (app.Exe.Length == 0) continue;
                byPid[pid] = app;
                list.Add(app);
            }
            app.Windows.Add(hWnd);
        }
        return list;
    }
    static Dictionary<string, object> AppJson(App app) {
        return new Dictionary<string, object> {
            { "bundleId", app.Exe }, { "name", app.Name }, { "pid", (int)app.Pid }, { "active", ForegroundPid() == app.Pid },
        };
    }
    static App TargetApp(Dictionary<string, object> args) {
        string id = Text(args, "bundleId");
        string want = id.ToLowerInvariant();
        if (!want.EndsWith(".exe")) want += ".exe";
        uint front = ForegroundPid();
        App found = null;
        foreach (App app in Apps()) {
            if (app.Exe.ToLowerInvariant() != want) continue;
            if (found == null || app.Pid == front) found = app;
        }
        if (found == null) throw Fail("应用未运行：" + id + "，请先调用 computer.open(bundleId)");
        return found;
    }
    /** 这个应用当前最该看的那个窗口:它在前台就取前台那个,否则取第一个。 */
    static IntPtr MainWindow(App app) {
        IntPtr front = Native.GetForegroundWindow();
        foreach (IntPtr hWnd in app.Windows) if (hWnd == front) return hWnd;
        return app.Windows[0];
    }

    static void RequireForegroundPermission() {
        if (!foregroundAllowed) throw Fail("requires_foreground：此操作会占用鼠标或焦点，用户还没允许它操作这台电脑:请用户在菜单栏 iimos 图标里勾选「允许它操作这台电脑」");
    }
    static void RequireFrontmost(App app) {
        RequireForegroundPermission();
        if (ForegroundPid() != app.Pid) throw Fail("目标应用已失去前台焦点，停止本次操作；请重新读取界面");
    }

    // ── 屏幕 ─────────────────────────────────────────────
    static void CheckPoint(double x, double y) {
        foreach (Screen screen in Screen.AllScreens) {
            if (screen.Bounds.Contains((int)Math.Round(x), (int)Math.Round(y))) return;
        }
        throw Fail("坐标不在任何屏幕范围内");
    }
    static Rectangle WindowBounds(IntPtr hWnd) {
        Native.RECT r;
        if (Native.DwmGetWindowAttribute(hWnd, 9, out r, Marshal.SizeOf(typeof(Native.RECT))) != 0) Native.GetWindowRect(hWnd, out r);
        return Rectangle.FromLTRB(r.Left, r.Top, r.Right, r.Bottom);
    }
    /**
     * 没声明支持高 DPI 的窗口(很多老程序),PrintWindow 只按它的逻辑尺寸画,物理像素要再乘这个倍数。
     * 不支持的老系统上一律当 1。
     */
    static double PrintScale(IntPtr hWnd) {
        try {
            int awareness = Native.GetAwarenessFromDpiAwarenessContext(Native.GetWindowDpiAwarenessContext(hWnd));
            if (awareness == 2) return 1;
            uint dpiX, dpiY;
            if (Native.GetDpiForMonitor(Native.MonitorFromWindow(hWnd, 2), 0, out dpiX, out dpiY) != 0) return 1;
            double basis = awareness == 1 ? Native.GetDpiForSystem() : 96;
            return basis > 0 ? dpiX / basis : 1;
        } catch { return 1; }
    }
    static void DrawCursor(Graphics g, Rectangle bounds) {
        Native.CURSORINFO info = new Native.CURSORINFO();
        info.cbSize = Marshal.SizeOf(typeof(Native.CURSORINFO));
        if (!Native.GetCursorInfo(ref info) || info.flags != 1) return;
        Native.ICONINFO icon;
        int hx = 0, hy = 0;
        if (Native.GetIconInfo(info.hCursor, out icon)) {
            hx = icon.xHotspot; hy = icon.yHotspot;
            if (icon.hbmMask != IntPtr.Zero) Native.DeleteObject(icon.hbmMask);
            if (icon.hbmColor != IntPtr.Zero) Native.DeleteObject(icon.hbmColor);
        }
        IntPtr hdc = g.GetHdc();
        try { Native.DrawIconEx(hdc, info.ptScreenPos.X - bounds.X - hx, info.ptScreenPos.Y - bounds.Y - hy, info.hCursor, 0, 0, 0, IntPtr.Zero, 3); }
        finally { g.ReleaseHdc(hdc); }
    }
    static object Screenshot(Dictionary<string, object> args) {
        Rectangle bounds;
        Bitmap shot;
        if (args.ContainsKey("bundleId") && args["bundleId"] != null) {
            App app = TargetApp(args);
            IntPtr hWnd = MainWindow(app);
            if (Native.IsIconic(hWnd)) throw Fail("目标窗口最小化了，请先 focus 再截图；可使用 computer.screenshot() 查看屏幕");
            bounds = WindowBounds(hWnd);
            if (bounds.Width <= 0 || bounds.Height <= 0) throw Fail("截图区域无效");
            Native.RECT outer;
            Native.GetWindowRect(hWnd, out outer);
            Rectangle full = Rectangle.FromLTRB(outer.Left, outer.Top, outer.Right, outer.Bottom);
            Bitmap whole = new Bitmap(Math.Max(1, full.Width), Math.Max(1, full.Height), PixelFormat.Format32bppArgb);
            using (Graphics g = Graphics.FromImage(whole)) {
                IntPtr hdc = g.GetHdc();
                bool ok;
                try { ok = Native.PrintWindow(hWnd, hdc, 2); } finally { g.ReleaseHdc(hdc); }
                if (!ok) { whole.Dispose(); throw Fail("没有找到可截图的目标窗口；可使用 computer.screenshot() 查看屏幕"); }
            }
            // PrintWindow 画的是含阴影边框的整个窗口,裁成看得见的那块;没声明高 DPI 的窗口画得小,按倍数放大回物理尺寸
            double factor = PrintScale(hWnd);
            RectangleF source = new RectangleF((float)((bounds.X - full.X) / factor), (float)((bounds.Y - full.Y) / factor), (float)(bounds.Width / factor), (float)(bounds.Height / factor));
            shot = new Bitmap(bounds.Width, bounds.Height, PixelFormat.Format32bppArgb);
            using (Graphics g = Graphics.FromImage(shot)) {
                if (factor != 1) g.InterpolationMode = System.Drawing.Drawing2D.InterpolationMode.HighQualityBicubic;
                g.DrawImage(whole, new RectangleF(0, 0, bounds.Width, bounds.Height), source, GraphicsUnit.Pixel);
            }
            whole.Dispose();
        } else {
            Screen[] screens = Screen.AllScreens;
            int id = Int(args, "displayId", 0);
            Screen screen = null;
            if (id == 0) screen = Screen.PrimaryScreen;
            else if (id >= 1 && id <= screens.Length) screen = screens[id - 1];
            if (screen == null) throw Fail("显示器不存在");
            bounds = screen.Bounds;
            shot = new Bitmap(bounds.Width, bounds.Height, PixelFormat.Format32bppArgb);
            using (Graphics g = Graphics.FromImage(shot)) {
                g.CopyFromScreen(bounds.Location, Point.Empty, bounds.Size, CopyPixelOperation.SourceCopy);
                DrawCursor(g, bounds);
            }
        }
        double scale = Math.Min(1.0, 4096.0 / Math.Max(bounds.Width, bounds.Height));
        int width = Math.Max(1, (int)(bounds.Width * scale)), height = Math.Max(1, (int)(bounds.Height * scale));
        Bitmap output = shot;
        if (width != shot.Width || height != shot.Height) {
            output = new Bitmap(width, height, PixelFormat.Format32bppArgb);
            using (Graphics g = Graphics.FromImage(output)) {
                g.InterpolationMode = System.Drawing.Drawing2D.InterpolationMode.HighQualityBicubic;
                g.DrawImage(shot, 0, 0, width, height);
            }
            shot.Dispose();
        }
        string png;
        using (MemoryStream stream = new MemoryStream()) {
            output.Save(stream, ImageFormat.Png);
            png = Convert.ToBase64String(stream.ToArray());
        }
        output.Dispose();
        return new Dictionary<string, object> {
            { "png", png }, { "width", width }, { "height", height }, { "bounds", Rect(bounds) }, { "scale", scale },
            { "coordinates", "图片坐标转换为屏幕坐标(物理像素)：x=bounds.x+图片x/scale，y=bounds.y+图片y/scale" },
        };
    }

    // ── 界面结构(UI Automation)────────────────────────
    // 元素引用只属于最近一次界面快照；操作后清空，禁止使用旧编号误点。
    static Dictionary<string, AutomationElement> elements = new Dictionary<string, AutomationElement>();
    static uint snapshotPid = 0;

    /** mac 的 AX 动作名,在这里对应到 UI Automation 的 Pattern。state 只列这个元素真的支持的。 */
    static List<string> Actions(AutomationElement element) {
        List<string> actions = new List<string>();
        object pattern;
        if (element.TryGetCurrentPattern(InvokePattern.Pattern, out pattern)) actions.Add("AXPress");
        if (element.TryGetCurrentPattern(TogglePattern.Pattern, out pattern)) { if (!actions.Contains("AXPress")) actions.Add("AXPress"); actions.Add("AXToggle"); }
        if (element.TryGetCurrentPattern(SelectionItemPattern.Pattern, out pattern)) { if (!actions.Contains("AXPress")) actions.Add("AXPress"); actions.Add("AXSelect"); }
        if (element.TryGetCurrentPattern(ExpandCollapsePattern.Pattern, out pattern)) { if (!actions.Contains("AXPress")) actions.Add("AXPress"); actions.Add("AXExpand"); actions.Add("AXCollapse"); }
        if (element.TryGetCurrentPattern(RangeValuePattern.Pattern, out pattern)) { actions.Add("AXIncrement"); actions.Add("AXDecrement"); }
        if (element.TryGetCurrentPattern(ScrollItemPattern.Pattern, out pattern)) actions.Add("AXScrollToVisible");
        if (element.Current.IsKeyboardFocusable) actions.Add("AXFocus");
        return actions;
    }
    static bool ValueSettable(AutomationElement element) {
        if (element.Current.IsPassword) return false;
        object pattern;
        if (element.TryGetCurrentPattern(ValuePattern.Pattern, out pattern)) return !((ValuePattern)pattern).Current.IsReadOnly;
        if (element.TryGetCurrentPattern(RangeValuePattern.Pattern, out pattern)) return !((RangeValuePattern)pattern).Current.IsReadOnly;
        return false;
    }
    static string ValueOf(AutomationElement element) {
        if (element.Current.IsPassword) return "";
        object pattern;
        try {
            if (element.TryGetCurrentPattern(ValuePattern.Pattern, out pattern)) return Clip(((ValuePattern)pattern).Current.Value);
            if (element.TryGetCurrentPattern(RangeValuePattern.Pattern, out pattern)) return ((RangeValuePattern)pattern).Current.Value.ToString(System.Globalization.CultureInfo.InvariantCulture);
            if (element.TryGetCurrentPattern(TogglePattern.Pattern, out pattern)) return ((TogglePattern)pattern).Current.ToggleState.ToString();
            // 多行输入框、文档区、浏览器正文:字在 TextPattern 里,不在 ValuePattern 里
            if (element.TryGetCurrentPattern(TextPattern.Pattern, out pattern)) return Clip(((TextPattern)pattern).DocumentRange.GetText(2000));
        } catch { }
        return "";
    }
    static string Clip(string text) { return text == null ? "" : (text.Length > 2000 ? text.Substring(0, 2000) : text); }
    static string Role(AutomationElement element) {
        string name = element.Current.ControlType.ProgrammaticName;
        return name.StartsWith("ControlType.") ? name.Substring(12) : name;
    }

    static object State(App app) {
        elements.Clear();
        snapshotPid = app.Pid;
        string snapshot = Guid.NewGuid().ToString("N").Substring(0, 8);
        DateTime deadline = DateTime.UtcNow.AddSeconds(5);
        List<object> rows = new List<object>();
        bool truncated = false;
        TreeWalker walker = TreeWalker.ControlViewWalker;

        Action<AutomationElement, string, int> visit = null;
        visit = delegate (AutomationElement element, string parent, int depth) {
            if (rows.Count >= 1000 || depth > 18 || DateTime.UtcNow > deadline) { truncated = true; return; }
            string id = snapshot + ":" + rows.Count;
            Dictionary<string, object> row = new Dictionary<string, object> { { "id", id }, { "depth", depth } };
            try {
                row["role"] = Role(element);
                if (parent != null) row["parent"] = parent;
                string title = Clip(element.Current.Name);
                if (title.Length > 0) row["AXTitle"] = title;
                string help = Clip(element.Current.HelpText);
                if (help.Length > 0) row["AXHelp"] = help;
                string automationId = element.Current.AutomationId;
                if (!string.IsNullOrEmpty(automationId)) row["automationId"] = automationId;
                string value = ValueOf(element);
                if (value.Length > 0) row["value"] = value;
                row["valueSettable"] = ValueSettable(element);
                row["enabled"] = element.Current.IsEnabled;
                System.Windows.Rect r = element.Current.BoundingRectangle;
                if (!r.IsEmpty && !double.IsInfinity(r.Width)) row["bounds"] = Rect(new Rectangle((int)r.X, (int)r.Y, (int)r.Width, (int)r.Height));
                row["actions"] = Actions(element);
            } catch (ElementNotAvailableException) { return; }
            rows.Add(row);
            elements[id] = element;
            AutomationElement child = null;
            try { child = walker.GetFirstChild(element); } catch { }
            while (child != null) {
                if (rows.Count >= 1000 || DateTime.UtcNow > deadline) { truncated = true; break; }
                visit(child, id, depth + 1);
                try { child = walker.GetNextSibling(child); } catch { child = null; }
            }
        };

        // 第 0 层是应用本身,下面是它的各个窗口(mac 是窗口和菜单栏)
        string rootId = snapshot + ":0";
        rows.Add(new Dictionary<string, object> { { "id", rootId }, { "role", "Application" }, { "depth", 0 }, { "AXTitle", app.Name }, { "valueSettable", false }, { "actions", new List<string>() } });
        foreach (IntPtr hWnd in app.Windows) {
            AutomationElement window = null;
            try { window = AutomationElement.FromHandle(hWnd); } catch { }
            if (window != null) visit(window, rootId, 1);
        }
        return new Dictionary<string, object> {
            { "app", AppJson(app) }, { "snapshot", snapshot }, { "elements", rows }, { "truncated", truncated },
            { "control", new Dictionary<string, object> { { "foreground", foregroundAllowed } } },
            { "coordinates", "全局屏幕坐标(物理像素)，主屏幕左上角为原点；多屏坐标可能为负数" },
        };
    }
    static AutomationElement ResolveElement(Dictionary<string, object> args, App app) {
        string id = Text(args, "element");
        AutomationElement element;
        if (snapshotPid != app.Pid || !elements.TryGetValue(id, out element)) throw Fail("元素引用已过期，请先调用 app.state() 获取新的 id");
        return element;
    }
    static void Perform(AutomationElement element, string action) {
        object pattern;
        switch (action) {
            case "AXPress":
                if (element.TryGetCurrentPattern(InvokePattern.Pattern, out pattern)) { ((InvokePattern)pattern).Invoke(); return; }
                if (element.TryGetCurrentPattern(TogglePattern.Pattern, out pattern)) { ((TogglePattern)pattern).Toggle(); return; }
                if (element.TryGetCurrentPattern(SelectionItemPattern.Pattern, out pattern)) { ((SelectionItemPattern)pattern).Select(); return; }
                if (element.TryGetCurrentPattern(ExpandCollapsePattern.Pattern, out pattern)) {
                    ExpandCollapsePattern p = (ExpandCollapsePattern)pattern;
                    if (p.Current.ExpandCollapseState == ExpandCollapseState.Expanded) p.Collapse(); else p.Expand();
                    return;
                }
                break;
            case "AXToggle":
                if (element.TryGetCurrentPattern(TogglePattern.Pattern, out pattern)) { ((TogglePattern)pattern).Toggle(); return; }
                break;
            case "AXSelect":
                if (element.TryGetCurrentPattern(SelectionItemPattern.Pattern, out pattern)) { ((SelectionItemPattern)pattern).Select(); return; }
                break;
            case "AXExpand":
                if (element.TryGetCurrentPattern(ExpandCollapsePattern.Pattern, out pattern)) { ((ExpandCollapsePattern)pattern).Expand(); return; }
                break;
            case "AXCollapse":
                if (element.TryGetCurrentPattern(ExpandCollapsePattern.Pattern, out pattern)) { ((ExpandCollapsePattern)pattern).Collapse(); return; }
                break;
            case "AXIncrement":
            case "AXDecrement":
                if (element.TryGetCurrentPattern(RangeValuePattern.Pattern, out pattern)) {
                    RangeValuePattern p = (RangeValuePattern)pattern;
                    double step = p.Current.SmallChange > 0 ? p.Current.SmallChange : 1;
                    double next = p.Current.Value + (action == "AXIncrement" ? step : -step);
                    p.SetValue(Math.Max(p.Current.Minimum, Math.Min(p.Current.Maximum, next)));
                    return;
                }
                break;
            case "AXScrollToVisible":
                if (element.TryGetCurrentPattern(ScrollItemPattern.Pattern, out pattern)) { ((ScrollItemPattern)pattern).ScrollIntoView(); return; }
                break;
            case "AXFocus":
                element.SetFocus();
                return;
        }
        throw Fail("此元素不支持该操作，请使用 state 返回的 actions");
    }

    // ── 键鼠(SendInput)─────────────────────────────────
    static bool leftHeld = false;
    static Point heldAt;
    static void Send(params Native.INPUT[] inputs) {
        if (Native.SendInput((uint)inputs.Length, inputs, Marshal.SizeOf(typeof(Native.INPUT))) != inputs.Length) {
            throw Fail("输入被系统拦下了(目标可能以管理员身份运行，iimos 操作不了它)");
        }
    }
    static Native.INPUT MouseInput(uint flags, int x, int y, int data) {
        Native.INPUT input = new Native.INPUT { type = Native.INPUT_MOUSE };
        input.u.mi = new Native.MOUSEINPUT { dx = x, dy = y, mouseData = data, dwFlags = flags };
        return input;
    }
    /** 物理像素 → SendInput 要的 0..65535 虚拟桌面坐标。 */
    static Native.INPUT MoveTo(double x, double y) {
        int left = Native.GetSystemMetrics(76), top = Native.GetSystemMetrics(77);
        int width = Math.Max(2, Native.GetSystemMetrics(78)), height = Math.Max(2, Native.GetSystemMetrics(79));
        int nx = (int)Math.Round((x - left) * 65535.0 / (width - 1));
        int ny = (int)Math.Round((y - top) * 65535.0 / (height - 1));
        return MouseInput(Native.MOUSEEVENTF_MOVE | Native.MOUSEEVENTF_ABSOLUTE | Native.MOUSEEVENTF_VIRTUALDESK, nx, ny, 0);
    }
    static void LeftDown(double x, double y) {
        Send(MoveTo(x, y), MouseInput(Native.MOUSEEVENTF_LEFTDOWN, 0, 0, 0));
        leftHeld = true; heldAt = new Point((int)x, (int)y);
    }
    static void LeftUp(double x, double y) {
        Send(MoveTo(x, y), MouseInput(Native.MOUSEEVENTF_LEFTUP, 0, 0, 0));
        leftHeld = false;
    }
    /** 退出时松开拖拽中的鼠标,别留下按住状态。 */
    public static void ReleaseHeld() {
        if (!leftHeld) return;
        try { LeftUp(heldAt.X, heldAt.Y); } catch { }
    }

    static Native.INPUT KeyInput(ushort vk, ushort scan, uint flags) {
        Native.INPUT input = new Native.INPUT { type = Native.INPUT_KEYBOARD };
        input.u.ki = new Native.KEYBDINPUT { wVk = vk, wScan = scan, dwFlags = flags };
        return input;
    }
    static readonly Dictionary<string, ushort> Keys = new Dictionary<string, ushort> {
        { "enter", 0x0D }, { "return", 0x0D }, { "tab", 0x09 }, { "space", 0x20 }, { "backspace", 0x08 },
        { "escape", 0x1B }, { "esc", 0x1B }, { "delete", 0x2E }, { "insert", 0x2D }, { "home", 0x24 }, { "end", 0x23 },
        { "pageup", 0x21 }, { "pagedown", 0x22 }, { "left", 0x25 }, { "up", 0x26 }, { "right", 0x27 }, { "down", 0x28 },
        { "f1", 0x70 }, { "f2", 0x71 }, { "f3", 0x72 }, { "f4", 0x73 }, { "f5", 0x74 }, { "f6", 0x75 },
        { "f7", 0x76 }, { "f8", 0x77 }, { "f9", 0x78 }, { "f10", 0x79 }, { "f11", 0x7A }, { "f12", 0x7B },
    };
    static readonly HashSet<ushort> Extended = new HashSet<ushort> { 0x2E, 0x2D, 0x24, 0x23, 0x21, 0x22, 0x25, 0x26, 0x27, 0x28 };
    static void Press(string shortcut) {
        string[] parts = shortcut.ToLowerInvariant().Split('+');
        string last = parts[parts.Length - 1];
        ushort key;
        if (!Keys.TryGetValue(last, out key)) {
            if (last.Length != 1) throw Fail("不支持的按键：" + shortcut);
            short scan = Native.VkKeyScan(last[0]);
            if (scan == -1) throw Fail("不支持的按键：" + shortcut);
            key = (ushort)(scan & 0xFF);
        }
        List<ushort> modifiers = new List<ushort>();
        for (int i = 0; i < parts.Length - 1; i++) {
            switch (parts[i]) {
                case "cmd": case "ctrl": case "control": modifiers.Add(0x11); break;   // mac 的 cmd 在 Windows 上就是 Ctrl
                case "alt": case "option": modifiers.Add(0x12); break;
                case "shift": modifiers.Add(0x10); break;
                case "win": case "meta": modifiers.Add(0x5B); break;
                default: throw Fail("不支持的修饰键：" + parts[i]);
            }
        }
        List<Native.INPUT> inputs = new List<Native.INPUT>();
        foreach (ushort m in modifiers) inputs.Add(KeyInput(m, 0, m == 0x5B ? Native.KEYEVENTF_EXTENDEDKEY : 0));
        uint ext = Extended.Contains(key) ? Native.KEYEVENTF_EXTENDEDKEY : 0;
        inputs.Add(KeyInput(key, 0, ext));
        inputs.Add(KeyInput(key, 0, ext | Native.KEYEVENTF_KEYUP));
        for (int i = modifiers.Count - 1; i >= 0; i--) inputs.Add(KeyInput(modifiers[i], 0, (modifiers[i] == 0x5B ? Native.KEYEVENTF_EXTENDEDKEY : 0) | Native.KEYEVENTF_KEYUP));
        Send(inputs.ToArray());
    }
    static void TypeText(App app, string value) {
        if (value.Length > 20000) throw Fail("单次输入最多 20000 个 UTF-16 字符");
        // 逐字符发,换行和 Tab 当按键;代理对(表情)放在同一批里,不拆开
        for (int i = 0; i < value.Length; i++) {
            RequireFrontmost(app);
            char c = value[i];
            if (c == '\r') continue;
            if (c == '\n') { Press("enter"); }
            else if (c == '\t') { Press("tab"); }
            else {
                List<Native.INPUT> inputs = new List<Native.INPUT>();
                int count = char.IsHighSurrogate(c) && i + 1 < value.Length ? 2 : 1;
                for (int k = 0; k < count; k++) inputs.Add(KeyInput(0, value[i + k], Native.KEYEVENTF_UNICODE));
                for (int k = 0; k < count; k++) inputs.Add(KeyInput(0, value[i + k], Native.KEYEVENTF_UNICODE | Native.KEYEVENTF_KEYUP));
                Send(inputs.ToArray());
                i += count - 1;
            }
            Thread.Sleep(10);
        }
    }

    // ── 打开、切前台 ──────────────────────────────────────
    static object Open(Dictionary<string, object> args) {
        string id = Text(args, "bundleId");
        try { Process.Start(new ProcessStartInfo(id) { UseShellExecute = true }); }
        catch (Exception error) { throw Fail("没有安装应用：" + id + "(" + error.Message + ")"); }
        elements.Clear();
        string want = Path.GetFileName(id).ToLowerInvariant();
        if (!want.EndsWith(".exe")) want += ".exe";
        for (int i = 0; i < 50; i++) {
            foreach (App app in Apps()) if (app.Exe.ToLowerInvariant() == want) return AppJson(app);
            Thread.Sleep(100);
        }
        // UWP 和一部分应用的进程名和启动名不一样:让模型看 apps 自己找
        return new Dictionary<string, object> { { "ok", true }, { "note", "已启动，但没认出是哪个进程；用 apps 找它的 bundleId" } };
    }
    static object Focus(App app) {
        RequireForegroundPermission();
        elements.Clear();
        IntPtr hWnd = MainWindow(app);
        if (Native.IsIconic(hWnd)) Native.ShowWindow(hWnd, 9);
        // Windows 不让后台进程随便抢前台:先挂到前台窗口的输入队列上,再切
        uint frontThread = 0, pid;
        IntPtr front = Native.GetForegroundWindow();
        if (front != IntPtr.Zero) frontThread = Native.GetWindowThreadProcessId(front, out pid);
        uint self = Native.GetCurrentThreadId();
        if (frontThread != 0 && frontThread != self) Native.AttachThreadInput(self, frontThread, true);
        try {
            Send(KeyInput(0x12, 0, 0), KeyInput(0x12, 0, Native.KEYEVENTF_KEYUP));
            Native.BringWindowToTop(hWnd);
            Native.SetForegroundWindow(hWnd);
        } finally {
            if (frontThread != 0 && frontThread != self) Native.AttachThreadInput(self, frontThread, false);
        }
        for (int i = 0; i < 20; i++) {
            if (ForegroundPid() == app.Pid) return AppJson(app);
            Thread.Sleep(50);
        }
        throw Fail("应用未能切到前台");
    }

    // ── 分发 ─────────────────────────────────────────────
    static object Execute(string method, Dictionary<string, object> args) {
        switch (method) {
            case "permissions":
            case "requestPermission":
                // Windows 没有 mac 那种系统授权;「允许它操作这台电脑」由 iimos 自己的开关管
                return new Dictionary<string, object> { { "accessibility", true }, { "screen", true } };
            case "apps": {
                List<object> list = new List<object>();
                foreach (App app in Apps()) list.Add(AppJson(app));
                return list;
            }
            case "displays": {
                List<object> list = new List<object>();
                Screen[] screens = Screen.AllScreens;
                for (int i = 0; i < screens.Length; i++) {
                    list.Add(new Dictionary<string, object> { { "id", i + 1 }, { "bounds", Rect(screens[i].Bounds) }, { "main", screens[i].Primary } });
                }
                return list;
            }
            case "open": return Open(args);
            case "screenshot": return Screenshot(args);
        }
        App target = TargetApp(args);
        if (method == "state") return State(target);
        if (method == "focus") return Focus(target);
        try {
            switch (method) {
                case "click":
                    if (args.ContainsKey("element") && args["element"] != null) {
                        AutomationElement element = ResolveElement(args, target);
                        try { Perform(element, "AXPress"); }
                        catch (ComputerError) { throw Fail("元素点击失败（不支持点按）；请重新读取界面，或改用坐标点击"); }
                    } else {
                        RequireFrontmost(target);
                        double x = Number(args, "x"), y = Number(args, "y");
                        CheckPoint(x, y);
                        object buttonValue;
                        string button = args.TryGetValue("button", out buttonValue) && buttonValue is string ? (string)buttonValue : "left";
                        if (button != "left" && button != "right") throw Fail("button 必须为 left 或 right");
                        int count = Int(args, "count", 1);
                        if (count != 1 && count != 2) throw Fail("count 必须为 1 或 2");
                        uint down = button == "right" ? Native.MOUSEEVENTF_RIGHTDOWN : Native.MOUSEEVENTF_LEFTDOWN;
                        uint up = button == "right" ? Native.MOUSEEVENTF_RIGHTUP : Native.MOUSEEVENTF_LEFTUP;
                        for (int i = 0; i < count; i++) {
                            RequireFrontmost(target);
                            Send(MoveTo(x, y), MouseInput(down, 0, 0, 0), MouseInput(up, 0, 0, 0));
                        }
                    }
                    break;
                case "action": {
                    AutomationElement element = ResolveElement(args, target);
                    string action = Text(args, "action");
                    if (action != "AXPress" && action != "AXIncrement" && action != "AXDecrement") RequireForegroundPermission();
                    if (!Actions(element).Contains(action)) throw Fail("此元素不支持该操作，请使用 state 返回的 actions");
                    try { Perform(element, action); }
                    catch (ComputerError) { throw; }
                    catch (Exception error) { throw Fail("元素操作失败（" + error.Message + "）；请重新读取界面"); }
                    break;
                }
                case "setValue": {
                    AutomationElement element = ResolveElement(args, target);
                    if (!ValueSettable(element)) throw Fail("此元素不支持直接设置值，请读取界面选择其他可用操作");
                    object pattern;
                    try {
                        if (element.TryGetCurrentPattern(ValuePattern.Pattern, out pattern)) {
                            object raw;
                            string content = args.TryGetValue("value", out raw) ? raw as string : null;
                            if (content == null) throw Fail("value 必须为字符串");
                            ((ValuePattern)pattern).SetValue(content);
                        } else if (element.TryGetCurrentPattern(RangeValuePattern.Pattern, out pattern)) {
                            ((RangeValuePattern)pattern).SetValue(Number(args, "value"));
                        }
                    } catch (ComputerError) { throw; }
                    catch (Exception error) { throw Fail("此元素不能直接设置值（" + error.Message + "）"); }
                    break;
                }
                case "type":
                    RequireFrontmost(target);
                    TypeText(target, Text(args, "text"));
                    break;
                case "press":
                    RequireFrontmost(target);
                    Press(Text(args, "key"));
                    break;
                case "scroll": {
                    RequireFrontmost(target);
                    double x = Number(args, "x"), y = Number(args, "y");
                    CheckPoint(x, y);
                    double dy = Number(args, "dy"), dx = Number(args, "dx");
                    if (Math.Abs(dx) > 10000 || Math.Abs(dy) > 10000) throw Fail("单次滚动距离不能超过 10000");
                    // dy 是像素,正数往下;滚轮一格是 120,大约滚 100 像素
                    List<Native.INPUT> inputs = new List<Native.INPUT> { MoveTo(x, y) };
                    if (dy != 0) inputs.Add(MouseInput(Native.MOUSEEVENTF_WHEEL, 0, 0, (int)Math.Round(-dy * 1.2)));
                    if (dx != 0) inputs.Add(MouseInput(Native.MOUSEEVENTF_HWHEEL, 0, 0, (int)Math.Round(dx * 1.2)));
                    Send(inputs.ToArray());
                    break;
                }
                case "drag": {
                    RequireFrontmost(target);
                    double fromX = Number(args, "fromX"), fromY = Number(args, "fromY"), toX = Number(args, "toX"), toY = Number(args, "toY");
                    CheckPoint(fromX, fromY);
                    CheckPoint(toX, toY);
                    double cx = fromX, cy = fromY;
                    LeftDown(fromX, fromY);
                    try {
                        for (int step = 1; step <= 20; step++) {
                            RequireFrontmost(target);
                            cx = fromX + (toX - fromX) * step / 20;
                            cy = fromY + (toY - fromY) * step / 20;
                            Send(MoveTo(cx, cy));
                            heldAt = new Point((int)cx, (int)cy);
                            Thread.Sleep(20);
                        }
                    } finally { LeftUp(cx, cy); }
                    break;
                }
                default: throw Fail("未知操作：" + method);
            }
        } finally { elements.Clear(); }
        // 给应用处理事件的时间；下一步仍由模型读取真实状态确认。
        Thread.Sleep(100);
        return new Dictionary<string, object> { { "ok", true } };
    }

    [STAThread]
    static int Main() {
        try { if (!Native.SetProcessDpiAwarenessContext(new IntPtr(-4))) Native.SetProcessDPIAware(); } catch { try { Native.SetProcessDPIAware(); } catch { } }
        UTF8Encoding utf8 = new UTF8Encoding(false);
        TextReader input = new StreamReader(Console.OpenStandardInput(), utf8);
        StreamWriter output = new StreamWriter(Console.OpenStandardOutput(), utf8) { AutoFlush = true, NewLine = "\n" };
        try {
            string line;
            while ((line = input.ReadLine()) != null) {
                if (line.Trim().Length == 0) continue;
                object id = null;
                Dictionary<string, object> reply;
                try {
                    Dictionary<string, object> request = Json.DeserializeObject(line) as Dictionary<string, object>;
                    object method;
                    if (request == null || !request.TryGetValue("method", out method) || !(method is string)) throw Fail("无效请求");
                    request.TryGetValue("id", out id);
                    object foreground;
                    foregroundAllowed = request.TryGetValue("foreground", out foreground) && foreground is bool && (bool)foreground;
                    object rawArgs;
                    Dictionary<string, object> args = request.TryGetValue("args", out rawArgs) && rawArgs is Dictionary<string, object>
                        ? (Dictionary<string, object>)rawArgs : new Dictionary<string, object>();
                    reply = new Dictionary<string, object> { { "id", id }, { "result", Execute((string)method, args) } };
                } catch (Exception error) {
                    reply = new Dictionary<string, object> { { "id", id }, { "error", error is ComputerError ? error.Message : error.GetType().Name + ": " + error.Message } };
                }
                output.WriteLine(Json.Serialize(reply));
            }
        } finally { ReleaseHeld(); }
        return 0;
    }
}
