import { spawn } from 'node:child_process'

export type DoubleCtrlSequenceState = {
  lastCtrlUpAt: number | null
}

export type DoubleCtrlKeyEvent = {
  key: 'Control' | 'Other'
  timestamp: number
}

export type DoubleCtrlSequenceResult = {
  state: DoubleCtrlSequenceState
  triggered: boolean
}

type StartHookOptions = {
  platform?: NodeJS.Platform
  spawnImpl?: typeof spawn
}

export type WindowsDoubleCtrlHookHandle = {
  dispose: () => void
}

const DOUBLE_CTRL_INTERVAL_MS = 450
const DOUBLE_CTRL_STDOUT_TOKEN = 'atlas-double-ctrl'

const WINDOWS_DOUBLE_CTRL_HOOK_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -ReferencedAssemblies System.Windows.Forms -TypeDefinition @"
using System;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Windows.Forms;

public static class AtlasDoubleCtrlHookRunner {
  private const int WH_KEYBOARD_LL = 13;
  private const int WM_KEYUP = 0x0101;
  private const int WM_SYSKEYUP = 0x0105;
  private const int VK_CONTROL = 0x11;
  private const int VK_LCONTROL = 0xA2;
  private const int VK_RCONTROL = 0xA3;
  private const double DOUBLE_CTRL_INTERVAL_MS = 450;

  private static LowLevelKeyboardProc proc = HookCallback;
  private static IntPtr hookId = IntPtr.Zero;
  private static DateTime lastCtrlUp = DateTime.MinValue;

  public static void Run() {
    hookId = SetHook(proc);
    if (hookId == IntPtr.Zero) {
      throw new InvalidOperationException("Failed to install AtlasOS double Ctrl keyboard hook.");
    }

    Application.Run();
    UnhookWindowsHookEx(hookId);
  }

  private static IntPtr SetHook(LowLevelKeyboardProc proc) {
    using (Process currentProcess = Process.GetCurrentProcess())
    using (ProcessModule currentModule = currentProcess.MainModule) {
      return SetWindowsHookEx(WH_KEYBOARD_LL, proc, GetModuleHandle(currentModule.ModuleName), 0);
    }
  }

  private static IntPtr HookCallback(int nCode, IntPtr wParam, IntPtr lParam) {
    if (nCode >= 0 && (wParam == (IntPtr) WM_KEYUP || wParam == (IntPtr) WM_SYSKEYUP)) {
      int vkCode = Marshal.ReadInt32(lParam);
      bool isCtrl = vkCode == VK_CONTROL || vkCode == VK_LCONTROL || vkCode == VK_RCONTROL;

      if (isCtrl) {
        DateTime now = DateTime.UtcNow;
        if (lastCtrlUp != DateTime.MinValue && (now - lastCtrlUp).TotalMilliseconds <= DOUBLE_CTRL_INTERVAL_MS) {
          Console.WriteLine("atlas-double-ctrl");
          Console.Out.Flush();
          lastCtrlUp = DateTime.MinValue;
        } else {
          lastCtrlUp = now;
        }
      } else {
        lastCtrlUp = DateTime.MinValue;
      }
    }

    return CallNextHookEx(hookId, nCode, wParam, lParam);
  }

  private delegate IntPtr LowLevelKeyboardProc(int nCode, IntPtr wParam, IntPtr lParam);

  [DllImport("user32.dll", CharSet = CharSet.Auto, SetLastError = true)]
  private static extern IntPtr SetWindowsHookEx(int idHook, LowLevelKeyboardProc lpfn, IntPtr hMod, uint dwThreadId);

  [DllImport("user32.dll", CharSet = CharSet.Auto, SetLastError = true)]
  [return: MarshalAs(UnmanagedType.Bool)]
  private static extern bool UnhookWindowsHookEx(IntPtr hhk);

  [DllImport("user32.dll", CharSet = CharSet.Auto, SetLastError = true)]
  private static extern IntPtr CallNextHookEx(IntPtr hhk, int nCode, IntPtr wParam, IntPtr lParam);

  [DllImport("kernel32.dll", CharSet = CharSet.Auto, SetLastError = true)]
  private static extern IntPtr GetModuleHandle(string lpModuleName);
}
"@

[AtlasDoubleCtrlHookRunner]::Run()
`.trim()

export function nextDoubleCtrlSequenceState(
  state: DoubleCtrlSequenceState,
  event: DoubleCtrlKeyEvent,
  intervalMs = DOUBLE_CTRL_INTERVAL_MS
): DoubleCtrlSequenceResult {
  if (event.key !== 'Control') {
    return { state: { lastCtrlUpAt: null }, triggered: false }
  }

  if (state.lastCtrlUpAt !== null && event.timestamp - state.lastCtrlUpAt <= intervalMs) {
    return { state: { lastCtrlUpAt: null }, triggered: true }
  }

  return { state: { lastCtrlUpAt: event.timestamp }, triggered: false }
}

export function startWindowsDoubleCtrlHook(
  onTrigger: () => void,
  { platform = process.platform, spawnImpl = spawn }: StartHookOptions = {}
): WindowsDoubleCtrlHookHandle {
  if (platform !== 'win32') return { dispose: () => undefined }

  const child = spawnImpl(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-Sta', '-ExecutionPolicy', 'Bypass', '-Command', WINDOWS_DOUBLE_CTRL_HOOK_SCRIPT],
    {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    }
  )

  let stdoutBuffer = ''

  child.stdout.setEncoding('utf8')
  child.stdout.on('data', (chunk: string) => {
    stdoutBuffer += chunk
    const lines = stdoutBuffer.split(/\r?\n/)
    stdoutBuffer = lines.pop() ?? ''

    for (const line of lines) {
      if (line.trim() === DOUBLE_CTRL_STDOUT_TOKEN) onTrigger()
    }
  })

  child.stderr.setEncoding('utf8')
  child.stderr.on('data', (chunk: string) => {
    const trimmed = chunk.trim()
    if (trimmed) console.warn('AtlasOS double Ctrl hook:', trimmed)
  })

  child.on('error', (error) => {
    console.warn('Failed to start AtlasOS double Ctrl hook:', error)
  })

  return {
    dispose: () => {
      if (!child.killed) child.kill()
    }
  }
}
