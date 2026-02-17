$ErrorActionPreference = "Continue"

# =============================================================
# Setup GCP - Cloud Run + Cloud Build + Secret Manager
# Le os valores do .env automaticamente
# Uso: powershell -ExecutionPolicy Bypass -File scripts/setup-gcp.ps1
# =============================================================

$EnvFile = Join-Path $PSScriptRoot "..\.env"

if (-not (Test-Path $EnvFile)) {
    Write-Error "Erro: arquivo .env nao encontrado em $EnvFile"
    exit 1
}

# Carrega vars do .env
$envContent = Get-Content $EnvFile -Raw
function Get-EnvVar($name) {
    if ($envContent -match "(?m)^${name}=`"?(.*?)`"?\s*$") {
        return $Matches[1]
    }
    return $null
}

$PROJECT_ID = Get-EnvVar "FIREBASE_PROJECT_ID"
if (-not $PROJECT_ID) {
    Write-Error "Erro: FIREBASE_PROJECT_ID nao encontrado no .env"
    exit 1
}

Write-Host ""
Write-Host "=========================================" -ForegroundColor Cyan
Write-Host "  Setup GCP - Projeto: $PROJECT_ID" -ForegroundColor Cyan
Write-Host "=========================================" -ForegroundColor Cyan
Write-Host ""

# ---- 1. Definir projeto ativo ----
Write-Host "[1/5] Definindo projeto ativo..." -ForegroundColor Yellow
gcloud config set project $PROJECT_ID
if ($LASTEXITCODE -ne 0) { exit 1 }

# ---- 2. Habilitar APIs ----
Write-Host "[2/5] Habilitando APIs necessarias..." -ForegroundColor Yellow
gcloud services enable `
    run.googleapis.com `
    cloudbuild.googleapis.com `
    secretmanager.googleapis.com `
    containerregistry.googleapis.com
if ($LASTEXITCODE -ne 0) { exit 1 }
Write-Host "  APIs habilitadas." -ForegroundColor Green

# ---- 3. Criar secrets no Secret Manager ----
Write-Host "[3/5] Criando secrets no Secret Manager..." -ForegroundColor Yellow

function Set-GcpSecret($secretName, $secretValue) {
    # Redireciona stderr para evitar que PowerShell trate como erro
    $null = gcloud secrets describe $secretName 2>&1
    if ($LASTEXITCODE -eq 0) {
        Write-Host "  $secretName ja existe, adicionando nova versao..."
        $secretValue | gcloud secrets versions add $secretName --data-file=-
    } else {
        Write-Host "  Criando $secretName..."
        $secretValue | gcloud secrets create $secretName --data-file=- --replication-policy=automatic
    }
    if ($LASTEXITCODE -ne 0) {
        Write-Host "  ERRO ao criar secret $secretName" -ForegroundColor Red
        exit 1
    }
}

$FIREBASE_PRIVATE_KEY = Get-EnvVar "FIREBASE_PRIVATE_KEY"
# Restaurar \n para newlines reais
$FIREBASE_PRIVATE_KEY = $FIREBASE_PRIVATE_KEY -replace '\\n', "`n"

$MP_TOKEN = Get-EnvVar "MERCADOPAGO_ACCESS_TOKEN"
$TWILIO_SID = Get-EnvVar "TWILIO_ACCOUNT_SID"
$TWILIO_TOKEN = Get-EnvVar "TWILIO_AUTH_TOKEN"

Set-GcpSecret "firebase-private-key" $FIREBASE_PRIVATE_KEY
Set-GcpSecret "mercadopago-access-token" $MP_TOKEN
Set-GcpSecret "twilio-account-sid" $TWILIO_SID
Set-GcpSecret "twilio-auth-token" $TWILIO_TOKEN

Write-Host "  Secrets criados." -ForegroundColor Green

# ---- 4. Configurar permissoes IAM ----
Write-Host "[4/5] Configurando permissoes IAM..." -ForegroundColor Yellow

$PROJECT_NUMBER = gcloud projects describe $PROJECT_ID --format="value(projectNumber)"
if ($LASTEXITCODE -ne 0) { exit 1 }

# Cloud Build -> Cloud Run deploy
gcloud projects add-iam-policy-binding $PROJECT_ID `
    --member="serviceAccount:${PROJECT_NUMBER}@cloudbuild.gserviceaccount.com" `
    --role="roles/run.admin" `
    --quiet
if ($LASTEXITCODE -ne 0) { exit 1 }

# Cloud Build -> atuar como service account
gcloud projects add-iam-policy-binding $PROJECT_ID `
    --member="serviceAccount:${PROJECT_NUMBER}@cloudbuild.gserviceaccount.com" `
    --role="roles/iam.serviceAccountUser" `
    --quiet
if ($LASTEXITCODE -ne 0) { exit 1 }

# Cloud Run -> ler secrets
gcloud projects add-iam-policy-binding $PROJECT_ID `
    --member="serviceAccount:${PROJECT_NUMBER}-compute@developer.gserviceaccount.com" `
    --role="roles/secretmanager.secretAccessor" `
    --quiet
if ($LASTEXITCODE -ne 0) { exit 1 }

Write-Host "  Permissoes configuradas." -ForegroundColor Green

# ---- 5. Resumo ----
Write-Host ""
Write-Host "[5/5] Setup completo!" -ForegroundColor Green
Write-Host ""
Write-Host "=========================================" -ForegroundColor Cyan
Write-Host "  Proximos passos:" -ForegroundColor Cyan
Write-Host "=========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "  1. Primeiro deploy manual:"
Write-Host "     gcloud run deploy back-turismo --source . --region=southamerica-east1" -ForegroundColor White
Write-Host ""
Write-Host "  2. Apos o deploy, copie a URL do Cloud Run e atualize:"
Write-Host "     - APP_URL no cloudbuild.yaml"
Write-Host "     - CORS_ORIGINS no cloudbuild.yaml (se necessario)"
Write-Host ""
Write-Host "  3. Configure o trigger do Cloud Build:"
Write-Host "     https://console.cloud.google.com/cloud-build/triggers?project=$PROJECT_ID" -ForegroundColor White
Write-Host ""
Write-Host "=========================================" -ForegroundColor Cyan
