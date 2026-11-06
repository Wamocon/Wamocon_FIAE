# FIAE-Inhalte von der Preview nach Production übertragen (scripts/db/fiae-content-promote.mjs).
#
# Aufruf im Repo-Ordner (PowerShell):
#   .\scripts\db\promote-fiae-production.ps1            # Trockenlauf, schreibt nichts
#   .\scripts\db\promote-fiae-production.ps1 -Apply     # echtes Übertragen
#
# Liest PRODUCTION_ADMIN_DB_URL aus .env.local und stellt sie auf den Session Pooler um (IPv4, Benutzer
# postgres.<Projekt-Ref>). Es wird kein Wert ausgegeben. Das Werkzeug ersetzt Dokumente per Id und Quizfragen an
# Ort und Stelle, löscht nie ein Dokument oder Quiz und fasst Azubi-Daten nicht an (Kopf von fiae-content-promote.mjs).
# Der Bericht für den Rückweg liegt unter logs/fiae-promote-<Zeit>.json (rollback <Bericht> --apply).
# Reihenfolge: erst die Bereinigung der Dubletten (supabase/manual/20261106_*), dann dieses Skript, dann die HAI.
param([switch]$Apply)
$ErrorActionPreference = 'Stop'
Set-Location (Resolve-Path (Join-Path $PSScriptRoot '..\..'))

$projectRef = 'ngpsgwwlnlliphfgtrya'
$poolerHost = 'aws-1-eu-west-1.pooler.supabase.com'

$line = Get-Content .env.local | Where-Object { $_ -match '^PRODUCTION_ADMIN_DB_URL=' } | Select-Object -First 1
if (-not $line) { throw 'PRODUCTION_ADMIN_DB_URL fehlt in .env.local' }
$url = $line.Substring($line.IndexOf('=') + 1).Trim().Trim('"')
$url = $url -replace '^(postgres(ql)?://)postgres:', ('${1}postgres.' + $projectRef + ':')
$url = $url -replace ('db\.' + $projectRef + '\.supabase\.co'), $poolerHost
$env:DB_CONNECTION_STRING = $url

New-Item -ItemType Directory -Force -Path logs | Out-Null
$report = Join-Path 'logs' ('fiae-promote-' + (Get-Date -Format 'yyyy-MM-dd_HH-mm-ss') + '.json')
$cmd = @('scripts/db/fiae-content-promote.mjs', 'run', '--target', 'public', '--out', $report)

if ($Apply) {
  $answer = Read-Host 'Wirklich nach Production schreiben? Zum Bestätigen "ja" eingeben'
  if ($answer -ne 'ja') { Write-Host 'Abgebrochen.'; exit 1 }
  $env:FIAE_PROMOTE_APPROVED = 'yes'
  $cmd += @('--apply', '--confirm-host', $poolerHost)
} else {
  Write-Host 'Trockenlauf (schreibt nichts). Mit -Apply wird geschrieben.'
}

node @cmd
if ($LASTEXITCODE -ne 0) { throw "Das Werkzeug ist mit Fehler beendet (Exit $LASTEXITCODE)." }
if ($Apply) { Write-Host "Fertig. Bericht für den Rückweg: $report" }
