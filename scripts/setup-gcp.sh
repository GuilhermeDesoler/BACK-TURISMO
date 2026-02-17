#!/usr/bin/env bash
set -euo pipefail

# =============================================================
# Setup GCP - Cloud Run + Cloud Build + Secret Manager
# Lê os valores do .env automaticamente
# Uso: bash scripts/setup-gcp.sh
# =============================================================

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ENV_FILE="$SCRIPT_DIR/../.env"

if [ ! -f "$ENV_FILE" ]; then
  echo "Erro: arquivo .env nao encontrado em $ENV_FILE"
  exit 1
fi

# Carrega vars do .env (suporta valores multi-linha com quotes)
load_env_var() {
  local var_name="$1"
  local value
  value=$(grep "^${var_name}=" "$ENV_FILE" | head -1 | sed "s/^${var_name}=//" | sed 's/^"//;s/"$//')
  echo "$value"
}

PROJECT_ID=$(load_env_var "FIREBASE_PROJECT_ID")

if [ -z "$PROJECT_ID" ]; then
  echo "Erro: FIREBASE_PROJECT_ID nao encontrado no .env"
  exit 1
fi

echo "========================================="
echo "  Setup GCP - Projeto: $PROJECT_ID"
echo "========================================="
echo ""

# ---- 1. Definir projeto ativo ----
echo "[1/5] Definindo projeto ativo..."
gcloud config set project "$PROJECT_ID"

# ---- 2. Habilitar APIs ----
echo "[2/5] Habilitando APIs necessarias..."
gcloud services enable \
  run.googleapis.com \
  cloudbuild.googleapis.com \
  secretmanager.googleapis.com \
  containerregistry.googleapis.com

echo "  APIs habilitadas."

# ---- 3. Criar secrets no Secret Manager ----
echo "[3/5] Criando secrets no Secret Manager..."

create_secret() {
  local secret_name="$1"
  local secret_value="$2"

  if gcloud secrets describe "$secret_name" &>/dev/null; then
    echo "  $secret_name ja existe, adicionando nova versao..."
    printf '%s' "$secret_value" | gcloud secrets versions add "$secret_name" --data-file=-
  else
    echo "  Criando $secret_name..."
    printf '%s' "$secret_value" | gcloud secrets create "$secret_name" --data-file=- --replication-policy=automatic
  fi
}

FIREBASE_PRIVATE_KEY=$(load_env_var "FIREBASE_PRIVATE_KEY")
MERCADOPAGO_ACCESS_TOKEN=$(load_env_var "MERCADOPAGO_ACCESS_TOKEN")
TWILIO_ACCOUNT_SID=$(load_env_var "TWILIO_ACCOUNT_SID")
TWILIO_AUTH_TOKEN=$(load_env_var "TWILIO_AUTH_TOKEN")

# Restaurar \n literals para newlines reais na private key
FIREBASE_PRIVATE_KEY=$(echo -e "$FIREBASE_PRIVATE_KEY")

create_secret "firebase-private-key" "$FIREBASE_PRIVATE_KEY"
create_secret "mercadopago-access-token" "$MERCADOPAGO_ACCESS_TOKEN"
create_secret "twilio-account-sid" "$TWILIO_ACCOUNT_SID"
create_secret "twilio-auth-token" "$TWILIO_AUTH_TOKEN"

echo "  Secrets criados."

# ---- 4. Configurar permissoes IAM ----
echo "[4/5] Configurando permissoes IAM..."

PROJECT_NUMBER=$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')

# Cloud Build precisa de permissao para fazer deploy no Cloud Run
gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:${PROJECT_NUMBER}@cloudbuild.gserviceaccount.com" \
  --role="roles/run.admin" \
  --quiet

# Cloud Build precisa atuar como service account do Cloud Run
gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:${PROJECT_NUMBER}@cloudbuild.gserviceaccount.com" \
  --role="roles/iam.serviceAccountUser" \
  --quiet

# Cloud Run precisa ler secrets
gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:${PROJECT_NUMBER}-compute@developer.gserviceaccount.com" \
  --role="roles/secretmanager.secretAccessor" \
  --quiet

echo "  Permissoes configuradas."

# ---- 5. Resumo ----
echo ""
echo "[5/5] Setup completo!"
echo ""
echo "========================================="
echo "  Proximos passos:"
echo "========================================="
echo ""
echo "  1. Primeiro deploy manual:"
echo "     gcloud run deploy back-turismo --source . --region=southamerica-east1"
echo ""
echo "  2. Apos o deploy, copie a URL do Cloud Run e atualize:"
echo "     - APP_URL no cloudbuild.yaml"
echo "     - CORS_ORIGINS no cloudbuild.yaml (se necessario)"
echo ""
echo "  3. Configure o trigger do Cloud Build no console:"
echo "     https://console.cloud.google.com/cloud-build/triggers?project=$PROJECT_ID"
echo "     Ou via CLI:"
echo "     gcloud builds triggers create github \\"
echo "       --repo-name=BACK-TURISMO \\"
echo "       --repo-owner=SEU_GITHUB_USER \\"
echo "       --branch-pattern=\"^main\$\" \\"
echo "       --build-config=cloudbuild.yaml"
echo ""
echo "========================================="
