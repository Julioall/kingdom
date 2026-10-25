$ErrorActionPreference = 'SilentlyContinue'
while ($true) {
  $processes = @(Get-Process -Name 'ollama', 'ollama_llama_server')

  $cpu = 0.0
  $workingSet = 0.0
  foreach ($process in $processes) {
    if ($null -ne $process.CPU) { $cpu += [double]$process.CPU }
    $workingSet += [double]$process.WorkingSet64
  }

  $sample = [pscustomobject]@{
    cpuMs = [math]::Round($cpu * 1000, 2)
    workingSetBytes = [math]::Round($workingSet)
    processCount = $processes.Count
  }
  [Console]::Out.WriteLine(($sample | ConvertTo-Json -Compress))
  Start-Sleep -Milliseconds 100
}
