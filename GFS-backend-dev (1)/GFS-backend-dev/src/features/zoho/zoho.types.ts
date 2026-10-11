export interface ZohoTokenResponse {
  access_token: string;
  refresh_token?: string;
  api_domain: string;
  token_type: string;
  expires_in: number;
  scope?: string;
}

export interface ZohoTokenError {
  error: string;
}

export interface ZohoStoredToken {
  accessToken: string;
  refreshToken: string;
  apiDomain: string;
  expiresAt: Date;
  scope?: string;
}
