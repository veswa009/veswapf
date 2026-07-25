$ErrorActionPreference = "Stop"

$Root = Resolve-Path (Join-Path $PSScriptRoot "..")
$BuildScript = Join-Path $PSScriptRoot "build.ps1"

& $BuildScript

if (-not $env:JAVA_HOME) {
    throw "JAVA_HOME is not set. Install JDK 26 and set JAVA_HOME."
}

$Java = Join-Path $env:JAVA_HOME "bin\java.exe"
$JarFile = Join-Path $Root "build\personal-portfolio.jar"

if (-not (Test-Path $Java)) {
    throw "java.exe was not found at $Java"
}

function Test-PortAvailable {
    param([int] $Port)

    $Listener = $null
    try {
        $Listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Any, $Port)
        $Listener.Start()
        return $true
    }
    catch {
        return $false
    }
    finally {
        if ($Listener) {
            $Listener.Stop()
        }
    }
}

if ($env:PORT) {
    $Port = [int] $env:PORT
    if (-not (Test-PortAvailable $Port)) {
        throw "Port $Port is already in use. Stop the existing process or run with another port, for example: `$env:PORT='8081'; powershell -ExecutionPolicy Bypass -File .\scripts\run.ps1"
    }
}
else {
    $Port = 8080
    while (-not (Test-PortAvailable $Port)) {
        $Port++
        if ($Port -gt 8099) {
            throw "No free port found between 8080 and 8099. Set `$env:PORT to a free port and run again."
        }
    }
    $env:PORT = [string] $Port
}

Write-Host "Starting Personal Portfolio at http://localhost:$Port"
& $Java -jar $JarFile
