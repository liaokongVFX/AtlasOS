using System;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

// A single user-triggered request owns the captured edit control until cancel or commit.
internal static class QuickInputHelper {
    [StructLayout(LayoutKind.Sequential)]
    private struct Rect { public int left, top, right, bottom; }
    [StructLayout(LayoutKind.Sequential)]
    private struct ThreadInfo {
        public int size, flags;
        public IntPtr active, focus, capture, menu, moveSize, caret;
        public Rect caretBounds;
    }

    [DllImport("user32.dll")] private static extern bool SetProcessDPIAware();
    [DllImport("user32.dll")] private static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr window, out uint pid);
    [DllImport("user32.dll")] private static extern bool GetGUIThreadInfo(uint thread, ref ThreadInfo info);
    [DllImport("user32.dll")] private static extern bool GetWindowRect(IntPtr window, out Rect rect);
    [DllImport("user32.dll")] private static extern short GetAsyncKeyState(int key);
    [DllImport("user32.dll")] private static extern bool IsWindowEnabled(IntPtr window);
    [DllImport("user32.dll")] private static extern bool IsWindowVisible(IntPtr window);
    [DllImport("user32.dll")] private static extern bool IsWindowUnicode(IntPtr window);
    [DllImport("user32.dll")] private static extern IntPtr GetAncestor(IntPtr window, uint flags);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern int GetClassName(IntPtr window, StringBuilder name, int size);
    [DllImport("user32.dll", EntryPoint = "GetWindowLongW")] private static extern int GetWindowLong(IntPtr window, int index);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern bool SetProp(IntPtr window, string name, IntPtr value);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern IntPtr GetProp(IntPtr window, string name);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern IntPtr RemoveProp(IntPtr window, string name);
    [DllImport("user32.dll", EntryPoint = "SendMessageTimeoutW", SetLastError = true)]
    private static extern IntPtr SendNumber(IntPtr edit, uint message, IntPtr wParam, IntPtr lParam, uint flags, uint timeout, out IntPtr result);
    [DllImport("user32.dll", EntryPoint = "SendMessageTimeoutW", SetLastError = true)]
    private static extern IntPtr GetSelection(IntPtr edit, uint message, out int start, out int end, uint flags, uint timeout, out IntPtr result);
    [DllImport("user32.dll", EntryPoint = "SendMessageTimeoutW", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern IntPtr ReplaceSelection(IntPtr edit, uint message, IntPtr undoable, string text, uint flags, uint timeout, out IntPtr result);

    private const uint SendFlags = 0x22; // SMTO_ABORTIFHUNG | SMTO_ERRORONEXIT
    private const uint Timeout = 500;
    private static string request;
    private static readonly string marker = "AtlasOS.QuickInput." + Guid.NewGuid().ToString("N");
    private static IntPtr root, edit, focus;
    private static uint processId, threadId;
    private static int selectionStart, selectionEnd;
    private static bool rich;

    private static void Clear() {
        if (edit != IntPtr.Zero) RemoveProp(edit, marker);
        root = edit = focus = IntPtr.Zero;
        request = null;
    }

    private static IntPtr Focus() {
        var info = new ThreadInfo { size = Marshal.SizeOf(typeof(ThreadInfo)) };
        return threadId != 0 && GetGUIThreadInfo(threadId, ref info) ? info.focus : IntPtr.Zero;
    }

    private static bool IsCurrent() {
        uint pid;
        return root != IntPtr.Zero && GetForegroundWindow() == root &&
            GetWindowThreadProcessId(root, out pid) == threadId && pid == processId && Focus() == focus;
    }

    private static bool Selection(out int start, out int end) {
        IntPtr unused;
        return GetSelection(edit, 0xb0, out start, out end, SendFlags, Timeout, out unused) != IntPtr.Zero;
    }

    private static string Capture(string id) {
        Clear();
        request = id;
        root = GetForegroundWindow();
        if (root == IntPtr.Zero) return "unavailable";
        threadId = GetWindowThreadProcessId(root, out processId);
        focus = Focus();
        var name = new StringBuilder(128);
        GetClassName(focus, name, name.Capacity);
        var cls = name.ToString().ToUpperInvariant();
        rich = cls == "RICHEDIT20W" || cls == "RICHEDIT50W" || cls == "RICHEDITD2DPT";
        if ((cls == "EDIT" || rich) && IsWindowUnicode(focus) && GetAncestor(focus, 2) == root &&
            SetProp(focus, marker, (IntPtr)1)) {
            edit = focus;
            if (!Selection(out selectionStart, out selectionEnd)) {
                RemoveProp(edit, marker);
                edit = IntPtr.Zero;
            }
        }
        Rect bounds;
        GetWindowRect(root, out bounds);
        return String.Format("captured {0} {1} {2} {3}", bounds.left, bounds.top, bounds.right, bounds.bottom);
    }

    private static bool WaitForKeysReleased() {
        var timer = System.Diagnostics.Stopwatch.StartNew();
        do {
            int key = 8;
            while (key <= 254 && GetAsyncKeyState(key) >= 0) ++key;
            if (key > 254) return true;
            Thread.Sleep(10);
        } while (timer.ElapsedMilliseconds < 5000);
        return false;
    }

    private static string Insert(IntPtr panel, string text) {
        if (edit == IntPtr.Zero || text.IndexOf('\0') >= 0 || !WaitForKeysReleased()) return "unavailable";
        // Minimizing the palette lets Windows reactivate its previous foreground window.
        if (panel != IntPtr.Zero) {
            for (int i = 0; i < 25 && !IsCurrent(); ++i) {
                var foreground = GetForegroundWindow();
                if (foreground != IntPtr.Zero && foreground != panel && foreground != root) break;
                Thread.Sleep(10);
            }
        }
        if (!IsCurrent() || GetProp(edit, marker) == IntPtr.Zero || !IsWindowEnabled(edit) || !IsWindowVisible(edit)) return "unavailable";
        int style = GetWindowLong(edit, -16);
        // Unsupported transforms, numeric fields, password fields and read-only controls.
        if ((style & (0x8 | 0x10 | 0x20 | 0x800 | 0x2000)) != 0) return "unavailable";
        string logical = text.Replace("\r\n", "\n").Replace('\r', '\n');
        if ((style & 4) == 0 && logical.Contains("\n")) return "unavailable";
        string native = logical.Replace("\n", rich ? "\r" : "\r\n");
        int start, end;
        IntPtr length, limit, unused;
        if (!Selection(out start, out end) || start != selectionStart || end != selectionEnd ||
            SendNumber(edit, 14, IntPtr.Zero, IntPtr.Zero, SendFlags, Timeout, out length) == IntPtr.Zero ||
            SendNumber(edit, 0xd5, IntPtr.Zero, IntPtr.Zero, SendFlags, Timeout, out limit) == IntPtr.Zero ||
            length.ToInt64() - (end - start) + native.Length > limit.ToInt64()) return "unavailable";
        if (!IsCurrent() || GetProp(edit, marker) == IntPtr.Zero) return "unavailable";
        if (ReplaceSelection(edit, 0xc2, (IntPtr)1, native, SendFlags, Timeout, out unused) == IntPtr.Zero) {
            return Marshal.GetLastWin32Error() == 5 ? "unavailable" : "unknown";
        }
        int afterStart, afterEnd;
        return Selection(out afterStart, out afterEnd) && afterStart == start + native.Length && afterStart == afterEnd
            ? "inserted" : "unknown";
    }

    public static void Main() {
        SetProcessDPIAware();
        Console.WriteLine("ready");
        try {
            string line;
            while ((line = Console.ReadLine()) != null) {
                var args = line.Split(new char[] {' '}, 4);
                string result = "unavailable";
                try {
                    if (args[0] == "release-keys") result = WaitForKeysReleased() ? "released" : "unavailable";
                    else if (args[0] == "capture") result = Capture(args[1]);
                    else if (args[1] == request) {
                        if (args[0] == "current") result = IsCurrent() ? "current" : "unavailable";
                        if (args[0] == "insert") {
                            try { result = Insert(new IntPtr(Int64.Parse(args[2])), Encoding.Unicode.GetString(Convert.FromBase64String(args[3]))); }
                            finally { Clear(); }
                        }
                        if (args[0] == "cancel") Clear();
                    }
                } catch { result = args[0] == "insert" ? "unknown" : "unavailable"; }
                Console.WriteLine(result);
            }
        } finally { Clear(); }
    }
}
