using System;
using System.Runtime.InteropServices;
using System.Windows.Automation;
using System.Windows.Automation.Text;
using System.Windows.Forms;

// A browser can use one HWND for every field in a tab. Keep the actual UIA element
// and, when the provider exposes one, its selection. Never read or rewrite its value.
internal sealed class QuickInputPaste {
    private readonly AutomationElement element;
    private readonly TextPatternRange selection;
    private readonly IntPtr surface;
    private static readonly Condition visibleEditor = new AndCondition(
        new PropertyCondition(AutomationElement.IsOffscreenProperty, false),
        new OrCondition(new PropertyCondition(AutomationElement.ControlTypeProperty, ControlType.Edit),
            new PropertyCondition(AutomationElement.ControlTypeProperty, ControlType.Document),
            new PropertyCondition(AutomationElement.IsPasswordProperty, true),
            new PropertyCondition(AutomationElement.IsTextPatternAvailableProperty, true),
            new PropertyCondition(AutomationElement.IsValuePatternAvailableProperty, true)));

    private QuickInputPaste(AutomationElement element, TextPatternRange selection, IntPtr surface) {
        this.element = element;
        this.selection = selection;
        this.surface = surface;
    }

    public static QuickInputPaste Capture(string windowClass, IntPtr focus) {
        // These terminals have application-specific paste chords and newline semantics.
        switch (windowClass.ToUpperInvariant()) {
            case "CONSOLEWINDOWCLASS": case "CASCADIA_HOSTING_WINDOW_CLASS":
            case "MINTTY": case "VIRTUALCONSOLECLASS": case "PSEUDOCONSOLEWINDOW":
                return null;
        }
        try {
            var field = AutomationElement.FocusedElement;
            TextPatternRange range;
            if (Writable(field, out range)) return new QuickInputPaste(field, range, IntPtr.Zero);
            return IsOpaqueSurface(field, focus) ? new QuickInputPaste(field, null, focus) : null;
        } catch (ElementNotAvailableException) { return null; }
          catch (InvalidOperationException) { return null; }
          catch (COMException) { return null; }
    }

    // A custom-drawn application may expose only its focused native window or pane.
    // A provider that reports an editor, read-only range, or actionable control
    // already told us what it is. Never downgrade a rejected field to a window.
    private static bool IsOpaqueSurface(AutomationElement field, IntPtr focus) {
        if (field == null) return false;
        var info = field.Current;
        if (!info.HasKeyboardFocus || !info.IsEnabled || info.IsPassword || info.IsOffscreen ||
            info.NativeWindowHandle == 0 || new IntPtr(info.NativeWindowHandle) != focus) return false;
        var type = info.ControlType;
        if (type != ControlType.Window && type != ControlType.Pane && type != ControlType.Custom) return false;
        foreach (var pattern in field.GetSupportedPatterns()) {
            if (pattern != WindowPattern.Pattern && pattern != TransformPattern.Pattern &&
                pattern != ScrollPattern.Pattern && pattern != ScrollItemPattern.Pattern) return false;
        }
        return field.FindFirst(TreeScope.Descendants, visibleEditor) == null;
    }

    private static bool Writable(AutomationElement field, out TextPatternRange range) {
        range = null;
        if (field == null) return false;
        var info = field.Current;
        if (!info.IsEnabled || info.IsPassword || info.IsOffscreen) return false;
        object value, text;
        var hasValue = field.TryGetCurrentPattern(ValuePattern.Pattern, out value);
        if (hasValue && ((ValuePattern)value).Current.IsReadOnly) return false;
        bool valueEditor = hasValue && (info.ControlType == ControlType.Edit || info.ControlType == ControlType.Document ||
            info.ControlType == ControlType.ComboBox);
        if (field.TryGetCurrentPattern(TextPattern.Pattern, out text)) {
            var pattern = (TextPattern)text;
            if (pattern.SupportedTextSelection != SupportedTextSelection.None) {
                var ranges = pattern.GetSelection();
                if (ranges.Length != 1) return false;
                range = ranges[0];
            }
            // Rich HTML editors often expose a Group with a writable text range.
            if (range != null) {
                object readOnly = range.GetAttributeValue(TextPattern.IsReadOnlyAttribute);
                if (readOnly is bool) return !(bool)readOnly;
            }
        }
        return valueEditor;
    }

    public bool HasFocus() {
        try { return Automation.Compare(element, AutomationElement.FocusedElement); }
        catch (ElementNotAvailableException) { return false; }
        catch (ArgumentException) { return false; }
        catch (COMException) { return false; }
    }

    private bool SelectionMatches() {
        if (surface != IntPtr.Zero) return IsOpaqueSurface(element, surface);
        TextPatternRange current;
        return Writable(element, out current) && (selection == null || (current != null && selection.Compare(current)));
    }

    public string Insert(string text, Func<bool> stillCurrent) {
        try {
            // Browser-hosted xterm uses a textarea even when the shell will execute newlines.
            if ((text.Contains("\r") || text.Contains("\n")) &&
                Array.IndexOf(element.Current.ClassName.Split(' '), "xterm-helper-textarea") >= 0) return "unavailable";
            if (!SelectionMatches() || !stillCurrent()) return "unavailable";
            // Persist the snippet for asynchronous paste handlers. A timer-based restore
            // could paste the old contents or overwrite something the user copied later.
            Clipboard.SetDataObject(new DataObject(DataFormats.UnicodeText, text), true, 3, 15);
            uint sequence = GetClipboardSequenceNumber();
            if (sequence == 0 || !SelectionMatches() || !stillCurrent() || GetClipboardSequenceNumber() != sequence) return "unavailable";
        } catch (InvalidOperationException) { return "unavailable"; }
          catch (ElementNotAvailableException) { return "unavailable"; }
          catch (ExternalException) { return "unavailable"; }
        var keys = new [] { Key(0x11, false), Key(0x56, false), Key(0x56, true), Key(0x11, true) };
        int size = Marshal.SizeOf(typeof(Input));
        uint sent = SendInput((uint)keys.Length, keys, size);
        if (sent == keys.Length) return "dispatched";
        if (sent == 0) return "unavailable";
        // Release only keys already sent. Never repeat a possibly delivered paste.
        var release = sent == 2 ? new [] { keys[2], keys[3] } : new [] { keys[3] };
        SendInput((uint)release.Length, release, size);
        return "unknown";
    }

    [DllImport("user32.dll")] private static extern uint GetClipboardSequenceNumber();
    [DllImport("user32.dll")] private static extern uint SendInput(uint count, Input[] inputs, int size);

    // INPUT's union must also fit MOUSEINPUT on both 32- and 64-bit Windows.
    [StructLayout(LayoutKind.Sequential)]
    private struct Mouse { public int x, y; public uint data, flags, time; public UIntPtr extra; }
    [StructLayout(LayoutKind.Sequential)]
    private struct Keyboard { public ushort key, scan; public uint flags, time; public UIntPtr extra; }
    [StructLayout(LayoutKind.Explicit)]
    private struct Payload { [FieldOffset(0)] public Mouse mouse; [FieldOffset(0)] public Keyboard keyboard; }
    [StructLayout(LayoutKind.Sequential)]
    private struct Input { public uint type; public Payload data; }
    private static Input Key(ushort code, bool up) {
        return new Input { type = 1, data = new Payload { keyboard = new Keyboard { key = code, flags = up ? 2u : 0u } } };
    }
}
