$ErrorActionPreference = "Stop"

$Root = Resolve-Path (Join-Path $PSScriptRoot "..")
$BuildDir = Join-Path $Root "build"
$ClassesDir = Join-Path $BuildDir "classes"
$JarFile = Join-Path $BuildDir "personal-portfolio.jar"
$SourceDir = Join-Path $Root "src\main\java"
$ResourceDir = Join-Path $Root "src\main\resources"

if (-not $env:JAVA_HOME) {
    throw "JAVA_HOME is not set. Install JDK 26 and set JAVA_HOME."
}

$Javac = Join-Path $env:JAVA_HOME "bin\javac.exe"
$Jar = Join-Path $env:JAVA_HOME "bin\jar.exe"

if (-not (Test-Path $Javac)) {
    throw "javac.exe was not found at $Javac"
}

if (-not (Test-Path $Jar)) {
    throw "jar.exe was not found at $Jar"
}

function Assert-NativeCommandSucceeded {
    param(
        [string] $CommandName,
        [string] $FailureHint
    )

    if ($LASTEXITCODE -ne 0) {
        if ($FailureHint) {
            throw "$CommandName failed with exit code $LASTEXITCODE. $FailureHint"
        }

        throw "$CommandName failed with exit code $LASTEXITCODE."
    }
}

Remove-Item $BuildDir -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force $ClassesDir | Out-Null

$Sources = Get-ChildItem -Path $SourceDir -Filter "*.java" -Recurse | ForEach-Object { $_.FullName }
if (-not $Sources) {
    throw "No Java sources found under $SourceDir"
}

& $Javac --release 26 -encoding UTF-8 -d $ClassesDir $Sources
Assert-NativeCommandSucceeded "javac" ""

if (Test-Path $ResourceDir) {
    Copy-Item -Path (Join-Path $ResourceDir "*") -Destination $ClassesDir -Recurse -Force
}

& $Jar --create --file $JarFile --main-class com.veswa009.portfolio.PortfolioApplication -C $ClassesDir .
Assert-NativeCommandSucceeded "jar" "If build\personal-portfolio.jar is in use, stop the running Personal Portfolio server and run this script again."

Write-Host "Built $JarFile"
