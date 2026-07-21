param(
    [string]$Destino = "C:\Users\Mauricio\Documents\EMS\PAINEL DO NORTE - NOVO",
    [string]$Repositorio = "https://github.com/mauriciobarrosaguiar/painel-comercial-equipe-norte.git",
    [switch]$RestaurarUltimoBackup
)

$ErrorActionPreference = "Stop"
$agora = Get-Date -Format "yyyy-MM-dd_HH-mm-ss"
$pastas = @("sistema-atual", "legado", "backups", "bases", "templates", "migrations", "scripts", "relatorios", "documentacao", "logs")

foreach ($pasta in $pastas) {
    New-Item -ItemType Directory -Force -Path (Join-Path $Destino $pasta) | Out-Null
}

$log = Join-Path $Destino "logs\sincronizacao_$agora.log"
function Registrar([string]$Mensagem) {
    $linha = "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') | $Mensagem"
    Add-Content -Path $log -Value $linha -Encoding UTF8
    Write-Host $linha
}

$sistema = Join-Path $Destino "sistema-atual"
$backups = Join-Path $Destino "backups"

if ($RestaurarUltimoBackup) {
    $ultimo = Get-ChildItem -Path $backups -Filter "sistema-atual_*.zip" | Sort-Object LastWriteTime -Descending | Select-Object -First 1
    if (-not $ultimo) { throw "Nenhum backup local foi encontrado." }
    if (Test-Path $sistema) { Remove-Item -Recurse -Force $sistema }
    New-Item -ItemType Directory -Force -Path $sistema | Out-Null
    Expand-Archive -Path $ultimo.FullName -DestinationPath $sistema -Force
    Registrar "Backup restaurado: $($ultimo.Name)"
    exit 0
}

if ((Test-Path $sistema) -and (Get-ChildItem $sistema -Force | Select-Object -First 1)) {
    $backup = Join-Path $backups "sistema-atual_$agora.zip"
    $temporario = Join-Path $env:TEMP "painel_norte_backup_$agora"
    New-Item -ItemType Directory -Force -Path $temporario | Out-Null
    robocopy $sistema $temporario /E /XD .git node_modules .venv .runtime_bussola /XF .env "*.key" "*.pem" "*token*" "*secret*" | Out-Null
    Compress-Archive -Path "$temporario\*" -DestinationPath $backup -CompressionLevel Optimal
    Remove-Item -Recurse -Force $temporario
    Registrar "Backup criado: $backup"
}

if (-not (Test-Path (Join-Path $sistema ".git"))) {
    if ((Get-ChildItem $sistema -Force -ErrorAction SilentlyContinue | Select-Object -First 1)) {
        $preservado = Join-Path $Destino "legado\arquivos_locais_antes_git_$agora"
        New-Item -ItemType Directory -Force -Path $preservado | Out-Null
        robocopy $sistema $preservado /E | Out-Null
        Registrar "Arquivos locais anteriores preservados em: $preservado"
        Get-ChildItem $sistema -Force | Remove-Item -Recurse -Force
    }
    git clone $Repositorio $sistema
    Registrar "Repositório clonado em sistema-atual."
} else {
    Push-Location $sistema
    try {
        git fetch origin main
        $alteracoes = git status --porcelain
        if ($alteracoes) {
            $patch = Join-Path $backups "alteracoes_locais_$agora.patch"
            git diff | Out-File -FilePath $patch -Encoding UTF8
            Registrar "Alterações locais preservadas em: $patch"
        }
        git pull --ff-only origin main
        Registrar "Código atualizado a partir da branch main."
    } finally { Pop-Location }
}

$copias = @(
    @{ Origem = "web\migrations"; Destino = "migrations" },
    @{ Origem = "scripts"; Destino = "scripts" },
    @{ Origem = "docs"; Destino = "documentacao" },
    @{ Origem = "templates"; Destino = "templates" }
)
foreach ($item in $copias) {
    $origem = Join-Path $sistema $item.Origem
    $destinoCopia = Join-Path $Destino $item.Destino
    if (Test-Path $origem) {
        robocopy $origem $destinoCopia /E /XD .git node_modules .venv /XF .env "*.key" "*.pem" "*token*" "*secret*" | Out-Null
        Registrar "Sincronizado: $($item.Origem) -> $($item.Destino)"
    }
}

Push-Location $sistema
try {
    $commit = git rev-parse HEAD
    $status = git status --short
    Registrar "Commit local: $commit"
    if ($status) { Registrar "Existem alterações locais não enviadas ao GitHub." } else { Registrar "Pasta local sem alterações pendentes." }
} finally { Pop-Location }

Registrar "Sincronização concluída com segurança."
Write-Host "Log: $log"
