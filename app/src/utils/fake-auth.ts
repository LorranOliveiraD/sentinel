// ARQUIVO FAKE PARA TESTE DO SENTINEL
// Isso deve disparar a regra de "secrets"

export const FAKE_AUTH_CONFIG = {
  // Simulando uma chave da AWS
  awsAccessKey: "AKIAIOSFODNN7EXAMPLE",
  awsSecretKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
  
  // Simulando um token do GitHub
  githubToken: "ghp_1234567890abcdef1234567890abcdef123456",
  
  // Simulando uma chave genérica
  API_KEY: "abc123def456ghi789jkl012mno345pqr",
};

export function authenticate() {
  console.log("Authenticating with leaked secrets...");
  return true;
}
