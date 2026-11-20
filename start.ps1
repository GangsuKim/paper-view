$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path

# Parse CLI flags (--port 9000, --port=9000, -p 9000, -Port 9000, --host, --no-browser, --help)
$Port = if ($env:PAPERVIEW_PORT) { [int]$env:PAPERVIEW_PORT } else { 8787 }
$BindHost = "127.0.0.1"
$NoBrowser = $false

$i = 0
while ($i -lt $args.Count) {
    $arg = [string]$args[$i]
    switch -Regex ($arg) {
        '^(--port|-p|-Port)$' {
            if ($i + 1 -ge $args.Count) {
                Write-Host "[오류] --port 뒤에 포트 번호를 입력해주세요. (예: .\start.bat --port 9000)" -ForegroundColor Red
                exit 1
            }
            $i++
            if (-not [int]::TryParse([string]$args[$i], [ref]$Port) -or $Port -lt 1 -or $Port -gt 65535) {
                Write-Host "[오류] 유효하지 않은 포트 번호입니다: $($args[$i]) (1~65535)" -ForegroundColor Red
                exit 1
            }
        }
        '^--port=(.+)$' {
            if (-not [int]::TryParse($Matches[1], [ref]$Port) -or $Port -lt 1 -or $Port -gt 65535) {
                Write-Host "[오류] 유효하지 않은 포트 번호입니다: $($Matches[1]) (1~65535)" -ForegroundColor Red
                exit 1
            }
        }
        '^(--host|-Host)$' {
            if ($i + 1 -ge $args.Count) {
                Write-Host "[오류] --host 뒤에 바인딩 주소를 입력해주세요. (예: 127.0.0.1 또는 0.0.0.0)" -ForegroundColor Red
                exit 1
            }
            $i++
            $BindHost = [string]$args[$i]
        }
        '^--host=(.+)$' {
            $BindHost = $Matches[1]
        }
        '^--no-browser$' {
            $NoBrowser = $true
        }
        '^(--help|-h|/\?)$' {
            Write-Host "사용법: .\start.bat [--port <포트번호>] [--host <바인딩주소>] [--no-browser]" -ForegroundColor Cyan
            Write-Host "  --port, -p     실행 포트 지정 (기본값: 8787)"
            Write-Host "  --host         바인딩 호스트 지정 (기본값: 127.0.0.1)"
            Write-Host "  --no-browser   서버 시작 시 브라우저 자동 열기 생략"
            exit 0
        }
        default {
            Write-Host "[오류] 알 수 없는 옵션입니다: $arg (--help 로 사용법 확인)" -ForegroundColor Red
            exit 1
        }
    }
    $i++
}

Write-Host "=====================================================" -ForegroundColor Cyan
Write-Host "  PaperView — Auto Setup & Local Server Launcher" -ForegroundColor Cyan
Write-Host "=====================================================" -ForegroundColor Cyan

# 1. Check Python 3.10+
$PyCmd = $null
foreach ($cand in @("python", "py")) {
    if (Get-Command $cand -ErrorAction SilentlyContinue) {
        $PyCmd = $cand
        break
    }
}
if (-not $PyCmd) {
    Write-Host "[오류] Python 3.10 이상이 설치되어 있지 않습니다. https://www.python.org/downloads/ 에서 설치 후 다시 실행해주세요." -ForegroundColor Red
    exit 1
}

# 2. Auto-create backend/venv & install Python dependencies on first run
$VenvPython = Join-Path $Root "backend\venv\Scripts\python.exe"
$DepsStamp = Join-Path $Root "backend\venv\.paperview_ready"

if (-not (Test-Path $VenvPython)) {
    Write-Host "[1/3] Python 가상환경(backend/venv)을 생성하는 중입니다..." -ForegroundColor Yellow
    if ($PyCmd -eq "py") {
        & py -3 -m venv "$Root\backend\venv"
    } else {
        & python -m venv "$Root\backend\venv"
    }
}

if (-not (Test-Path $DepsStamp) -or ((Get-Item "$Root\backend\requirements.txt").LastWriteTime -gt (Get-Item $DepsStamp).LastWriteTime)) {
    Write-Host "[2/3] 백엔드 필수 패키지를 설치·동기화하는 중입니다..." -ForegroundColor Yellow
    & $VenvPython -m pip install --upgrade pip --quiet
    & $VenvPython -m pip install -r "$Root\backend\requirements.txt"
    # Optional Antigravity SDK (non-fatal if unavailable on older Python versions)
    try {
        & $VenvPython -m pip install "google-antigravity>=0.1.23" --quiet 2>$null
    } catch {
        # optional
    }
    Set-Content -Path $DepsStamp -Value "ok"
}

# 3. Auto-install & build frontend if dist/index.html is missing or older than frontend/src
$DistIndex = Join-Path $Root "frontend\dist\index.html"
$NeedFeBuild = -not (Test-Path $DistIndex)
if (-not $NeedFeBuild) {
    $DistTime = (Get-Item $DistIndex).LastWriteTime
    $NewerSrc = Get-ChildItem -Path "$Root\frontend\src","$Root\frontend\package.json" -Recurse -File -ErrorAction SilentlyContinue | Where-Object { $_.LastWriteTime -gt $DistTime } | Select-Object -First 1
    if ($NewerSrc) { $NeedFeBuild = $true }
}
if ($NeedFeBuild) {
    if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
        Write-Host "[오류] 프론트엔드 초기 빌드를 위해 Node.js(npm) 18 이상이 필요합니다: https://nodejs.org/" -ForegroundColor Red
        exit 1
    }
    Write-Host "[3/3] 프론트엔드 패키지 설치 및 프로덕션 번들을 빌드하는 중입니다..." -ForegroundColor Yellow
    Push-Location "$Root\frontend"
    if (-not (Test-Path "$Root\frontend\node_modules")) {
        npm install
    }
    npm run build
    Pop-Location
}

# 4. Check AI CLI availability hint
$HasClaude = [bool](Get-Command claude -ErrorAction SilentlyContinue) -or (Test-Path "$env:USERPROFILE\.local\bin\claude.exe")
$HasCodex = [bool](Get-Command codex -ErrorAction SilentlyContinue) -or [bool](Get-ChildItem "$env:USERPROFILE\.vscode\extensions\openai.chatgpt-*\bin\*\codex.exe" -ErrorAction SilentlyContinue)
if (-not $HasClaude -and -not $HasCodex) {
    Write-Host "[안내] 로컬 Claude CLI 또는 Codex CLI가 아직 감지되지 않았습니다." -ForegroundColor DarkYellow
    Write-Host "       - Claude 사용 시: claude 설치 후 'claude auth login'" -ForegroundColor DarkYellow
    Write-Host "       - ChatGPT 사용 시: 'npm i -g @openai/codex' 설치 후 'codex login'" -ForegroundColor DarkYellow
}

$BrowserHost = if ($BindHost -eq "0.0.0.0") { "127.0.0.1" } else { $BindHost }
$Url = "http://${BrowserHost}:$Port"

Write-Host ""
Write-Host "=====================================================" -ForegroundColor Green
Write-Host "  PaperView 실행 준비 완료! -> $Url" -ForegroundColor Green
Write-Host "  종료하려면 이 창에서 Ctrl + C 를 누르세요." -ForegroundColor DarkCyan
Write-Host "=====================================================" -ForegroundColor Green

if (-not $NoBrowser) {
    Start-Job -ScriptBlock {
        param($TargetUrl)
        Start-Sleep -Seconds 2
        Start-Process $TargetUrl
    } -ArgumentList $Url | Out-Null
}

Push-Location "$Root\backend"
$env:PYTHONIOENCODING = "utf-8"
$env:PAPERVIEW_PORT = "$Port"
$env:PAPERVIEW_HOST = "$BindHost"
& $VenvPython -m uvicorn app.main:app --host $BindHost --port $Port
Pop-Location
