using System;
using System.Diagnostics;
using System.IO;

var logDir = Path.Combine(
    Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
    "AutoZoomScheduler",
    "logs");
Directory.CreateDirectory(logDir);
var logPath = Path.Combine(logDir, "sleep-mode.log");

void Log(string message)
{
    var line = $"[{DateTime.Now:yyyy-MM-dd HH:mm:ss}] {message}{Environment.NewLine}";
    File.AppendAllText(logPath, line);
}

Log("Sleep Mode invoked; issuing Windows hibernate.");

var psi = new ProcessStartInfo
{
    FileName = "shutdown.exe",
    Arguments = "/h /f",
    UseShellExecute = false,
    RedirectStandardOutput = false,
    RedirectStandardError = false,
    CreateNoWindow = true,
};

try
{
    using var process = Process.Start(psi);
    if (process is null)
    {
        Log("shutdown.exe failed to start.");
        Environment.ExitCode = 1;
        return;
    }

    process.WaitForExit();
    Log($"shutdown.exe exited with code {process.ExitCode}.");
    Environment.ExitCode = process.ExitCode;
}
catch (Exception ex)
{
    Log($"Hibernate invocation failed: {ex.Message}");
    Console.Error.WriteLine(ex.Message);
    Environment.ExitCode = 1;
}
