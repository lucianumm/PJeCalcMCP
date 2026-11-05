# PJe-Calc MCP - garante o Node.js (20+) e chama o instalador.
# Usado pelos arquivos .bat da pasta principal. Uso: iniciar.ps1 instalar|conferir|desinstalar
param([string]$Modo = 'instalar')
$ErrorActionPreference = 'Stop'
# INSTALADOR_SIM=1: responde sim a tudo (testes automatizados)
$sim = ($env:INSTALADOR_SIM -eq '1')
$raiz = Split-Path -Parent $PSScriptRoot
$nodeLocal = Join-Path $raiz 'node\node.exe'

function Test-NodeOk([string]$exe) {
  try {
    $v = & $exe -v 2>$null
    return ([int]($v.TrimStart('v').Split('.')[0]) -ge 20)
  } catch { return $false }
}

$node = $null
if ((Test-Path $nodeLocal) -and (Test-NodeOk $nodeLocal)) { $node = $nodeLocal }
else {
  $cmd = Get-Command node -ErrorAction SilentlyContinue
  if ($cmd -and (Test-NodeOk $cmd.Source)) { $node = $cmd.Source }
}

if (-not $node) {
  if ($Modo -ne 'instalar') { Write-Host 'Node.js nao encontrado. Rode primeiro "Instalar PJe-Calc MCP.bat".'; exit 1 }
  Write-Host ''
  Write-Host 'O PJe-Calc MCP precisa do Node.js (gratuito).'
  Write-Host 'Vou baixar a versao portatil oficial (nodejs.org, cerca de 30 MB) para dentro desta pasta.'
  Write-Host 'Nada e instalado no Windows e nao e preciso ser administrador.'
  if (-not $sim) {
    $r = Read-Host 'Continuar? [S/n]'
    if ($r -match '^(n|nao)$') { exit 1 }
  }
  [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
  $ProgressPreference = 'SilentlyContinue'
  $indice = Invoke-RestMethod 'https://nodejs.org/dist/index.json'
  $v = ($indice | Where-Object { $_.lts -and ($_.files -contains 'win-x64-zip') } | Select-Object -First 1).version
  if (-not $v) { throw 'Nao consegui descobrir a versao atual do Node.js em nodejs.org.' }
  Write-Host "Baixando Node.js $v ..."
  $zip = Join-Path $env:TEMP "node-$v-win-x64.zip"
  Invoke-WebRequest "https://nodejs.org/dist/$v/node-$v-win-x64.zip" -OutFile $zip -UseBasicParsing
  $somas = (Invoke-WebRequest "https://nodejs.org/dist/$v/SHASUMS256.txt" -UseBasicParsing).Content
  $linha = ($somas -split "`n") | Where-Object { $_ -match "node-$v-win-x64\.zip" } | Select-Object -First 1
  $esperado = ($linha -split '\s+')[0].ToLower()
  $obtido = (Get-FileHash $zip -Algorithm SHA256).Hash.ToLower()
  if ($obtido -ne $esperado) { Remove-Item $zip -Force; throw 'O download do Node.js veio corrompido (checksum diferente). Tente de novo.' }
  $tmp = Join-Path $env:TEMP "node-$v-extraido"
  if (Test-Path $tmp) { Remove-Item $tmp -Recurse -Force }
  Expand-Archive $zip -DestinationPath $tmp -Force
  $destino = Join-Path $raiz 'node'
  if (Test-Path $destino) { Remove-Item $destino -Recurse -Force }
  Move-Item (Join-Path $tmp "node-$v-win-x64") $destino
  Remove-Item $zip -Force -ErrorAction SilentlyContinue
  Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue
  $node = $nodeLocal
  Write-Host "Node.js $v pronto em $destino"
}

if ($sim) { & $node (Join-Path $PSScriptRoot 'instalador.mjs') $Modo --sim }
else { & $node (Join-Path $PSScriptRoot 'instalador.mjs') $Modo }
exit $LASTEXITCODE
