export const EnvTypesValues = [
  'development',
  'production',
  'homolog',
  'local',
] as const;
export type EnvType = (typeof EnvTypesValues)[number];

export const RequiredEnvVars = [
  'APP_ENV',
  'FIREBASE_PROJECT_ID',
  'FIREBASE_PRIVATE_KEY',
  'FIREBASE_CLIENT_EMAIL',
  'APP_URL',
] as const;

export const OptionalEnvVars = [
  'TWILIO_ACCOUNT_SID',
  'TWILIO_AUTH_TOKEN',
  'TWILIO_WHATSAPP_NUMBER',
  'MERCADOPAGO_ACCESS_TOKEN',
  'MERCADOPAGO_WEBHOOK_SECRET',
] as const;

export const EnvVarsValues = [...RequiredEnvVars, ...OptionalEnvVars] as const;
export type EnvVars = (typeof EnvVarsValues)[number];

export class Environment {
  private static isValidated = false;
  private static validationEnabled = true;

  static disableValidation(): void {
    this.validationEnabled = false;
  }

  static getVar(varName: EnvVars): string {
    if (!this.isValidated && this.validationEnabled) {
      this.validateVars();
    }
    return process.env[varName] as string;
  }

  static getOptionalVar(varName: string): string | undefined {
    return process.env[varName];
  }

  private static validateVars(): void {
    const missingVars: string[] = [];
    RequiredEnvVars.forEach((varName) => {
      if (!process.env[varName]) {
        missingVars.push(varName);
      }
    });
    if (missingVars.length > 0) {
      throw new Error(`Missing required env vars: ${missingVars.join(', ')}`);
    }

    const missingOptional = OptionalEnvVars.filter(
      (varName) => !process.env[varName],
    );
    if (missingOptional.length > 0) {
      console.warn(
        `[Environment] Optional env vars not set (features disabled): ${missingOptional.join(', ')}`,
      );
    }

    this.isValidated = true;
  }

  static getEnvType(): EnvType {
    const envType = Environment.getVar('APP_ENV') as EnvType;
    if (!EnvTypesValues.includes(envType)) {
      throw new Error(
        `APP_ENV value "${envType}" is not valid. Expected one of: ${EnvTypesValues.join(', ')}`,
      );
    }
    return envType;
  }
}
