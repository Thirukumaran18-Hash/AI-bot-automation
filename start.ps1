param(
    [switch]$Dev,
    [switch]$Rebuild,
    [int]$Port = 8000
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$Python = Join-Path $Root ".venv\Scripts\python.exe"
$Frontend = Join-Path $Root "frontend"
$Backend = Join-Path $Root "backend"
$DistIndex = Join-Path $Frontend "dist\index.html"

if (-not (Test-Path -LiteralPath $Python)) {
    throw "Python virtual environment not found at $Python. Create it and install backend/requirements.txt first."
}

if (-not (Test-Path -LiteralPath (Join-Path $Frontend "package.json"))) {
    throw "Frontend package.json not found at $Frontend."
}

if ($Dev) {
    if (-not (Test-Path -LiteralPath (Join-Path $Frontend "node_modules"))) {
        Write-Host "Installing frontend dependencies..."
        Push-Location $Frontend
        try {
            npm install
        }
        finally {
            Pop-Location
        }
    }

    $BackendCommand = "& '$Python' -m uvicorn app.main:app --reload --port $Port"
    $FrontendCommand = "npm run dev"

    Start-Process powershell.exe -ArgumentList "-NoExit", "-Command", $BackendCommand -WorkingDirectory $Backend
    Start-Process powershell.exe -ArgumentList "-NoExit", "-Command", $FrontendCommand -WorkingDirectory $Frontend

    Write-Host "Backend:  http://127.0.0.1:$Port/docs"
    Write-Host "Frontend: http://localhost:5173"
    exit 0
}

if ($Rebuild -or -not (Test-Path -LiteralPath $DistIndex)) {
    Write-Host "Preparing frontend build..."
    Push-Location $Frontend
    try {
        if (-not (Test-Path -LiteralPath (Join-Path $Frontend "node_modules"))) {
            npm install
        }
        npm run build
    }
    finally {
        Pop-Location
    }
}

Write-Host "Starting InternFlow AI at http://127.0.0.1:$Port"
Write-Host "API docs: http://127.0.0.1:$Port/docs"
Push-Location $Backend
try {
    & $Python -m uvicorn app.main:app --host 127.0.0.1 --port $Port
}
finally {
    Pop-Location
}
